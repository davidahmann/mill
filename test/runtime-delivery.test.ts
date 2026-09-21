import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify as yaml, parse as parseYaml } from "yaml";
import { canonicalDigest, type JsonValue } from "../src/contracts/canonical.js";
import { planOutcomeClosure } from "../src/planning/closure.js";
import {
  adaptationManifestSchema,
  deliveryRecordSchema,
  outcomePlanSchema,
  taskPacketV2Schema,
} from "../src/contracts/schemas.js";

import { MillError, ExitCode } from "../src/errors.js";
import { runCli } from "../src/cli-program.js";
import {
  actionableFeedback,
  finalizeDraftPr,
  observeDraftPr,
  openDraftPr,
  planDraftPr,
  reconcileDraftPr,
  reviewsPassed,
  type DeliveryRecord,
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
  cancelRun,
  qualifyBaseline,
  resumeRun,
  reviewRun,
  runStatus,
  startLocalRun,
  statePurge,
  verifyRun,
} from "../src/runtime/lifecycle.js";
import { loadRuntimeInputs, textDigest } from "../src/runtime/inputs.js";
import { commonGitDirectory } from "../src/runtime/repository.js";
import {
  StateStore,
  restoreStateBackup,
  purgeRepositoryState,
} from "../src/runtime/state.js";
import { runtimeFixture, rewriteFixtureAuthority } from "./runtime-fixture.js";
import { applyMerge, planMerge, reconcileMerge } from "../src/runtime/merge.js";
import {
  assertEffectAllowsNewWork,
  externalEffectBoundary,
  reconcilableDraftEffect,
} from "../src/runtime/effect-boundary.js";

const original = {
  state: process.env.MILL_STATE_HOME,
  codex: process.env.MILL_CODEX_PATH,
  docker: process.env.MILL_DOCKER_PATH,
};
const execFileAsync = promisify(execFile);
const gitExecutable = process.env.MILL_GIT_PATH ?? "/usr/bin/git";
const git = (root: string, args: string[]) =>
  execFileAsync(
    gitExecutable,
    [
      "-c",
      "user.name=Mill Test",
      "-c",
      "user.email=mill-test@example.invalid",
      ...args,
    ],
    { cwd: root },
  );

afterEach(() => {
  vi.restoreAllMocks();
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

async function bindAdaptationAuthority(
  fixture: Awaited<ReturnType<typeof runtimeFixture>>,
  expiresAt: string,
): Promise<void> {
  const taskPath = path.join(fixture.root, fixture.taskPath);
  const evidencePath = "quality/adaptation-fixture.json";
  const manifestPath = "product/adaptation.yaml";
  const evidence = '{"configuration":"standard"}\n';
  const reference = { path: evidencePath, digest: textDigest(evidence) };
  const manifest = adaptationManifestSchema.parse({
    schemaVersion: "1",
    id: "fixture-adaptation",
    owner: "test-owner",
    provider: { id: "fixture", from: "v1", to: "v2", notice: reference },
    applicability: {
      statement: "The fixture uses the retired route.",
      evidence: reference,
    },
    workflows: ["positive-value"],
    configurations: [{ id: "standard", revision: "1", fixture: reference }],
    fixtures: {
      kind: "synthetic",
      capturedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt,
    },
    matrix: [
      {
        workflowId: "positive-value",
        configurationId: "standard",
        disposition: "check",
        scenarioId: "SCN-POSITIVE",
        commandId: "test",
      },
    ],
  });
  const manifestText = yaml(manifest);
  const task = taskPacketV2Schema.parse(
    parseYaml(await readFile(taskPath, "utf8")),
  );
  task.contextPaths.push(evidencePath);
  task.authority.adaptation = {
    path: manifestPath,
    digest: textDigest(manifestText),
  };
  await Promise.all([
    writeFile(path.join(fixture.root, evidencePath), evidence),
    writeFile(path.join(fixture.root, manifestPath), manifestText),
    writeFile(taskPath, yaml(task)),
  ]);
  await git(fixture.root, [
    "add",
    evidencePath,
    manifestPath,
    fixture.taskPath,
  ]);
  await git(fixture.root, [
    "commit",
    "--no-gpg-sign",
    "-m",
    "test: bind adaptation authority",
  ]);
}

function completedCheck(conclusion: string, name = "validate"): GitHubCheck {
  return { name, status: "completed", conclusion };
}

class FakeGitHub implements GitHubAdapter {
  constructor(public defaultBranchHead: string) {}
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
  pushFailure: "before" | "after" | null = null;
  prFailure: "before" | "after" | null = null;
  pushCalls = 0;
  createCalls = 0;
  inspectCalls = 0;
  onPush: (() => Promise<void>) | undefined;
  attemptedPullRequest:
    | { config: ProposeConfig; branch: string; title: string; body: string }
    | undefined;

  async inspect(): Promise<GitHubBinding> {
    await Promise.resolve();
    this.inspectCalls += 1;
    return this.binding;
  }

  async readBranch(input: { branch: string }): Promise<string | null> {
    await Promise.resolve();
    return input.branch === "main" ? this.defaultBranchHead : this.branchSha;
  }

  async pushExact(input: {
    candidateCommit: string;
    expectedOldCommit: string | null;
  }): Promise<void> {
    await Promise.resolve();
    this.pushCalls += 1;
    await this.onPush?.();
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
      mergedByLogin: null,
      mergedAt: null,
    };
    this.pullRequest = pullRequest;
    return pullRequest;
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
      mergedByLogin: "operator",
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

async function configureProposeCheckPolicy(
  fixture: Awaited<ReturnType<typeof runtimeFixture>>,
  input: {
    requiredChecks?: readonly string[];
    postMergeRequiredChecks?: readonly string[];
  },
): Promise<void> {
  const configPath = path.join(fixture.root, "mill.yaml");
  let source = await readFile(configPath, "utf8");
  source = source.replace(/^ {2}postMergeRequiredChecks: \[[^\n]*\]\n/mu, "");
  if (input.requiredChecks !== undefined) {
    source = source.replace(
      /^ {2}requiredChecks: \[[^\n]*\]\n/mu,
      `  requiredChecks: [${input.requiredChecks.join(", ")}]\n`,
    );
  }
  if (input.postMergeRequiredChecks !== undefined) {
    source = source.replace(
      /^( {2}requiredChecks: \[[^\n]*\])\n/mu,
      `$1\n  postMergeRequiredChecks: [${input.postMergeRequiredChecks.join(", ")}]\n`,
    );
  }
  await writeFile(configPath, source, "utf8");
  await execFileAsync(
    gitExecutable,
    [
      "-c",
      "user.name=Mill Test",
      "-c",
      "user.email=mill-test@example.invalid",
      "add",
      "mill.yaml",
    ],
    { cwd: fixture.root },
  );
  await execFileAsync(
    gitExecutable,
    [
      "-c",
      "user.name=Mill Test",
      "-c",
      "user.email=mill-test@example.invalid",
      "commit",
      "--no-gpg-sign",
      "-m",
      "test: configure fixture checks",
    ],
    { cwd: fixture.root },
  );
}

async function fixtureDelivery(
  fixture: Awaited<ReturnType<typeof runtimeFixture>>,
  runId: string,
): Promise<Record<string, unknown>> {
  const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
  const store = await StateStore.open(
    inputs.config.repositoryId,
    await commonGitDirectory(fixture.root),
  );
  try {
    const run = store.getRun(runId);
    if (run.deliveryJson === undefined) {
      throw new Error("delivery record is missing");
    }
    return JSON.parse(run.deliveryJson) as Record<string, unknown>;
  } finally {
    store.close();
  }
}

async function seedLegacyPostMergeDelivery(
  fixture: Awaited<ReturnType<typeof runtimeFixture>>,
  runId: string,
): Promise<void> {
  const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
  const store = await StateStore.open(
    inputs.config.repositoryId,
    await commonGitDirectory(fixture.root),
  );
  try {
    const run = store.getRun(runId);
    if (run.deliveryJson === undefined) {
      throw new Error("delivery record is missing");
    }
    const delivery = JSON.parse(run.deliveryJson) as Record<string, unknown>;
    delete delivery.postMergeRequiredChecks;
    delete delivery.postMergePolicySource;
    delete delivery.legacyPostMergePolicyConfigDigest;
    store.setDelivery(
      runId,
      JSON.stringify(delivery),
      "test.legacy_delivery_seeded",
    );
  } finally {
    store.close();
  }
}

async function reviewedFixture(
  options: {
    advisoryReview?: boolean;
    reviewBlocking?: "p0_p1";
    attendedMerge?: boolean;
    adaptationExpiresAt?: string;
    impactExpiresAt?: string;
    githubReviewer?: string;
    githubReviewMode?: "github_required" | "github_codex_required";
    requiredChecks?: readonly string[];
    postMergeRequiredChecks?: readonly string[];
    prepare?: (
      fixture: Awaited<ReturnType<typeof runtimeFixture>>,
    ) => Promise<void>;
  } = {},
): Promise<{
  fixture: Awaited<ReturnType<typeof runtimeFixture>>;
  runId: string;
  candidateCommit: string;
  candidateTree: string;
}> {
  const fixture = await runtimeFixture({
    propose: true,
    ...(options.advisoryReview ? { advisoryReview: true } : {}),
    ...(options.reviewBlocking
      ? { reviewBlocking: options.reviewBlocking }
      : {}),
    ...(options.impactExpiresAt === undefined
      ? {}
      : { impactExpiresAt: options.impactExpiresAt }),
    ...(options.attendedMerge === true ? { attendedMerge: true } : {}),
    ...(options.githubReviewer === undefined
      ? {}
      : {
          githubReviewer: options.githubReviewer,
          ...(options.githubReviewMode === undefined
            ? {}
            : { githubReviewMode: options.githubReviewMode }),
        }),
  });
  if (
    options.requiredChecks !== undefined ||
    options.postMergeRequiredChecks !== undefined
  ) {
    await configureProposeCheckPolicy(fixture, {
      ...(options.requiredChecks === undefined
        ? {}
        : { requiredChecks: options.requiredChecks }),
      ...(options.postMergeRequiredChecks === undefined
        ? {}
        : { postMergeRequiredChecks: options.postMergeRequiredChecks }),
    });
  }
  if (options.adaptationExpiresAt !== undefined) {
    await bindAdaptationAuthority(fixture, options.adaptationExpiresAt);
  }
  await options.prepare?.(fixture);
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
    attended: true,
    adapter: input.adapter,
  });
}

describe("exact-candidate GitHub draft delivery", () => {
  it("gates GitHub Codex delivery across readiness, exact review evidence, and post-merge readback", async () => {
    const { fixture, runId, candidateCommit, candidateTree } =
      await reviewedFixture({
        attendedMerge: true,
        githubReviewer: "chatgpt-codex-connector[bot]",
        githubReviewMode: "github_codex_required",
        reviewBlocking: "p0_p1",
      });
    class CodexMergeGitHub extends FakeGitHub {
      readyCalls = 0;
      mergeCalls = 0;
      observeCalls = 0;
      changeFeedbackOn = 0;
      async strictChecks() {
        await Promise.resolve();
        return true;
      }
      async markReady() {
        await Promise.resolve();
        this.readyCalls++;
        if (this.pullRequest === null) throw new Error("missing fake PR");
        this.pullRequest = { ...this.pullRequest, draft: false };
      }
      async mergeExact() {
        await Promise.resolve();
        this.mergeCalls++;
        this.merge(candidateTree);
      }
      override async observe() {
        this.observeCalls++;
        if (this.observeCalls === this.changeFeedbackOn)
          this.feedback = [advisory("[P2] Changed during final preflight")];
        return super.observe();
      }
    }
    const adapter = new CodexMergeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
    const input = {
      root: fixture.root,
      taskPath: fixture.taskPath,
      runId,
      adapter,
    };
    const review = (
      state: "CODEX_RUNNING" | "CODEX_COMPLETED",
    ): GitHubReview => ({
      id: `summary-${state}`,
      actorLogin: "chatgpt-codex-connector[bot]",
      state,
      commitId: candidateCommit,
      body: "",
      url: "https://github.com/example/app/pull/41#issuecomment-1",
    });
    const advisory = (body = "[P2] Optional cleanup"): GitHubFeedback => ({
      id: "advisory-1",
      actorLogin: "chatgpt-codex-connector[bot]",
      priority: "P2",
      body,
      path: "src/value.js",
      line: 1,
      url: "https://github.com/example/app/pull/41#discussion-1",
      commitId: candidateCommit,
    });
    const check = {
      ...completedCheck("success"),
      appId: 15368,
      workflowPath: ".github/workflows/ci.yml",
      event: "pull_request",
      headSha: candidateCommit,
    };
    try {
      await planAndOpen({ fixture, runId, adapter });
      adapter.checks = [check];
      adapter.reviews = [review("CODEX_RUNNING")];
      expect((await observeDraftPr(input)).run.status).toBe("awaiting_ci");

      const readiness = await planMerge({ ...input, method: "squash" });
      expect(readiness.plan.markReady).toBe(true);
      expect(readiness.plan.reviewEvidenceDigest).toBeUndefined();
      expect(
        (
          await applyMerge({
            ...input,
            approvalDigest: readiness.digest,
            attended: true,
          })
        ).state,
      ).toBe("ready_verified");
      expect(adapter.readyCalls).toBe(1);
      expect(adapter.mergeCalls).toBe(0);

      adapter.reviews = [review("CODEX_COMPLETED")];
      adapter.feedback = [advisory()];
      await expect(
        planMerge({ ...input, method: "squash" }),
      ).rejects.toMatchObject({ code: "MERGE_NOT_READY" });
      expect((await observeDraftPr(input)).run.status).toBe("awaiting_human");
      const merge = await planMerge({ ...input, method: "squash" });
      expect(merge.plan.markReady).toBe(false);
      expect(merge.plan.reviewEvidenceDigest).toMatch(/^sha256:/u);
      adapter.feedback = [advisory("[P2] Changed after approval")];
      await expect(
        applyMerge({
          ...input,
          approvalDigest: merge.digest,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "MERGE_PLAN_STALE" });

      const finalDrift = await planMerge({ ...input, method: "squash" });
      adapter.changeFeedbackOn = adapter.observeCalls + 2;
      await expect(
        applyMerge({
          ...input,
          approvalDigest: finalDrift.digest,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "MERGE_PLAN_STALE" });
      adapter.changeFeedbackOn = 0;
      const fresh = await planMerge({ ...input, method: "squash" });
      expect(
        (
          await applyMerge({
            ...input,
            approvalDigest: fresh.digest,
            attended: true,
          })
        ).state,
      ).toBe("merged");
      expect(adapter.mergeCalls).toBe(1);
      adapter.feedback = [{ ...advisory(), id: "blocking-1", priority: "P1" }];
      adapter.mergeChecks = [
        { ...check, event: "push", headSha: "c".repeat(40) },
      ];
      expect((await finalizeDraftPr(input)).run).toMatchObject({
        status: "blocked",
        blockCode: "POST_MERGE_REVIEW_BLOCKED",
      });
      adapter.feedback = [advisory()];
      expect((await finalizeDraftPr(input)).run.status).toBe("closed");
    } finally {
      await fixture.cleanup();
    }
  });

  it("blocks completed GitHub Codex review when exact-head P1 feedback remains", async () => {
    const { fixture, runId, candidateCommit } = await reviewedFixture({
      githubReviewer: "chatgpt-codex-connector[bot]",
      githubReviewMode: "github_codex_required",
      reviewBlocking: "p0_p1",
    });
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
    try {
      await planAndOpen({ fixture, runId, adapter });
      adapter.checks = [completedCheck("success")];
      adapter.reviews = [
        {
          id: "codex-complete",
          actorLogin: "chatgpt-codex-connector[bot]",
          state: "CODEX_COMPLETED",
          commitId: candidateCommit,
          body: "",
          url: "https://github.com/example/app/pull/41#issuecomment-1",
        },
      ];
      adapter.feedback = [
        {
          id: "p1",
          actorLogin: "chatgpt-codex-connector[bot]",
          priority: "P1",
          body: "[P1] Correctness gap",
          path: "src/value.js",
          line: 1,
          url: "https://github.com/example/app/pull/41#discussion-1",
          commitId: candidateCommit,
        },
      ];
      expect(
        (
          await observeDraftPr({
            root: fixture.root,
            taskPath: fixture.taskPath,
            runId,
            adapter,
          })
        ).run,
      ).toMatchObject({
        status: "blocked",
        blockCode: "REMOTE_REVIEW_FINDINGS",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([
    ["push", "before", false],
    ["push", "after", false],
    ["pull_request", "before", false],
    ["pull_request", "after", false],
    ["push", "before", true],
    ["push", "after", true],
    ["pull_request", "before", true],
    ["pull_request", "after", true],
  ] as const)(
    "recovers a hard interruption of %s %s invocation atomically (cancel=%s)",
    async (kind, point, cancel) => {
      const { fixture, runId } = await reviewedFixture();
      const adapter = new FakeGitHub(
        (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
      );
      const input = {
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      };
      try {
        const planned = await planDraftPr(input);
        // Invoked below with .call(this, ...) to preserve the real store binding.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const original = StateStore.prototype.setDelivery;
        const start =
          kind === "push"
            ? "delivery.push_started"
            : "delivery.pull_request_started";
        const done =
          kind === "push"
            ? "delivery.push_verified"
            : "delivery.pull_request_verified";
        const interruption = vi
          .spyOn(StateStore.prototype, "setDelivery")
          .mockImplementation(function (
            this: StateStore,
            id,
            json,
            event,
            details,
          ) {
            if (point === "after" && event === done)
              throw new Error("hard interruption");
            const result = original.call(this, id, json, event, details);
            if (point === "before" && event === start)
              throw new Error("hard interruption");
            return result;
          });
        await expect(
          openDraftPr({
            ...input,
            approvalDigest: planned.delivery.proposalDigest,
            attended: true,
          }),
        ).rejects.toThrow("hard interruption");
        interruption.mockRestore();
        const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
        const store = await StateStore.open(
          inputs.config.repositoryId,
          await commonGitDirectory(fixture.root),
        );
        try {
          const initial = store.getRun(runId);
          expect(initial.status).toBe("proposing");
          expect((await fixtureDelivery(fixture, runId)).effects).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                kind,
                status: "call_started",
                attemptCount: 1,
              }),
            ]),
          );
          const counts = { push: adapter.pushCalls, pr: adapter.createCalls };
          if (kind === "push" && point === "before" && !cancel) {
            if (initial.deliveryJson === undefined)
              throw new Error("missing journal");
            const originalJournal = initial.deliveryJson;
            const journal = deliveryRecordSchema.parse(
              JSON.parse(initial.deliveryJson),
            );
            const pending = reconcilableDraftEffect(initial);
            const next = {
              ...journal,
              state: "proposing",
              effects: journal.effects.map((effect) =>
                effect.id === pending.id
                  ? { ...effect, status: "retryable_absent" }
                  : effect,
              ),
            };
            expect(() =>
              store.settleDraftEffect(runId, "{}", JSON.stringify(next)),
            ).toThrow("journal changed");
            for (const altered of [
              { ...next, candidateCommit: "a".repeat(40) },
              { ...next, effects: [] },
              {
                ...next,
                effects: next.effects.map((effect) => ({
                  ...effect,
                  attemptCount: 2,
                })),
              },
              { ...next, state: "awaiting_ci" },
              {
                ...next,
                state: "blocked",
                effects: next.effects.map((effect) => ({
                  ...effect,
                  status: "blocked",
                })),
              },
            ])
              expect(() =>
                store.settleDraftEffect(
                  runId,
                  originalJournal,
                  JSON.stringify(altered),
                ),
              ).toThrow();
            const variants = [
              {
                ...journal,
                effects: [
                  ...journal.effects,
                  { ...pending, id: `${pending.id}-duplicate` },
                ],
              },
              { ...journal, candidateCommit: "a".repeat(40) },
              { ...journal, candidateTree: "a".repeat(40) },
              { ...journal, runId: "another-run" },
              {
                ...journal,
                effects: journal.effects.map((effect) => ({
                  ...effect,
                  attemptCount: 0,
                })),
              },
            ];
            for (const invalid of variants)
              expect(() =>
                reconcilableDraftEffect({
                  ...initial,
                  deliveryJson: JSON.stringify(invalid),
                }),
              ).toThrow();
            const withoutJournal = { ...initial };
            delete withoutJournal.deliveryJson;
            expect(() => reconcilableDraftEffect(withoutJournal)).toThrow(
              "No delivery journal",
            );
            expect(() =>
              reconcilableDraftEffect({
                ...initial,
                status: "effect_unknown",
                deliveryJson: JSON.stringify({ ...journal, effects: [] }),
              }),
            ).toThrow("Exactly one interrupted effect");
            expect(store.getRun(runId)).toEqual(initial);
          }
          await expect(
            openDraftPr({
              ...input,
              approvalDigest: planned.delivery.proposalDigest,
              attended: true,
            }),
          ).rejects.toMatchObject({ code: "GITHUB_RECONCILIATION_REQUIRED" });
          await expect(
            reviewRun({
              ...input,
              refresh: true,
              baseCommit: initial.baseCommit,
              attended: true,
            }),
          ).rejects.toMatchObject({ code: "GITHUB_RECONCILIATION_REQUIRED" });
          const outage = vi
            .spyOn(adapter, "readBranch")
            .mockRejectedValue(new Error("readback unavailable"));
          await expect(reconcileDraftPr(input)).rejects.toThrow(
            "readback unavailable",
          );
          expect(store.getRun(runId).deliveryJson).toBe(initial.deliveryJson);
          outage.mockRestore();
          // Prove a database failure cannot settle only the journal or only status.
          const db = new DatabaseSync(
            path.join(store.directory, "state.sqlite3"),
          );
          try {
            if (kind === "push" && point === "before" && !cancel) {
              db.prepare(
                "UPDATE runs SET status = 'cancelled' WHERE id = ?",
              ).run(runId);
              const digest = `sha256:${"a".repeat(64)}`;
              expect(() =>
                store.beginAuthorityPlan(
                  {
                    kind: "tasks",
                    state: "intent",
                    approvalDigest: digest,
                    baseCommit: initial.baseCommit,
                    worktreePath: path.join(
                      store.worktreesDirectory,
                      `plan-${digest.slice(7)}`,
                    ),
                    branch: "mill/guard-probe",
                    files: [{ path: "product/plan.yaml", digest }],
                  },
                  "DUPLICATE",
                ),
              ).toThrow("Reconcile the recorded external effect");
              expect(store.authorityPlans()).toEqual([]);
              db.prepare(
                "UPDATE runs SET status = 'proposing' WHERE id = ?",
              ).run(runId);
            }
            db.exec(
              "CREATE TRIGGER test_fail_settlement BEFORE INSERT ON run_events WHEN NEW.type = 'delivery.effect_reconciled' BEGIN SELECT RAISE(ABORT, 'settlement fault'); END;",
            );
            await expect(reconcileDraftPr(input)).rejects.toMatchObject({
              code: "STATE_WRITE_FAILED",
            });
            expect(store.getRun(runId)).toEqual(initial);
            db.exec("DROP TRIGGER test_fail_settlement;");
            if (kind === "push")
              db.prepare("UPDATE runs SET status = 'blocked' WHERE id = ?").run(
                runId,
              );
          } finally {
            db.close();
          }
          if (cancel) {
            await cancelRun({ root: fixture.root, runId });
            await expect(reconcileDraftPr(input)).rejects.toMatchObject({
              code: "OPERATOR_CANCELLED",
            });
            expect(store.getRun(runId).status).toBe("cancelled");
          } else {
            const result = await reconcileDraftPr(input);
            expect(result.run.status).toBe(
              kind === "pull_request" && point === "after"
                ? "awaiting_ci"
                : "proposing",
            );
            if (kind === "push")
              await expect(
                reviewRun({
                  ...input,
                  refresh: true,
                  baseCommit: result.delivery.candidateCommit,
                  attended: true,
                }),
              ).rejects.toMatchObject({ code: "REVIEW_REFRESH_AFTER_EFFECT" });
          }
          expect((await fixtureDelivery(fixture, runId)).effects).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                kind,
                status: point === "before" ? "retryable_absent" : "verified",
                attemptCount: 1,
              }),
            ]),
          );
          expect({ push: adapter.pushCalls, pr: adapter.createCalls }).toEqual(
            counts,
          );
          expect(
            (await runStatus(input)).reconciliationRequired,
          ).toBeUndefined();
          await expect(reconcileDraftPr(input)).rejects.toMatchObject({
            code: "RECONCILIATION_NOT_REQUIRED",
          });
        } finally {
          store.close();
        }
      } finally {
        await fixture.cleanup();
      }
    },
  );
  it.each([
    "advisory_success",
    "merge_receipt_lost",
    "ready_receipt_lost",
    "success",
    "authority_expires_after_ready",
    "adaptation_expires_after_ready",
  ])(
    "requires exact attended merge approval and reconciles %s",
    async (scenario) => {
      const authorityExpiresAt = new Date(Date.now() + 300_000).toISOString();
      const { fixture, runId, candidateCommit, candidateTree } =
        await reviewedFixture({
          attendedMerge: true,
          ...(scenario === "advisory_success"
            ? { advisoryReview: true, reviewBlocking: "p0_p1" as const }
            : {}),
          ...(scenario === "authority_expires_after_ready"
            ? { impactExpiresAt: authorityExpiresAt }
            : {}),
          ...(scenario === "adaptation_expires_after_ready"
            ? { adaptationExpiresAt: authorityExpiresAt }
            : {}),
        });
      class MergeGitHub extends FakeGitHub {
        strict = true;
        readyCalls = 0;
        mergeCalls = 0;
        loseReceipt = false;
        loseReadyReceipt = false;
        async strictChecks() {
          await Promise.resolve();
          return this.strict;
        }
        async markReady() {
          await Promise.resolve();
          this.readyCalls++;
          if (this.pullRequest === null) throw new Error("missing fake PR");
          this.pullRequest = { ...this.pullRequest, draft: false };
          if (
            scenario === "authority_expires_after_ready" ||
            scenario === "adaptation_expires_after_ready"
          )
            vi.spyOn(Date, "now").mockReturnValue(
              Date.parse(authorityExpiresAt) + 1,
            );
          if (this.loseReadyReceipt) throw new Error("ready receipt lost");
        }
        async mergeExact(input: { headSha: string }) {
          await Promise.resolve();
          expect(input.headSha).toBe(candidateCommit);
          this.mergeCalls++;
          this.merge(candidateTree);
          if (this.loseReceipt) throw new Error("merge receipt lost");
        }
      }
      const adapter = new MergeGitHub(
        (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
      );
      const input = {
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      };
      const check = {
        ...completedCheck("success"),
        appId: 15368,
        workflowPath: ".github/workflows/ci.yml",
        event: "pull_request",
        headSha: candidateCommit,
      };
      try {
        await planAndOpen({ fixture, runId, adapter });
        adapter.checks = [check];
        await observeDraftPr(input);
        adapter.strict = false;
        await expect(
          planMerge({ ...input, method: "squash" }),
        ).rejects.toMatchObject({ code: "MERGE_PROTECTION_REQUIRED" });
        adapter.strict = true;
        await expect(
          planMerge({ ...input, method: "merge" }),
        ).rejects.toMatchObject({ code: "MERGE_METHOD_FORBIDDEN" });
        if (scenario === "advisory_success") {
          const inputs = await loadRuntimeInputs(
            fixture.root,
            fixture.taskPath,
          );
          const store = await StateStore.open(
            inputs.config.repositoryId,
            await commonGitDirectory(fixture.root),
          );
          const current = store.getRun(runId);
          const saved = current.deliveryJson;
          if (saved === undefined) throw new Error("missing delivery");
          const wrong = deliveryRecordSchema.parse(JSON.parse(saved));
          delete wrong.reviewBlocking;
          store.setDelivery(
            runId,
            JSON.stringify(wrong),
            "test.policy_changed",
          );
          store.close();
          await expect(
            planMerge({ ...input, method: "squash" }),
          ).rejects.toMatchObject({ code: "MERGE_EVIDENCE_STALE" });
          const restore = await StateStore.open(
            inputs.config.repositoryId,
            await commonGitDirectory(fixture.root),
          );
          restore.setDelivery(runId, saved, "test.policy_restored");
          restore.close();
        }
        const planned = await planMerge({ ...input, method: "squash" });
        expect(planned.plan).toMatchObject({
          markReady: true,
          actorLogin: "operator",
          headCommit: candidateCommit,
          candidateTree,
        });
        await expect(
          applyMerge({
            ...input,
            approvalDigest: planned.digest,
            attended: false,
          }),
        ).rejects.toMatchObject({ code: "ATTENDANCE_REQUIRED" });
        await expect(
          applyMerge({
            ...input,
            approvalDigest: `sha256:${"0".repeat(64)}`,
            attended: true,
          }),
        ).rejects.toMatchObject({ code: "MERGE_APPROVAL_INVALID" });
        adapter.checks = [{ ...check, event: "push" }];
        await expect(
          applyMerge({
            ...input,
            approvalDigest: planned.digest,
            attended: true,
          }),
        ).rejects.toMatchObject({ code: "MERGE_CHECKS_NOT_GREEN" });
        adapter.checks = [check];
        const baseTree = (
          await git(fixture.root, ["rev-parse", "HEAD^{tree}"])
        ).stdout.trim();
        adapter.defaultBranchHead = (
          await git(fixture.root, [
            "commit-tree",
            baseTree,
            "-p",
            adapter.defaultBranchHead,
            "-m",
            "test: provider base advances",
          ])
        ).stdout.trim();
        await expect(
          applyMerge({
            ...input,
            approvalDigest: planned.digest,
            attended: true,
          }),
        ).rejects.toMatchObject({ code: "MERGE_PLAN_STALE" });
        expect(adapter.readyCalls).toBe(0);
        expect(adapter.mergeCalls).toBe(0);
        let fresh = await planMerge({ ...input, method: "squash" });
        if (
          scenario === "authority_expires_after_ready" ||
          scenario === "adaptation_expires_after_ready"
        ) {
          await expect(
            applyMerge({
              ...input,
              approvalDigest: fresh.digest,
              attended: true,
            }),
          ).rejects.toMatchObject({ code: "MERGE_AUTHORITY_EXPIRED" });
          expect(adapter.readyCalls).toBe(1);
          expect(adapter.mergeCalls).toBe(0);
          expect((await reconcileMerge(input)).state).toBe("ready_verified");
          return;
        }
        if (scenario === "ready_receipt_lost") {
          adapter.loseReadyReceipt = true;
          await expect(
            applyMerge({
              ...input,
              approvalDigest: fresh.digest,
              attended: true,
            }),
          ).rejects.toThrow("ready receipt lost");
          expect(
            (await runStatus({ root: fixture.root, runId }))
              .reconciliationRequired,
          ).toBe(true);
          await expect(observeDraftPr(input)).rejects.toMatchObject({
            code: "GITHUB_RECONCILIATION_REQUIRED",
          });
          await expect(resumeRun(input)).rejects.toMatchObject({
            code: "GITHUB_RECONCILIATION_REQUIRED",
          });
          expect(adapter.mergeCalls).toBe(0);
          await expect(
            planMerge({ ...input, method: "squash" }),
          ).rejects.toMatchObject({ code: "MERGE_RECONCILIATION_REQUIRED" });
          expect((await reconcileMerge(input)).state).toBe("ready_verified");
          fresh = await planMerge({ ...input, method: "squash" });
          expect(fresh.plan.markReady).toBe(false);
        }
        adapter.loseReceipt = scenario === "merge_receipt_lost";
        if (adapter.loseReceipt) {
          await expect(
            applyMerge({
              ...input,
              approvalDigest: fresh.digest,
              attended: true,
            }),
          ).rejects.toThrow("merge receipt lost");
          expect(
            (await fixtureDelivery(fixture, runId)).mergeApproval,
          ).toMatchObject({ state: "effect_unknown" });
          expect(
            (await runStatus({ root: fixture.root, runId }))
              .reconciliationRequired,
          ).toBe(true);
          const before = await fixtureDelivery(fixture, runId);
          await expect(observeDraftPr(input)).rejects.toMatchObject({
            code: "GITHUB_RECONCILIATION_REQUIRED",
          });
          await expect(resumeRun(input)).rejects.toMatchObject({
            code: "GITHUB_RECONCILIATION_REQUIRED",
          });
          await expect(planDraftPr(input)).rejects.toMatchObject({
            code: "GITHUB_RECONCILIATION_REQUIRED",
          });
          await expect(finalizeDraftPr(input)).rejects.toMatchObject({
            code: "GITHUB_RECONCILIATION_REQUIRED",
          });
          const inputs = await loadRuntimeInputs(
            fixture.root,
            fixture.taskPath,
          );
          const common = await commonGitDirectory(fixture.root);
          const store = await StateStore.open(
            inputs.config.repositoryId,
            common,
          );
          try {
            const persisted = store.getRun(runId);
            for (const status of [
              "blocked",
              "cancelled",
              "failed",
              "reviewed",
            ] as const) {
              expect(() =>
                assertEffectAllowsNewWork({ ...persisted, status }),
              ).toThrow("Reconcile the recorded external effect");
            }
            expect(() =>
              externalEffectBoundary({ ...persisted, deliveryJson: "{}" }),
            ).toThrow();
            expect(() =>
              store.createRun({
                repositoryId: inputs.config.repositoryId,
                taskId: "another",
                taskDigest: persisted.taskDigest,
                configDigest: persisted.configDigest,
                baseCommit: persisted.baseCommit,
                deadlineAt: persisted.deadlineAt,
              }),
            ).toThrow("Reconcile the recorded external effect");
            expect(() =>
              store.admitWorkerInvocation({
                runId,
                invocationId: "new-worker",
                phase: "repair",
                envelopeDigest: `sha256:${"a".repeat(64)}`,
                envelopeJson: "{}",
              }),
            ).toThrow("Reconcile the recorded external effect");
            const backup = await store.backup();
            await expect(
              restoreStateBackup(inputs.config.repositoryId, common, backup),
            ).rejects.toMatchObject({ code: "GITHUB_RECONCILIATION_REQUIRED" });
            expect(() =>
              store.transition(runId, "blocked", "test.feedback"),
            ).toThrow();
            expect(() => store.beginRepair(runId)).toThrow();
            await expect(
              purgeRepositoryState(inputs.config.repositoryId, common),
            ).rejects.toMatchObject({ code: "GITHUB_RECONCILIATION_REQUIRED" });
          } finally {
            store.close();
          }
          expect((await cancelRun(input)).status).toBe("awaiting_human");
          expect((await fixtureDelivery(fixture, runId)).mergeApproval).toEqual(
            before.mergeApproval,
          );
          await expect(
            statePurge({
              root: fixture.root,
              confirmation: inputs.config.repositoryId,
            }),
          ).rejects.toMatchObject({ code: "GITHUB_RECONCILIATION_REQUIRED" });
          expect((await reconcileMerge(input)).state).toBe("merged");
          await expect(resumeRun(input)).rejects.toMatchObject({
            code: "MERGE_FINALIZATION_REQUIRED",
          });
          adapter.mergeChecks = [
            { ...check, event: "push", headSha: "c".repeat(40) },
          ];
          expect((await finalizeDraftPr(input)).run.status).toBe("closed");
          expect(adapter.mergeCalls).toBe(1);
          return;
        } else {
          expect(
            (
              await applyMerge({
                ...input,
                approvalDigest: fresh.digest,
                attended: true,
              })
            ).state,
          ).toBe("merged");
        }
        await expect(
          applyMerge({
            ...input,
            approvalDigest: fresh.digest,
            attended: true,
          }),
        ).rejects.toMatchObject({ code: "MERGE_APPROVAL_INVALID" });
        expect((await reconcileMerge(input)).state).toBe("merged");
        expect(adapter.readyCalls).toBe(1);
        expect(adapter.mergeCalls).toBe(1);
        adapter.mergeChecks = [
          { ...check, event: "push", headSha: "c".repeat(40) },
        ];
        expect((await finalizeDraftPr(input)).run.status).toBe("closed");
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("does not enable merge through an existing draft-only grant", async () => {
    const { fixture, runId } = await reviewedFixture();
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
    try {
      await planAndOpen({ fixture, runId, adapter });
      await expect(
        planMerge({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter,
          method: "squash",
        }),
      ).rejects.toMatchObject({ code: "ATTENDED_MERGE_DISABLED" });
    } finally {
      await fixture.cleanup();
    }
  });

  it.each(["normal", "interrupted", "advisory"])(
    "refreshes a local review missing GitHub preparation without changing the candidate (%s)",
    async (scenario) => {
      const { fixture, runId } = await reviewedFixture({
        postMergeRequiredChecks: ["validate"],
        ...(scenario === "advisory"
          ? { advisoryReview: true, reviewBlocking: "p0_p1" as const }
          : {}),
      });
      const base = (
        await git(fixture.root, ["rev-parse", "main"])
      ).stdout.trim();
      const adapter = new FakeGitHub(base);
      const input = {
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      };
      try {
        const plan = await planDraftPr(input);
        adapter.defaultBranchHead = (
          await git(fixture.root, ["rev-parse", "main^"])
        ).stdout.trim();
        await expect(
          openDraftPr({
            ...input,
            approvalDigest: plan.delivery.proposalDigest,
            attended: true,
          }),
        ).rejects.toMatchObject({ code: "REVIEW_SCOPE_STALE" });
        await expect(planDraftPr(input)).rejects.toMatchObject({
          code: "REVIEW_SCOPE_STALE",
        });
        expect(adapter.pushCalls).toBe(0);
        expect(adapter.createCalls).toBe(0);
        const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
        const store = await StateStore.open(
          inputs.config.repositoryId,
          await commonGitDirectory(fixture.root),
        );
        const original = store.getRun(runId);
        store.close();
        const refreshInput = {
          ...input,
          refresh: true,
          baseCommit: adapter.defaultBranchHead,
          attended: true,
        };
        await expect(
          reviewRun({ ...refreshInput, attended: false }),
        ).rejects.toMatchObject({ code: "ATTENDANCE_REQUIRED" });
        await expect(
          reviewRun({ ...refreshInput, baseCommit: "main" }),
        ).rejects.toMatchObject({ code: "REVIEW_BASE_REQUIRED" });
        await expect(
          reviewRun({ ...refreshInput, baseCommit: base }),
        ).rejects.toMatchObject({ code: "REVIEW_REFRESH_NOT_REQUIRED" });
        if (scenario === "normal") {
          const probeStore = await StateStore.open(
            inputs.config.repositoryId,
            await commonGitDirectory(fixture.root),
          );
          const db = new DatabaseSync(
            path.join(probeStore.directory, "state.sqlite3"),
          );
          try {
            db.exec(
              "CREATE TRIGGER fail_refresh BEFORE INSERT ON run_events WHEN NEW.type = 'review.refresh_prepared' BEGIN SELECT RAISE(ABORT, 'refresh fault'); END;",
            );
            await expect(reviewRun(refreshInput)).rejects.toMatchObject({
              code: "STATE_WRITE_FAILED",
            });
            expect(probeStore.getRun(runId)).toEqual(original);
            db.exec("DROP TRIGGER fail_refresh;");
          } finally {
            db.close();
            probeStore.close();
          }
        }
        if (scenario === "interrupted") {
          // eslint-disable-next-line @typescript-eslint/unbound-method
          const prepare = StateStore.prototype.prepareReviewRefresh;
          const fault = vi
            .spyOn(StateStore.prototype, "prepareReviewRefresh")
            .mockImplementation(function (this: StateStore, ...args) {
              prepare.apply(this, args);
              throw new Error("interrupted after refresh preparation");
            });
          try {
            await expect(reviewRun(refreshInput)).rejects.toThrow(
              "interrupted after refresh preparation",
            );
          } finally {
            fault.mockRestore();
          }
        }
        let refreshed: Awaited<ReturnType<typeof reviewRun>>;
        if (scenario === "interrupted") refreshed = await reviewRun(input);
        else {
          const output: string[] = [];
          const errors: string[] = [];
          expect(
            await runCli(
              [
                "--json",
                "--cwd",
                fixture.root,
                "review",
                "--task",
                fixture.taskPath,
                "--run",
                runId,
                "--refresh",
                "--base",
                adapter.defaultBranchHead,
                "--attended",
              ],
              {
                stdout: { write: (value) => void output.push(value) },
                stderr: { write: (value) => void errors.push(value) },
              },
            ),
          ).toBe(0);
          expect(errors).toEqual([]);
          const envelope = JSON.parse(output.join("")) as {
            data: Awaited<ReturnType<typeof reviewRun>>;
          };
          expect(envelope).toMatchObject({ command: "review", ok: true });
          refreshed = envelope.data;
        }
        expect(refreshed.run.status).toBe("reviewed");
        expect(refreshed.review.scope?.baseCommit).toBe(
          adapter.defaultBranchHead,
        );
        const afterStore = await StateStore.open(
          inputs.config.repositoryId,
          await commonGitDirectory(fixture.root),
        );
        try {
          expect(afterStore.getRun(runId)).toMatchObject({
            candidateCommit: original.candidateCommit,
            candidateTree: original.candidateTree,
            validationJson: original.validationJson,
            deadlineAt: original.deadlineAt,
            repairCount: original.repairCount,
          });
          const receipt = afterStore
            .events(runId)
            .find((event) => event.type === "review.refresh_prepared");
          expect(receipt?.data).toMatchObject({
            previousReviewJson: original.reviewJson,
            previousDeliveryJson: original.deliveryJson,
          });
        } finally {
          afterStore.close();
        }
        await expect(
          reviewRun({ ...refreshInput, baseCommit: base }),
        ).rejects.toMatchObject({ code: "REVIEW_RETRY_BUDGET_EXHAUSTED" });
        expect(
          (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
        ).toBe(base);
        await expect(
          openDraftPr({
            ...input,
            approvalDigest: plan.delivery.proposalDigest,
            attended: true,
          }),
        ).rejects.toMatchObject({ code: "DELIVERY_NOT_APPLICABLE" });
        const freshPlan = await planDraftPr(input);
        const opened = await openDraftPr({
          ...input,
          approvalDigest: freshPlan.delivery.proposalDigest,
          attended: true,
        });
        expect(opened.run.status).toBe("awaiting_ci");
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("requires an exact attended proposal and closes only after merge readback", async () => {
    const { fixture, runId, candidateTree } = await reviewedFixture();
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
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
          attended: true,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "DELIVERY_APPROVAL_MISMATCH" });
      expect(adapter).toMatchObject({ pushCalls: 0, createCalls: 0 });
      const opened = await openDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        approvalDigest: planned.delivery.proposalDigest,
        attended: true,
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
      if (adapter.pullRequest === null) throw new Error("fake PR missing");
      adapter.pullRequest = {
        ...adapter.pullRequest,
        mergedByLogin: "automation-bot",
      };
      await expect(
        finalizeDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "MERGER_NOT_ALLOWED" });
      adapter.pullRequest = {
        ...adapter.pullRequest,
        mergedByLogin: "operator",
      };
      const finalized = await finalizeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(finalized.run.status).toBe("closed");
      expect(finalized.delivery).toMatchObject({
        state: "closed",
        merge: {
          method: "linear_tree_preserving",
          mergedByLogin: "operator",
          tree: candidateTree,
        },
      });
      const loaded = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      if (loaded.continuity === undefined)
        throw new Error("missing continuity");
      const closurePlan = {
        schemaVersion: "1",
        productContractDigest: canonicalDigest(
          loaded.continuity.product as JsonValue,
        ),
        outcomes: [
          {
            id: loaded.continuity.impact.outcomeId,
            title: "Value outcome",
            acceptance: ["value remains positive"],
            dependsOn: [],
            status: "ready",
            taskRef: fixture.taskPath,
          },
          {
            id: "OUT-NEXT",
            title: "Next approved outcome",
            acceptance: ["next behavior"],
            dependsOn: [loaded.continuity.impact.outcomeId],
            status: "approved",
          },
        ],
      };
      await writeFile(
        path.join(fixture.root, "product/plan.yaml"),
        yaml(closurePlan),
      );
      await git(fixture.root, ["add", "product/plan.yaml"]);
      await git(fixture.root, [
        "commit",
        "-m",
        "test: record approved outcome plan",
      ]);
      await expect(
        planOutcomeClosure({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          nextOutcomeId: "OUT-NEXT",
        }),
      ).rejects.toMatchObject({ code: "OUTCOME_NEXT_TASK_REQUIRED" });
      const closure = await planOutcomeClosure({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
      });
      expect(closure.authority).toBe("proposal_only");
      const closureFile = closure.files[0];
      if (closureFile === undefined) throw new Error("missing closure file");
      expect(
        outcomePlanSchema
          .parse(parseYaml(closureFile.content))
          .outcomes.map((item: { status: string }) => item.status),
      ).toEqual(["closed", "approved"]);
      expect(
        await readFile(path.join(fixture.root, "product/plan.yaml"), "utf8"),
      ).toBe(yaml(closurePlan));
      await expect(
        planOutcomeClosure({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          nextOutcomeId: "OUT-ABSENT",
        }),
      ).rejects.toMatchObject({ code: "OUTCOME_NEXT_NOT_APPROVED" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("marks a bound next packet ready and rejects another outcome's packet", async () => {
    const nextTaskPath = "product/tasks/next.yaml";
    const { fixture, runId, candidateTree } = await reviewedFixture({
      async prepare(prepared) {
        const { task, continuity } = await rewriteFixtureAuthority(
          prepared,
          ({ product }) => {
            product.outcomes.push({
              id: "OUT-NEXT",
              statement: "Preserve the positive value in the next change.",
              acceptanceIds: ["ACC-POSITIVE"],
            });
          },
        );
        const nextImpact = structuredClone(continuity.impact);
        nextImpact.id = "next-value";
        nextImpact.outcomeId = "OUT-NEXT";
        if (nextImpact.approval === null) throw new Error("missing approval");
        nextImpact.approval.proposalDigest = canonicalDigest({
          ...nextImpact,
          approval: null,
        });
        const nextImpactSource = yaml(nextImpact);
        const nextTask = structuredClone(task);
        nextTask.id = "next-value";
        nextTask.authority.impactManifest = {
          path: "product/next-impact.yaml",
          digest: textDigest(nextImpactSource),
        };
        await writeFile(
          path.join(prepared.root, nextTask.authority.impactManifest.path),
          nextImpactSource,
        );
        await writeFile(path.join(prepared.root, nextTaskPath), yaml(nextTask));
        await git(prepared.root, ["add", "."]);
        await git(prepared.root, ["commit", "-m", "test: approve next packet"]);
      },
    });
    try {
      const adapter = new FakeGitHub(
        (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
      );
      const deliveryInput = {
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      };
      await planAndOpen({ fixture, runId, adapter });
      adapter.checks = [completedCheck("success")];
      await observeDraftPr(deliveryInput);
      adapter.merge(candidateTree);
      adapter.mergeChecks = [completedCheck("success")];
      expect((await finalizeDraftPr(deliveryInput)).run.status).toBe("closed");
      const loaded = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      if (loaded.continuity === undefined)
        throw new Error("missing continuity");
      const plan = outcomePlanSchema.parse({
        schemaVersion: "1",
        productContractDigest: canonicalDigest(
          loaded.continuity.product as JsonValue,
        ),
        outcomes: [
          {
            id: "OUT-POSITIVE-VALUE",
            title: "Current outcome",
            acceptance: ["The value remains positive."],
            acceptanceIds: ["ACC-POSITIVE"],
            dependsOn: [],
            status: "ready",
            taskRef: fixture.taskPath,
          },
          {
            id: "OUT-NEXT",
            title: "Next approved outcome",
            acceptance: ["The value remains positive."],
            acceptanceIds: ["ACC-POSITIVE"],
            dependsOn: ["OUT-POSITIVE-VALUE"],
            status: "approved",
            taskRef: nextTaskPath,
          },
        ],
      });
      const planPath = path.join(fixture.root, "product/plan.yaml");
      await writeFile(planPath, yaml(plan));
      await git(fixture.root, ["add", "product/plan.yaml"]);
      await git(fixture.root, [
        "commit",
        "-m",
        "test: approve outcome sequence",
      ]);
      const closureInput = { ...deliveryInput, nextOutcomeId: "OUT-NEXT" };
      const closure = await planOutcomeClosure(closureInput);
      const closureFile = closure.files[0];
      if (closureFile === undefined) throw new Error("missing closure file");
      expect(
        outcomePlanSchema
          .parse(parseYaml(closureFile.content))
          .outcomes.map((outcome) => outcome.status),
      ).toEqual(["closed", "ready"]);
      expect(await readFile(planPath, "utf8")).toBe(yaml(plan));

      const next = plan.outcomes[1];
      if (next === undefined) throw new Error("missing next outcome");
      next.taskRef = fixture.taskPath;
      await writeFile(planPath, yaml(plan));
      await git(fixture.root, ["add", "product/plan.yaml"]);
      await git(fixture.root, ["commit", "-m", "test: bind wrong next packet"]);
      await expect(planOutcomeClosure(closureInput)).rejects.toMatchObject({
        code: "OUTCOME_TASK_AUTHORITY_MISMATCH",
      });
      expect(await readFile(planPath, "utf8")).toBe(yaml(plan));
    } finally {
      await fixture.cleanup();
    }
  });

  it("binds distinct resulting-main checks into a new delivery proposal", async () => {
    const { fixture, runId, candidateTree } = await reviewedFixture({
      requiredChecks: ["validate", "dependency-review", "codeql"],
      postMergeRequiredChecks: ["validate", "codeql"],
    });
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
    try {
      const planned = await planDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(planned.delivery).toMatchObject({
        requiredChecks: ["validate", "dependency-review", "codeql"],
        postMergeRequiredChecks: ["validate", "codeql"],
        postMergePolicySource: "configured",
      });
      await openDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        approvalDigest: planned.delivery.proposalDigest,
        attended: true,
        adapter,
      });
      adapter.checks = [
        completedCheck("success", "validate"),
        completedCheck("success", "dependency-review"),
        completedCheck("success", "codeql"),
      ];
      await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      adapter.merge(candidateTree);
      adapter.mergeChecks = [
        completedCheck("success", "validate"),
        completedCheck("success", "codeql"),
      ];
      const finalized = await finalizeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(finalized.run.status).toBe("closed");
    } finally {
      await fixture.cleanup();
    }
  });

  it("binds an empty effective post-merge list only for a no-check local policy", async () => {
    const { fixture, runId } = await reviewedFixture({ requiredChecks: [] });
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
    try {
      const planned = await planDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(planned.delivery).toMatchObject({
        requiredChecks: [],
        postMergeRequiredChecks: [],
        postMergePolicySource: "implicit_default",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("binds a subset-safe post-merge policy for a legacy merged delivery", async () => {
    const { fixture, runId, candidateTree } = await reviewedFixture({
      requiredChecks: ["validate", "dependency-review", "codeql"],
    });
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
    try {
      await planAndOpen({ fixture, runId, adapter });
      await seedLegacyPostMergeDelivery(fixture, runId);
      adapter.checks = [
        completedCheck("success", "validate"),
        completedCheck("success", "dependency-review"),
        completedCheck("success", "codeql"),
      ];
      await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      await configureProposeCheckPolicy(fixture, {
        postMergeRequiredChecks: ["validate", "codeql"],
      });
      await expect(
        finalizeDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "HUMAN_MERGE_PENDING" });
      expect(await fixtureDelivery(fixture, runId)).not.toHaveProperty(
        "postMergeRequiredChecks",
      );
      adapter.merge(candidateTree);
      adapter.mergeChecks = [
        completedCheck("success", "validate"),
        completedCheck("skipped", "dependency-review"),
        completedCheck("success", "codeql"),
      ];
      const finalized = await finalizeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(finalized).toMatchObject({
        run: { status: "closed" },
        delivery: {
          postMergeRequiredChecks: ["validate", "codeql"],
          postMergePolicySource: "legacy_migrated",
        },
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("migrates a proven implicit-default policy exactly once after merge", async () => {
    const { fixture, runId, candidateTree } = await reviewedFixture({
      requiredChecks: ["validate", "dependency-review", "codeql"],
    });
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
    try {
      const planned = await planDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(planned.delivery.postMergePolicySource).toBe("implicit_default");
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const store = await StateStore.open(
        inputs.config.repositoryId,
        await commonGitDirectory(fixture.root),
      );
      try {
        const run = store.getRun(runId);
        if (run.deliveryJson === undefined) {
          throw new Error("delivery record is missing");
        }
        const legacy = JSON.parse(run.deliveryJson) as Record<string, unknown>;
        delete legacy.postMergePolicySource;
        store.setDelivery(
          runId,
          JSON.stringify(legacy),
          "test.implicit_default_delivery_seeded",
        );
      } finally {
        store.close();
      }
      await openDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        approvalDigest: planned.delivery.proposalDigest,
        attended: true,
        adapter,
      });
      adapter.checks = [
        completedCheck("success", "validate"),
        completedCheck("success", "dependency-review"),
        completedCheck("success", "codeql"),
      ];
      await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      adapter.merge(candidateTree);
      await configureProposeCheckPolicy(fixture, {
        postMergeRequiredChecks: ["validate", "codeql"],
      });
      adapter.mergeChecks = [
        completedCheck("success", "validate"),
        completedCheck("skipped", "dependency-review"),
        completedCheck("success", "codeql"),
      ];
      const finalized = await finalizeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(finalized).toMatchObject({
        run: { status: "closed" },
        delivery: {
          postMergeRequiredChecks: ["validate", "codeql"],
          postMergePolicySource: "legacy_migrated",
        },
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not migrate an explicitly configured full post-merge policy", async () => {
    const { fixture, runId, candidateTree } = await reviewedFixture({
      requiredChecks: ["validate", "dependency-review", "codeql"],
      postMergeRequiredChecks: ["validate", "dependency-review", "codeql"],
    });
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
    try {
      await planAndOpen({ fixture, runId, adapter });
      adapter.checks = [
        completedCheck("success", "validate"),
        completedCheck("success", "dependency-review"),
        completedCheck("success", "codeql"),
      ];
      await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      adapter.merge(candidateTree);
      await configureProposeCheckPolicy(fixture, {
        postMergeRequiredChecks: ["validate", "codeql"],
      });
      await expect(
        finalizeDraftPr({
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

  it("enforces attendance inside the exported mutation boundary", async () => {
    const { fixture, runId } = await reviewedFixture();
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
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
          attended: false,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "ATTENDED_ACKNOWLEDGEMENT_REQUIRED" });
      expect(adapter).toMatchObject({
        inspectCalls: 1,
        pushCalls: 0,
        createCalls: 0,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("makes cancellation durable before proposal planning", async () => {
    const { fixture, runId } = await reviewedFixture();
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
    try {
      const cancelled = await cancelRun({ root: fixture.root, runId });
      expect(cancelled).toMatchObject({
        status: "cancelled",
        cancelRequested: true,
      });
      await expect(
        planDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "RUN_NOT_REVIEWED" });
      expect(adapter.inspectCalls).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("cancels an ordinary human-decision checkpoint without erasing its draft receipt", async () => {
    const { fixture, runId } = await reviewedFixture();
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
    try {
      await planAndOpen({ fixture, runId, adapter });
      adapter.checks = [completedCheck("success")];
      const ready = await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(ready.run.status).toBe("awaiting_human");
      const pullRequestUrl = adapter.pullRequest?.url;
      expect(pullRequestUrl).toBeTypeOf("string");

      await expect(
        cancelRun({ root: fixture.root, runId }),
      ).resolves.toMatchObject({
        status: "cancelled",
        cancelRequested: true,
      });
      await expect(
        cancelRun({ root: fixture.root, runId }),
      ).resolves.toMatchObject({
        status: "cancelled",
        cancelRequested: true,
      });
      const store = await StateStore.open(
        (await loadRuntimeInputs(fixture.root, fixture.taskPath)).config
          .repositoryId,
        await commonGitDirectory(fixture.root),
      );
      try {
        expect(store.getRun(runId).deliveryJson).toContain(pullRequestUrl);
      } finally {
        store.close();
      }

      const qualification = await qualifyBaseline({
        root: fixture.root,
        taskPath: fixture.taskPath,
      });
      if (qualification.approvalDigest === null)
        throw new Error("fresh baseline qualification missing");
      await expect(
        startLocalRun({
          root: fixture.root,
          taskPath: fixture.taskPath,
          approvalDigest: qualification.approvalDigest,
        }),
      ).resolves.toMatchObject({ run: { status: "committed" } });
    } finally {
      await fixture.cleanup();
    }
  });

  it("honors durable cancellation before a subsequent remote effect", async () => {
    const { fixture, runId } = await reviewedFixture();
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
    try {
      const planned = await planDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      adapter.onPush = async () => {
        const cancellation = await cancelRun({ root: fixture.root, runId });
        expect(cancellation.cancelRequested).toBe(true);
      };
      await expect(
        openDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          approvalDigest: planned.delivery.proposalDigest,
          attended: true,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "OPERATOR_CANCELLED" });
      expect(adapter).toMatchObject({
        pushCalls: 1,
        createCalls: 0,
        pullRequest: null,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("reconciles an unknown effect before making cancellation terminal", async () => {
    const { fixture, runId, candidateCommit } = await reviewedFixture();
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
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
          attended: true,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "FAKE_PUSH_INTERRUPTED" });
      const pending = await cancelRun({ root: fixture.root, runId });
      expect(pending).toMatchObject({
        status: "effect_unknown",
        cancelRequested: true,
      });
      await expect(
        resumeRun({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
        }),
      ).rejects.toMatchObject({ code: "GITHUB_RECONCILIATION_REQUIRED" });
      await expect(
        runStatus({ root: fixture.root, runId }),
      ).resolves.toMatchObject({
        run: { status: "effect_unknown", cancelRequested: true },
        reconciliationRequired: true,
      });
      adapter.branchSha = candidateCommit;
      await expect(
        reconcileDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "OPERATOR_CANCELLED" });
      expect(adapter).toMatchObject({ createCalls: 0, pullRequest: null });
    } finally {
      await fixture.cleanup();
    }
  });

  it("recovers effects completed before their receipts without duplication", async () => {
    const { fixture, runId } = await reviewedFixture();
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
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

  it("authorizes one retry only after readback proves the effect absent", async () => {
    const { fixture, runId } = await reviewedFixture();
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
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
          attended: true,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "FAKE_PUSH_INTERRUPTED" });
      expect(adapter).toMatchObject({ pushCalls: 1, createCalls: 0 });
      const absent = await reconcileDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(absent.run.status).toBe("proposing");
      expect(absent.delivery.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "push",
            status: "retryable_absent",
            attemptCount: 1,
          }),
        ]),
      );
      expect(adapter).toMatchObject({ pushCalls: 1, createCalls: 0 });
      const opened = await openDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        approvalDigest: planned.delivery.proposalDigest,
        attended: true,
        adapter,
      });
      expect(opened.run.status).toBe("awaiting_ci");
      expect(adapter).toMatchObject({ pushCalls: 2, createCalls: 1 });
    } finally {
      await fixture.cleanup();
    }
  });

  it("retries one pull-request call only after readback proves absence", async () => {
    const { fixture, runId } = await reviewedFixture();
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
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
          attended: true,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "FAKE_PR_INTERRUPTED" });
      expect(adapter).toMatchObject({ pushCalls: 1, createCalls: 1 });
      const absent = await reconcileDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(absent.run.status).toBe("proposing");
      const opened = await openDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        approvalDigest: planned.delivery.proposalDigest,
        attended: true,
        adapter,
      });
      expect(opened.run.status).toBe("awaiting_ci");
      expect(adapter).toMatchObject({ pushCalls: 1, createCalls: 2 });
    } finally {
      await fixture.cleanup();
    }
  });

  it("blocks after the single readback-authorized remote retry is exhausted", async () => {
    const { fixture, runId } = await reviewedFixture();
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
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
          attended: true,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "FAKE_PUSH_INTERRUPTED" });
      await reconcileDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      adapter.pushFailure = "before";
      await expect(
        openDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          approvalDigest: planned.delivery.proposalDigest,
          attended: true,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "FAKE_PUSH_INTERRUPTED" });
      const exhausted = await reconcileDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(exhausted.run).toMatchObject({
        status: "blocked",
        blockCode: "REMOTE_EFFECT_RETRY_EXHAUSTED",
      });
      expect(exhausted.delivery).toMatchObject({
        state: "blocked",
        lastErrorCode: "REMOTE_EFFECT_RETRY_EXHAUSTED",
      });
      expect(adapter).toMatchObject({ pushCalls: 2, createCalls: 0 });
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed for identity drift and every non-success required check", async () => {
    const { fixture, runId } = await reviewedFixture();
    const changedActor = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
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

      const fork = new FakeGitHub(
        (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
      );
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

      const adapter = new FakeGitHub(
        (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
      );
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
          "allowedMergeMethods: [linear_tree_preserving]",
          "allowedMergeMethods: [merge]",
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

  it("replaces stale blocker identity when remote observations change", async () => {
    const { fixture, runId, candidateCommit } = await reviewedFixture({
      githubReviewer: "codex-review",
    });
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
    try {
      await planAndOpen({ fixture, runId, adapter });
      adapter.checks = [completedCheck("failure")];
      const checksBlocked = await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(checksBlocked.run.blockCode).toBe("REMOTE_CHECKS_FAILED");

      adapter.checks = [completedCheck("success")];
      adapter.feedback = [
        {
          id: "blocker-change",
          actorLogin: "codex-review",
          priority: "P1",
          body: "[P1] Current-head repair required",
          path: "src/value.js",
          line: 1,
          url: "https://github.com/example/app/pull/41#discussion_blocker-change",
          commitId: candidateCommit,
        },
      ];
      const reviewBlocked = await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(reviewBlocked.run.blockCode).toBe("REMOTE_REVIEW_FINDINGS");

      adapter.feedback = [];
      adapter.checks = [completedCheck("failure")];
      const checksBlockedAgain = await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(checksBlockedAgain.run.blockCode).toBe("REMOTE_CHECKS_FAILED");
      await expect(
        resumeRun({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
        }),
      ).rejects.toMatchObject({ code: "RUN_REQUIRES_HUMAN_DISPOSITION" });
    } finally {
      await fixture.cleanup();
    }
  }, 10_000);

  it("repairs one aggregated remote review and updates the same pull request", async () => {
    const { fixture, runId, candidateCommit } = await reviewedFixture({
      githubReviewer: "codex-review",
    });
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
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
        {
          id: "review-13",
          actorLogin: "codex-review",
          priority: "P2",
          body: "[P2] Address the top-level review finding",
          path: null,
          line: null,
          url: "https://github.com/example/app/pull/41#pullrequestreview-13",
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
          id: "21",
          actorLogin: "codex-review",
          state: "COMMENTED",
          commitId: reviewed.run.candidateCommit,
          body: "",
          url: "https://github.com/example/app/pull/41#pullrequestreview-21",
        },
        {
          id: "22",
          actorLogin: "codex-review",
          state: "CHANGES_REQUESTED",
          commitId: reviewed.run.candidateCommit,
          body: "",
          url: "https://github.com/example/app/pull/41#pullrequestreview-22",
        },
      ];
      const planned = await planDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      if (adapter.pullRequest === null) throw new Error("fake PR missing");
      const priorPullRequest = adapter.pullRequest;
      adapter.branchSha = reviewed.run.candidateCommit;
      adapter.pullRequest = {
        ...priorPullRequest,
        number: 42,
        nodeId: "PR_replacement",
        headSha: reviewed.run.candidateCommit,
      };
      const pushCallsBeforeResume = adapter.pushCalls;
      await expect(
        openDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          approvalDigest: planned.delivery.proposalDigest,
          attended: true,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "PULL_REQUEST_IDENTITY_MISMATCH" });
      expect(adapter.pushCalls).toBe(pushCallsBeforeResume);
      adapter.branchSha = candidateCommit;
      adapter.pullRequest = priorPullRequest;
      adapter.pushFailure = "before";
      await expect(
        openDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          approvalDigest: planned.delivery.proposalDigest,
          attended: true,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "FAKE_PUSH_INTERRUPTED" });
      expect(adapter.pullRequest.headSha).toBe(candidateCommit);
      for (const conflictingPullRequest of [
        { ...priorPullRequest, draft: false },
        { ...priorPullRequest, state: "closed" as const, draft: false },
        {
          ...priorPullRequest,
          state: "closed" as const,
          draft: false,
          merged: true,
          mergeCommitSha: "c".repeat(40),
          mergedByLogin: "operator",
          mergedAt: "2026-09-01T17:00:00.000Z",
        },
      ]) {
        adapter.pullRequest = conflictingPullRequest;
        await expect(
          reconcileDraftPr({
            root: fixture.root,
            taskPath: fixture.taskPath,
            runId,
            adapter,
          }),
        ).rejects.toMatchObject({ code: "PULL_REQUEST_IDENTITY_MISMATCH" });
        await expect(
          runStatus({ root: fixture.root, runId }),
        ).resolves.toMatchObject({
          run: { status: "effect_unknown" },
          reconciliationRequired: true,
        });
      }
      adapter.branchSha = reviewed.run.candidateCommit;
      adapter.pullRequest = {
        ...priorPullRequest,
        number: 42,
        nodeId: "PR_replacement",
        headSha: reviewed.run.candidateCommit,
      };
      await expect(
        reconcileDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "PULL_REQUEST_IDENTITY_MISMATCH" });
      adapter.branchSha = candidateCommit;
      adapter.pullRequest = priorPullRequest;
      const reconciled = await reconcileDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(reconciled.run.status).toBe("proposing");
      expect(reconciled.delivery.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "push",
            status: "retryable_absent",
            attemptCount: 1,
          }),
        ]),
      );
      adapter.pullRequest = { ...priorPullRequest, draft: false };
      await expect(
        openDraftPr({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId,
          approvalDigest: planned.delivery.proposalDigest,
          attended: true,
          adapter,
        }),
      ).rejects.toMatchObject({ code: "PULL_REQUEST_IDENTITY_MISMATCH" });
      expect(adapter).toMatchObject({
        branchSha: candidateCommit,
        pushCalls: 2,
      });
      adapter.pullRequest = priorPullRequest;
      const reopened = await openDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        approvalDigest: planned.delivery.proposalDigest,
        attended: true,
        adapter,
      });
      expect(reopened.delivery.pullRequest?.number).toBe(41);
      expect(adapter).toMatchObject({ pushCalls: 3, createCalls: 1 });
      const changesRequested = await observeDraftPr({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId,
        adapter,
      });
      expect(changesRequested.run.status).toBe("awaiting_ci");
      adapter.reviews.push({
        id: "23",
        actorLogin: "codex-review",
        state: "APPROVED",
        commitId: reviewed.run.candidateCommit,
        body: "",
        url: "https://github.com/example/app/pull/41#pullrequestreview-23",
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
  }, 10_000);

  it("retains hosted advisories while requiring explicit approval", async () => {
    const { fixture, runId, candidateCommit } = await reviewedFixture({
      reviewBlocking: "p0_p1",
      advisoryReview: true,
      githubReviewer: "codex-review",
    });
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
    const input = {
      root: fixture.root,
      taskPath: fixture.taskPath,
      runId,
      adapter,
    };
    try {
      await planAndOpen({ fixture, runId, adapter });
      adapter.checks = [completedCheck("success")];
      adapter.feedback = [
        {
          id: "p2",
          actorLogin: "codex-review",
          priority: "P2",
          body: "Optional",
          path: null,
          line: null,
          url: "https://github.com/example/app/pull/41#discussion_r1",
          commitId: candidateCommit,
        },
      ];
      adapter.reviews = [
        {
          id: "rejected",
          actorLogin: "codex-review",
          state: "CHANGES_REQUESTED",
          commitId: candidateCommit,
          body: "",
          url: "https://github.com/example/app/pull/41#pullrequestreview-1",
        },
      ];
      expect((await observeDraftPr(input)).run.status).not.toBe(
        "awaiting_human",
      );
      if (adapter.reviews[0] === undefined || adapter.feedback[0] === undefined)
        throw new Error("missing review fixture");
      adapter.reviews.push({
        ...adapter.reviews[0],
        id: "approved",
        state: "APPROVED",
      });
      const ready = await observeDraftPr(input);
      expect(ready.run.status).toBe("awaiting_human");
      expect(ready.delivery.observation).toMatchObject({
        feedback: adapter.feedback,
      });
      expect(
        actionableFeedback(
          {
            ...(await adapter.observe()),
            feedback: [{ ...adapter.feedback[0], priority: "unclassified" }],
          },
          { mode: "github_required", requiredReviewerLogins: ["codex-review"] },
          candidateCommit,
          "p0_p1",
        ),
      ).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires an explicit approval and retains unclassified top-level feedback", () => {
    const candidateCommit = "a".repeat(40);
    const observation = {
      reviews: [
        {
          id: "top-level",
          actorLogin: "codex-review",
          state: "COMMENTED",
          commitId: candidateCommit,
          body: "This can select the wrong owner.",
          url: "https://github.com/example/app/pull/41#pullrequestreview-1",
        },
      ] as GitHubReview[],
      feedback: [
        {
          id: "review-top-level",
          actorLogin: "codex-review",
          priority: "unclassified" as const,
          body: "This can select the wrong owner.",
          path: null,
          line: null,
          url: "https://github.com/example/app/pull/41#pullrequestreview-1",
          commitId: candidateCommit,
        },
      ],
    } as Pick<GitHubObservation, "reviews" | "feedback"> as GitHubObservation;
    const policy = {
      mode: "github_required" as const,
      requiredReviewerLogins: ["codex-review"],
    };

    expect(reviewsPassed(observation, policy, candidateCommit)).toBe(false);
    expect(actionableFeedback(observation, policy, candidateCommit)).toEqual(
      observation.feedback,
    );
    const firstReview = observation.reviews.at(0);
    if (firstReview === undefined) throw new Error("missing fixture review");
    expect(
      reviewsPassed(
        {
          ...observation,
          reviews: [
            {
              ...firstReview,
              state: "APPROVED",
              body: "",
            },
          ],
        },
        policy,
        candidateCommit,
      ),
    ).toBe(true);
    expect(
      reviewsPassed(
        {
          ...observation,
          reviews: [
            {
              ...firstReview,
              state: "APPROVED",
              body: "",
            },
            {
              ...firstReview,
              id: "codex-summary",
              state: "CODEX_COMPLETED",
              body: "",
            },
          ],
        },
        policy,
        candidateCommit,
      ),
    ).toBe(true);
  });

  it("requires exact-head GitHub Codex completion and blocks only configured priorities", () => {
    const candidateCommit = "a".repeat(40);
    const policy = {
      mode: "github_codex_required",
      requiredReviewerLogins: ["chatgpt-codex-connector[bot]"],
    } as unknown as DeliveryRecord["reviewPolicy"];
    const observation = {
      reviews: [
        {
          id: "codex-summary",
          actorLogin: "chatgpt-codex-connector[bot]",
          state: "CODEX_COMPLETED",
          commitId: candidateCommit,
          body: "",
          url: "https://github.com/example/app/pull/41#issuecomment-1",
        },
      ],
      feedback: [],
    } as Pick<GitHubObservation, "reviews" | "feedback"> as GitHubObservation;

    expect(reviewsPassed(observation, policy, candidateCommit)).toBe(true);
    const completedReview = observation.reviews.at(0);
    if (completedReview === undefined)
      throw new Error("missing completed Codex review");
    expect(
      reviewsPassed(
        {
          ...observation,
          reviews: [
            ...observation.reviews,
            {
              ...completedReview,
              id: "codex-invalid",
              state: "CODEX_INVALID",
            },
          ],
        },
        policy,
        candidateCommit,
      ),
    ).toBe(false);
    expect(
      reviewsPassed(
        {
          ...observation,
          reviews: observation.reviews.map((review) => ({
            ...review,
            state: "CODEX_RUNNING",
          })),
        },
        policy,
        candidateCommit,
      ),
    ).toBe(false);
    expect(reviewsPassed(observation, policy, "b".repeat(40))).toBe(false);

    const feedback = (priority: "P1" | "P2"): GitHubFeedback => ({
      id: priority,
      actorLogin: "chatgpt-codex-connector[bot]",
      priority,
      body: `[${priority}] finding`,
      path: "src/index.ts",
      line: 1,
      url: `https://github.com/example/app/pull/41#discussion_${priority}`,
      commitId: candidateCommit,
    });
    expect(
      actionableFeedback(
        { ...observation, feedback: [feedback("P1")] },
        policy,
        candidateCommit,
        "p0_p1",
      ),
    ).toHaveLength(1);
    expect(
      actionableFeedback(
        { ...observation, feedback: [feedback("P2")] },
        policy,
        candidateCommit,
        "p0_p1",
      ),
    ).toHaveLength(0);
  });

  it("fails closed on PR drift and post-merge evidence until every identity settles", async () => {
    const { fixture, runId, candidateCommit, candidateTree } =
      await reviewedFixture();
    const adapter = new FakeGitHub(
      (await git(fixture.root, ["rev-parse", "main"])).stdout.trim(),
    );
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
