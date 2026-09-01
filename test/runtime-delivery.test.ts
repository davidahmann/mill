import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MillError, ExitCode } from "../src/errors.js";
import {
  finalizeDraftPr,
  observeDraftPr,
  openDraftPr,
  planDraftPr,
  reconcileDraftPr,
} from "../src/runtime/delivery.js";
import type {
  GitHubAdapter,
  GitHubBinding,
  GitHubCheck,
  GitHubCommit,
  GitHubFeedback,
  GitHubObservation,
  GitHubPullRequest,
  GitHubReview,
  ProposeConfig,
} from "../src/runtime/github.js";
import {
  qualifyBaseline,
  resumeRun,
  reviewRun,
  startLocalRun,
  verifyRun,
} from "../src/runtime/lifecycle.js";
import { runtimeFixture } from "./runtime-fixture.js";

const original = {
  state: process.env.MILL_STATE_HOME,
  codex: process.env.MILL_CODEX_PATH,
  docker: process.env.MILL_DOCKER_PATH,
};

afterEach(() => {
  if (original.state === undefined) delete process.env.MILL_STATE_HOME;
  else process.env.MILL_STATE_HOME = original.state;
  if (original.codex === undefined) delete process.env.MILL_CODEX_PATH;
  else process.env.MILL_CODEX_PATH = original.codex;
  if (original.docker === undefined) delete process.env.MILL_DOCKER_PATH;
  else process.env.MILL_DOCKER_PATH = original.docker;
});

function activate(fixture: Awaited<ReturnType<typeof runtimeFixture>>): void {
  process.env.MILL_STATE_HOME = fixture.stateHome;
  process.env.MILL_CODEX_PATH = fixture.codexPath;
  process.env.MILL_DOCKER_PATH = fixture.dockerPath;
}

function completedCheck(conclusion: string, name = "validate"): GitHubCheck {
  return { name, status: "completed", conclusion };
}

class FakeGitHub implements GitHubAdapter {
  binding: GitHubBinding = {
    actorLogin: "operator",
    actorId: 7,
    repositoryNodeId: "R_example",
    fullName: "example/app",
    cloneUrl: "https://github.com/example/app.git",
    defaultBranch: "main",
    fork: false,
  };
  branchSha: string | null = null;
  pullRequest: GitHubPullRequest | null = null;
  checks: GitHubCheck[] = [];
  mergeChecks: GitHubCheck[] = [];
  reviews: GitHubReview[] = [];
  feedback: GitHubFeedback[] = [];
  mergeCommit: GitHubCommit | null = null;
  mergeIsOnDefaultBranch = false;
  defaultBranchHead = "d".repeat(40);
  pushFailure: "before" | "after" | null = null;
  prFailure: "before" | "after" | null = null;
  pushCalls = 0;
  createCalls = 0;
  inspectCalls = 0;
  attemptedPullRequest:
    | { config: ProposeConfig; branch: string; title: string; body: string }
    | undefined;

  async inspect(): Promise<GitHubBinding> {
    await Promise.resolve();
    this.inspectCalls += 1;
    return this.binding;
  }

  async readBranch(): Promise<string | null> {
    await Promise.resolve();
    return this.branchSha;
  }

  async pushExact(input: {
    candidateCommit: string;
    expectedOldCommit: string | null;
  }): Promise<void> {
    await Promise.resolve();
    this.pushCalls += 1;
    if (input.expectedOldCommit !== this.branchSha) {
      throw new MillError(
        "FAKE_REMOTE_LEASE_MISMATCH",
        "fake expected-old-head mismatch",
        ExitCode.configuration,
      );
    }
    if (this.pushFailure === "before") {
      this.pushFailure = null;
      throw new MillError(
        "FAKE_PUSH_INTERRUPTED",
        "fake push interrupted before effect",
        ExitCode.temporary,
      );
    }
    this.branchSha = input.candidateCommit;
    if (this.pullRequest !== null) {
      this.pullRequest = {
        ...this.pullRequest,
        headSha: input.candidateCommit,
      };
    }
    if (this.pushFailure === "after") {
      this.pushFailure = null;
      throw new MillError(
        "FAKE_PUSH_RECEIPT_LOST",
        "fake push effect completed before receipt loss",
        ExitCode.temporary,
      );
    }
  }

  async findPullRequests(): Promise<readonly GitHubPullRequest[]> {
    await Promise.resolve();
    return this.pullRequest === null ? [] : [this.pullRequest];
  }

  #materializePullRequest(): GitHubPullRequest {
    const attempted = this.attemptedPullRequest;
    if (attempted === undefined || this.branchSha === null) {
      throw new Error("fake pull request has no attempted call or branch");
    }
    const pullRequest: GitHubPullRequest = {
      number: 41,
      nodeId: "PR_example",
      url: "https://github.com/example/app/pull/41",
      state: "open",
      draft: true,
      body: attempted.body,
      headRef: attempted.branch,
      headSha: this.branchSha,
      baseRef: attempted.config.baseBranch,
      merged: false,
      mergeCommitSha: null,
      mergedAt: null,
    };
    this.pullRequest = pullRequest;
    return pullRequest;
  }

  materializeDelayedPullRequest(): void {
    this.#materializePullRequest();
  }

  async createDraftPullRequest(input: {
    config: ProposeConfig;
    branch: string;
    title: string;
    body: string;
  }): Promise<GitHubPullRequest> {
    await Promise.resolve();
    this.createCalls += 1;
    this.attemptedPullRequest = input;
    if (this.prFailure === "before") {
      this.prFailure = null;
      throw new MillError(
        "FAKE_PR_INTERRUPTED",
        "fake pull request interrupted before effect",
        ExitCode.temporary,
      );
    }
    const pullRequest = this.#materializePullRequest();
    if (this.prFailure === "after") {
      this.prFailure = null;
      throw new MillError(
        "FAKE_PR_RECEIPT_LOST",
        "fake pull request effect completed before receipt loss",
        ExitCode.temporary,
      );
    }
    return pullRequest;
  }

  async observe(): Promise<GitHubObservation> {
    await Promise.resolve();
    if (this.pullRequest === null) {
      throw new MillError(
        "FAKE_PR_MISSING",
        "fake pull request is absent",
        ExitCode.data,
      );
    }
    return {
      pullRequest: this.pullRequest,
      branchSha: this.branchSha,
      checks: this.checks,
      mergeChecks: this.mergeChecks,
      reviews: this.reviews,
      feedback: this.feedback,
      defaultBranchHead: this.defaultBranchHead,
      mergeCommit: this.mergeCommit,
      mergeIsOnDefaultBranch: this.mergeIsOnDefaultBranch,
    };
  }

  merge(candidateTree: string, parentCount = 1): void {
    if (this.pullRequest === null) throw new Error("fake pull request missing");
    const mergeSha = "c".repeat(40);
    this.pullRequest = {
      ...this.pullRequest,
      state: "closed",
      draft: false,
      merged: true,
      mergeCommitSha: mergeSha,
      mergedAt: "2026-09-01T17:00:00.000Z",
    };
    this.branchSha = null;
    this.mergeCommit = {
      sha: mergeSha,
      tree: candidateTree,
      parents: Array.from({ length: parentCount }, (_value, index) =>
        String(index + 1).repeat(40),
      ),
    };
    this.defaultBranchHead = mergeSha;
    this.mergeIsOnDefaultBranch = true;
  }
}

async function reviewedFixture(
  options: {
    githubReviewer?: string;
  } = {},
): Promise<{
  fixture: Awaited<ReturnType<typeof runtimeFixture>>;
  runId: string;
  candidateCommit: string;
  candidateTree: string;
}> {
  const fixture = await runtimeFixture({
    propose: true,
    ...(options.githubReviewer === undefined
      ? {}
      : { githubReviewer: options.githubReviewer }),
  });
  activate(fixture);
  const qualification = await qualifyBaseline({
    root: fixture.root,
    taskPath: fixture.taskPath,
  });
  if (qualification.approvalDigest === null) {
    throw new Error("fake baseline qualification failed");
  }
  const started = await startLocalRun({
    root: fixture.root,
    taskPath: fixture.taskPath,
    approvalDigest: qualification.approvalDigest,
  });
  await verifyRun({
    root: fixture.root,
    taskPath: fixture.taskPath,
    runId: started.run.id,
  });
  const reviewed = await reviewRun({
    root: fixture.root,
    taskPath: fixture.taskPath,
    runId: started.run.id,
  });
  if (
    reviewed.run.candidateCommit === undefined ||
    reviewed.run.candidateTree === undefined
  ) {
    throw new Error("fake reviewed candidate identity missing");
  }
  return {
    fixture,
    runId: reviewed.run.id,
    candidateCommit: reviewed.run.candidateCommit,
    candidateTree: reviewed.run.candidateTree,
  };
}

async function planAndOpen(input: {
  fixture: Awaited<ReturnType<typeof runtimeFixture>>;
  runId: string;
  adapter: FakeGitHub;
}): Promise<Awaited<ReturnType<typeof openDraftPr>>> {
  const planned = await planDraftPr({
    root: input.fixture.root,
    taskPath: input.fixture.taskPath,
    runId: input.runId,
    adapter: input.adapter,
  });
  return openDraftPr({
    root: input.fixture.root,
    taskPath: input.fixture.taskPath,
    runId: input.runId,
    approvalDigest: planned.delivery.proposalDigest,
    adapter: input.adapter,
  });
}

describe("exact-candidate GitHub draft delivery", () => {
  it("requires an exact attended proposal and closes only after merge readback", async () => {
    const { fixture, runId, candidateTree } = await reviewedFixture();
    const adapter = new FakeGitHub();
    try {
      const planned = await planDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(planned.delivery.proposalDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(adapter).toMatchObject({ pushCalls: 0, createCalls: 0 });
      await expect(
        openDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          approvalDigest: `sha256:${"0".repeat(64)}`,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "DELIVERY_APPROVAL_MISMATCH" });
      expect(adapter).toMatchObject({ pushCalls: 0, createCalls: 0 });
      const opened = await openDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        approvalDigest: planned.delivery.proposalDigest,
        adapter,
      });
      expect(opened.run.status).toBe("awaiting_ci");
      expect(adapter).toMatchObject({ pushCalls: 1, createCalls: 1 });

      const pending = await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(pending.run.status).toBe("awaiting_ci");
      adapter.checks = [completedCheck("success")];
      const awaitingHuman = await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(awaitingHuman.run.status).toBe("awaiting_human");
      await expect(
        finalizeDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "HUMAN_MERGE_PENDING" });

      adapter.merge(candidateTree, 2);
      adapter.mergeChecks = [completedCheck("success")];
      await expect(
        finalizeDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "MERGE_METHOD_NOT_ALLOWED" });
      adapter.merge(candidateTree);
      const finalized = await finalizeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(finalized.run.status).toBe("closed");
      expect(finalized.delivery).toMatchObject({
        state: "closed",
        merge: { method: "squash", tree: candidateTree },
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("recovers effects completed before their receipts without duplication", async () => {
    const { fixture, runId } = await reviewedFixture();
    const adapter = new FakeGitHub();
    adapter.pushFailure = "after";
    adapter.prFailure = "after";
    try {
      const opened = await planAndOpen({ fixture, runId, adapter });
      expect(opened.run.status).toBe("awaiting_ci");
      expect(adapter).toMatchObject({ pushCalls: 1, createCalls: 1 });
      expect(opened.delivery.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "push", status: "verified" }),
          expect.objectContaining({
            kind: "pull_request",
            status: "verified",
          }),
        ]),
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("blocks unknown effects and reconciles readback before any retry", async () => {
    const { fixture, runId, candidateCommit } = await reviewedFixture();
    const adapter = new FakeGitHub();
    adapter.pushFailure = "before";
    try {
      const planned = await planDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      await expect(
        openDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          approvalDigest: planned.delivery.proposalDigest,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "FAKE_PUSH_INTERRUPTED" });
      expect(adapter).toMatchObject({ pushCalls: 1, createCalls: 0 });
      await expect(
        reconcileDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "GITHUB_RECONCILIATION_REQUIRED" });
      expect(adapter).toMatchObject({ pushCalls: 1, createCalls: 0 });

      adapter.branchSha = candidateCommit;
      const reconciled = await reconcileDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(reconciled.run.status).toBe("proposing");
      const opened = await openDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        approvalDigest: planned.delivery.proposalDigest,
        adapter,
      });
      expect(opened.run.status).toBe("awaiting_ci");
      expect(adapter).toMatchObject({ pushCalls: 1, createCalls: 1 });
    } finally {
      await fixture.cleanup();
    }
  });

  it("reconciles a delayed pull-request effect without creating a duplicate", async () => {
    const { fixture, runId } = await reviewedFixture();
    const adapter = new FakeGitHub();
    adapter.prFailure = "before";
    try {
      const planned = await planDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      await expect(
        openDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          approvalDigest: planned.delivery.proposalDigest,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "FAKE_PR_INTERRUPTED" });
      expect(adapter).toMatchObject({ pushCalls: 1, createCalls: 1 });
      await expect(
        reconcileDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "GITHUB_RECONCILIATION_REQUIRED" });
      adapter.materializeDelayedPullRequest();
      const reconciled = await reconcileDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(reconciled.run.status).toBe("awaiting_ci");
      expect(adapter).toMatchObject({ pushCalls: 1, createCalls: 1 });
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed for identity drift and every non-success required check", async () => {
    const { fixture, runId } = await reviewedFixture();
    const changedActor = new FakeGitHub();
    changedActor.binding = { ...changedActor.binding, actorLogin: "intruder" };
    try {
      await expect(
        planDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter: changedActor,
        }),
      ).rejects.toMatchObject({ code: "GITHUB_BINDING_MISMATCH" });
      expect(changedActor).toMatchObject({ pushCalls: 0, createCalls: 0 });

      const fork = new FakeGitHub();
      fork.binding = { ...fork.binding, fork: true };
      await expect(
        planDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter: fork,
        }),
      ).rejects.toMatchObject({ code: "GITHUB_BINDING_MISMATCH" });
      expect(fork).toMatchObject({ pushCalls: 0, createCalls: 0 });

      const adapter = new FakeGitHub();
      await planAndOpen({ fixture, runId, adapter });
      for (const conclusion of [
        "failure",
        "cancelled",
        "neutral",
        "skipped",
        "timed_out",
      ]) {
        adapter.checks = [completedCheck(conclusion)];
        const observed = await observeDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter,
        });
        expect(observed.run).toMatchObject({
          status: "blocked",
          blockCode: "REMOTE_CHECKS_FAILED",
        });
      }
      adapter.checks = [completedCheck("success"), completedCheck("neutral")];
      const conflict = await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(conflict.run.status).toBe("blocked");
      adapter.checks = [completedCheck("success")];
      const passed = await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(passed.run.status).toBe("awaiting_human");

      const configPath = path.join(fixture.root, "mill.yaml");
      await writeFile(
        configPath,
        (await readFile(configPath, "utf8")).replace(
          "allowedMergeMethods: [squash]",
          "allowedMergeMethods: [rebase]",
        ),
      );
      await expect(
        observeDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "DELIVERY_AUTHORITY_DRIFT" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("repairs one aggregated remote review and updates the same pull request", async () => {
    const { fixture, runId, candidateCommit } = await reviewedFixture({
      githubReviewer: "codex-review",
    });
    const adapter = new FakeGitHub();
    try {
      await planAndOpen({ fixture, runId, adapter });
      adapter.checks = [completedCheck("success")];
      adapter.feedback = [
        {
          id: "12",
          actorLogin: "codex-review",
          priority: "P1",
          body: "[P1] Use the repaired value",
          path: "src/value.js",
          line: 1,
          url: "https://github.com/example/app/pull/41#discussion_r12",
          commitId: candidateCommit,
        },
      ];
      const blocked = await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(blocked.run).toMatchObject({
        status: "blocked",
        blockCode: "REMOTE_REVIEW_FINDINGS",
      });

      const repaired = await resumeRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
      });
      expect(repaired.status).toBe("committed");
      expect(repaired.candidateCommit).not.toBe(candidateCommit);
      await verifyRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
      });
      const reviewed = await reviewRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
      });
      if (reviewed.run.candidateCommit === undefined) {
        throw new Error("repaired candidate missing");
      }
      adapter.feedback = [];
      adapter.reviews = [
        {
          actorLogin: "codex-review",
          state: "COMMENTED",
          commitId: reviewed.run.candidateCommit,
        },
        {
          actorLogin: "codex-review",
          state: "CHANGES_REQUESTED",
          commitId: reviewed.run.candidateCommit,
        },
      ];
      const planned = await planDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      const reopened = await openDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        approvalDigest: planned.delivery.proposalDigest,
        adapter,
      });
      expect(reopened.delivery.pullRequest?.number).toBe(41);
      expect(adapter).toMatchObject({ pushCalls: 2, createCalls: 1 });
      const changesRequested = await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(changesRequested.run.status).toBe("awaiting_ci");
      adapter.reviews.push({
        actorLogin: "codex-review",
        state: "COMMENTED",
        commitId: reviewed.run.candidateCommit,
      });
      const ready = await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(ready.run.status).toBe("awaiting_human");
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed on PR drift and post-merge evidence until every identity settles", async () => {
    const { fixture, runId, candidateCommit, candidateTree } =
      await reviewedFixture();
    const adapter = new FakeGitHub();
    try {
      await planAndOpen({ fixture, runId, adapter });
      if (adapter.pullRequest === null) throw new Error("fake PR missing");
      adapter.pullRequest = {
        ...adapter.pullRequest,
        headSha: "f".repeat(40),
      };
      await expect(
        observeDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "REMOTE_IDENTITY_DRIFT" });
      adapter.pullRequest = {
        ...adapter.pullRequest,
        headSha: candidateCommit,
      };
      adapter.checks = [
        { name: "validate", status: "in_progress", conclusion: null },
      ];
      const inProgress = await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(inProgress.run.status).toBe("awaiting_ci");
      adapter.checks = [completedCheck("success")];
      await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      adapter.pullRequest = {
        ...adapter.pullRequest,
        state: "closed",
      };
      await expect(
        finalizeDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "PULL_REQUEST_CLOSED_UNMERGED" });

      adapter.merge("e".repeat(40));
      await expect(
        finalizeDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "MERGE_TREE_REVALIDATION_REQUIRED" });
      adapter.merge(candidateTree);
      const pending = await finalizeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(pending.run.status).toBe("merged");
      adapter.mergeChecks = [completedCheck("failure")];
      const failed = await finalizeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(failed.run).toMatchObject({
        status: "blocked",
        blockCode: "POST_MERGE_CHECKS_FAILED",
      });
      adapter.mergeChecks = [completedCheck("success")];
      const closed = await finalizeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(closed.run.status).toBe("closed");
    } finally {
      await fixture.cleanup();
    }
  });
});
