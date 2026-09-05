import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  cancelRun,
  qualifyBaseline,
  reviewRun,
  resumeRun,
  runStatus,
  startLocalRun,
  statePurge,
  supportBundle,
  verifyRun,
} from "../src/runtime/lifecycle.js";
import { buildContextManifest } from "../src/runtime/context.js";
import { loadRuntimeInputs } from "../src/runtime/inputs.js";
import {
  captureGitControlState,
  commonGitDirectory,
  createCandidateWorktree,
  qualifyRepositoryForBuild,
} from "../src/runtime/repository.js";
import { acquireWriterLease, StateStore } from "../src/runtime/state.js";
import { runProcess, type ActiveProcess } from "../src/runtime/process.js";
import { runtimeFixture } from "./runtime-fixture.js";

const original = {
  state: process.env.MILL_STATE_HOME,
  codex: process.env.MILL_CODEX_PATH,
  docker: process.env.MILL_DOCKER_PATH,
};
const execFileAsync = promisify(execFile);

async function git(root: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Mill Test",
      "-c",
      "user.email=mill-test@example.invalid",
      ...args,
    ],
    { cwd: root },
  );
  return result.stdout;
}

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

async function qualifiedApproval(
  fixture: Awaited<ReturnType<typeof runtimeFixture>>,
): Promise<string> {
  const qualified = await qualifyBaseline({
    root: fixture.root,
    taskPath: fixture.taskPath,
  });
  expect(qualified.evidence.passed).toBe(true);
  expect(qualified.approvalDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  if (qualified.approvalDigest === null) {
    throw new Error("successful baseline returned no approval digest");
  }
  return qualified.approvalDigest;
}

describe("local delivery lifecycle", () => {
  it("repairs a committed native failure once and retains its original evidence and deadline", async () => {
    const fixture = await runtimeFixture({ nativeRepair: true });
    activate(fixture);
    try {
      const started = await startLocalRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        approvalDigest: await qualifiedApproval(fixture),
      });
      const input = {
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId: started.run.id,
      };
      const failed = await verifyRun(input);
      expect(failed.run.blockCode).toBe("VALIDATION_FAILED");
      const repaired = await resumeRun(input);
      expect(repaired).toMatchObject({
        status: "committed",
        repairCount: 1,
        deadlineAt: started.run.deadlineAt,
      });
      expect(repaired.candidateCommit).not.toBe(started.run.candidateCommit);
      expect((await verifyRun(input)).evidence.passed).toBe(true);
      expect((await reviewRun(input)).run.status).toBe("reviewed");
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const store = await StateStore.open(
        inputs.config.repositoryId,
        await commonGitDirectory(fixture.root),
      );
      try {
        expect(
          store
            .events(started.run.id)
            .find((event) => event.type === "repair.started"),
        ).toMatchObject({
          data: {
            candidateCommit: started.run.candidateCommit,
            failureCode: "VALIDATION_FAILED",
            validationJson: JSON.stringify(failed.evidence),
          },
        });
      } finally {
        store.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("reviews preparation commits outside the final task diff", async () => {
    const fixture = await runtimeFixture({ propose: true });
    activate(fixture);
    try {
      await git(fixture.root, ["switch", "-c", "codex/prepared"]);
      await writeFile(
        path.join(fixture.root, "preparation.md"),
        "A preparatory control change requiring independent review.\n",
      );
      await git(fixture.root, ["add", "preparation.md"]);
      await git(fixture.root, [
        "commit",
        "-m",
        "test: prepare a control change",
      ]);
      const started = await startLocalRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        approvalDigest: await qualifiedApproval(fixture),
      });
      const input = {
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId: started.run.id,
      };
      await verifyRun(input);
      const reviewed = await reviewRun(input);
      expect(reviewed.review.scope?.changedPaths).toEqual([
        "preparation.md",
        "src/value.js",
      ]);
      expect(reviewed.review.scope?.baseCommit).not.toBe(
        started.run.baseCommit,
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("turns an approved task into an exact committed, verified, reviewed candidate without changing the checkout", async () => {
    const fixture = await runtimeFixture();
    activate(fixture);
    try {
      await expect(
        startLocalRun({
          root: fixture.root,
          taskPath: fixture.taskPath,
          approvalDigest: `sha256:${"0".repeat(64)}`,
        }),
      ).rejects.toMatchObject({ code: "TASK_APPROVAL_REQUIRED" });
      const started = await startLocalRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        approvalDigest: await qualifiedApproval(fixture),
      });
      expect(started.run.status).toBe("committed");
      expect(started.run).not.toHaveProperty("worktreePath");
      expect(started.run).not.toHaveProperty("contextJson");
      expect(
        await readFile(path.join(fixture.root, "src/value.js"), "utf8"),
      ).toBe("export const value = 1;\n");
      const verified = await verifyRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId: started.run.id,
      });
      expect(verified.run.status).toBe("verified");
      expect(verified.evidence.passed).toBe(true);
      const reviewed = await reviewRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId: started.run.id,
      });
      expect(reviewed.run.status).toBe("reviewed");
      expect(reviewed.review.findings).toEqual([]);
      expect(reviewed.usage.cost).toBe("unavailable");
      const status = await runStatus({
        root: fixture.root,
        runId: started.run.id,
      });
      expect(status.run).toMatchObject({
        status: "reviewed",
        candidateCommit: started.run.candidateCommit,
      });
      expect(status.run).not.toHaveProperty("worktreePath");
      expect(status.run).not.toHaveProperty("contextJson");
      expect(status.continuation).toMatchObject({
        schemaVersion: "1",
        run: {
          id: started.run.id,
          status: "reviewed",
          candidateCommit: started.run.candidateCommit,
        },
        next: { action: "plan_draft_pr", attended: true },
      });
      expect(status.continuation).not.toHaveProperty("worktreePath");
    } finally {
      await fixture.cleanup();
    }
  });

  it("binds approval to one successful baseline, exact base, and command configuration", async () => {
    const changed = await runtimeFixture();
    activate(changed);
    try {
      const approvalDigest = await qualifiedApproval(changed);
      const configPath = path.join(changed.root, "mill.yaml");
      await writeFile(
        configPath,
        (await readFile(configPath, "utf8")).replace(
          "timeoutSeconds: 30",
          "timeoutSeconds: 29",
        ),
      );
      await git(changed.root, ["add", "mill.yaml"]);
      await git(changed.root, [
        "commit",
        "--no-gpg-sign",
        "-m",
        "change qualified command",
      ]);
      await expect(
        startLocalRun({
          root: changed.root,
          taskPath: changed.taskPath,
          approvalDigest,
        }),
      ).rejects.toMatchObject({ code: "TASK_APPROVAL_REQUIRED" });
    } finally {
      await changed.cleanup();
    }

    const failed = await runtimeFixture();
    activate(failed);
    try {
      await writeFile(
        path.join(failed.root, "src", "value.js"),
        "export const value = -1;\n",
      );
      await git(failed.root, ["add", "src/value.js"]);
      await git(failed.root, [
        "commit",
        "--no-gpg-sign",
        "-m",
        "break baseline",
      ]);
      const qualification = await qualifyBaseline({
        root: failed.root,
        taskPath: failed.taskPath,
      });
      expect(qualification).toMatchObject({
        approvalDigest: null,
        evidence: { passed: false },
      });
      await expect(
        startLocalRun({
          root: failed.root,
          taskPath: failed.taskPath,
          approvalDigest: failed.taskDigest,
        }),
      ).rejects.toMatchObject({ code: "TASK_APPROVAL_REQUIRED" });
    } finally {
      await failed.cleanup();
    }
  });

  it("serializes active-run admission with run creation under the writer lease", async () => {
    const fixture = await runtimeFixture();
    activate(fixture);
    try {
      const approvalDigest = await qualifiedApproval(fixture);
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const store = await StateStore.open(
        inputs.config.repositoryId,
        await commonGitDirectory(fixture.root),
      );
      store.createRun({
        repositoryId: inputs.config.repositoryId,
        taskId: "already-active",
        taskDigest: inputs.taskDigest,
        configDigest: inputs.configDigest,
        baseCommit: (await git(fixture.root, ["rev-parse", "HEAD"])).trim(),
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      });
      store.close();

      await expect(
        startLocalRun({
          root: fixture.root,
          taskPath: fixture.taskPath,
          approvalDigest,
        }),
      ).rejects.toMatchObject({ code: "ACTIVE_OUTCOME_CONFLICT" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects ignored-file contamination before exact-candidate verification", async () => {
    const fixture = await runtimeFixture();
    activate(fixture);
    try {
      const started = await startLocalRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        approvalDigest: await qualifiedApproval(fixture),
      });
      const store = await StateStore.open(
        "11111111-1111-4111-8111-111111111111",
        await commonGitDirectory(fixture.root),
      );
      const worktree = store.getRun(started.run.id).worktreePath;
      store.close();
      if (worktree === undefined) throw new Error("candidate worktree missing");
      await writeFile(path.join(worktree, "ignored-output"), "contaminated\n");
      await expect(
        verifyRun({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId: started.run.id,
        }),
      ).rejects.toMatchObject({ code: "CANDIDATE_DRIFT" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("removes a provisional branch and worktree when context setup fails", async () => {
    const fixture = await runtimeFixture();
    activate(fixture);
    try {
      const taskFile = path.join(fixture.root, fixture.taskPath);
      await writeFile(
        taskFile,
        (await readFile(taskFile, "utf8")).replace(
          "  - WORKFLOW.md",
          "  - missing-context.md",
        ),
      );
      await git(fixture.root, ["add", fixture.taskPath]);
      await git(fixture.root, [
        "commit",
        "--no-gpg-sign",
        "-m",
        "add missing context",
      ]);
      const approvalDigest = await qualifiedApproval(fixture);
      await expect(
        startLocalRun({
          root: fixture.root,
          taskPath: fixture.taskPath,
          approvalDigest,
        }),
      ).rejects.toBeDefined();
      expect(
        await git(fixture.root, ["worktree", "list", "--porcelain"]),
      ).not.toContain(fixture.stateHome);
      expect(
        (await git(fixture.root, ["branch", "--list", "mill/*"])).trim(),
      ).toBe("");
      await expect(runStatus({ root: fixture.root })).resolves.toMatchObject({
        run: { status: "failed" },
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("lets an external cancellation win over an active builder result", async () => {
    const fixture = await runtimeFixture();
    activate(fixture);
    try {
      await writeFile(
        fixture.codexPath,
        `#!${process.execPath}\nif(process.argv[2]==="--version"){console.log("codex-cli cancellation-fixture");process.exit(0)}if(process.argv[2]==="login")process.exit(0);setInterval(()=>{},1000);\n`,
        { mode: 0o755 },
      );
      await chmod(fixture.codexPath, 0o755);
      const approvalDigest = await qualifiedApproval(fixture);
      const started = startLocalRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        approvalDigest,
      });
      let active: Awaited<ReturnType<typeof runStatus>> = {};
      for (let attempt = 0; attempt < 100; attempt += 1) {
        active = await runStatus({ root: fixture.root });
        if (
          active.run?.status === "running" &&
          active.run.activePid !== undefined
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(active.run).toMatchObject({ status: "running" });
      const runId = active.run?.id;
      expect(runId).toBeTypeOf("string");
      if (runId === undefined) throw new Error("active run ID missing");
      await expect(
        cancelRun({ root: fixture.root, runId }),
      ).resolves.toMatchObject({ cancelRequested: true });
      await expect(started).rejects.toMatchObject({
        code: "CODEX_CANCELLED",
      });
      await expect(
        runStatus({ root: fixture.root, runId }),
      ).resolves.toMatchObject({ run: { status: "cancelled" } });
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects inspect-only trust and a base that is not checked out", async () => {
    const inspect = await runtimeFixture();
    activate(inspect);
    try {
      const unexpectedDockerCall = path.join(
        path.dirname(inspect.dockerPath),
        "unexpected-docker-call",
      );
      await writeFile(
        inspect.dockerPath,
        `#!${process.execPath}\nimport {writeFileSync} from "node:fs";writeFileSync(new URL("./unexpected-docker-call",import.meta.url),"called");process.exit(1);\n`,
        { mode: 0o755 },
      );
      const configPath = path.join(inspect.root, "mill.yaml");
      await writeFile(
        configPath,
        (await readFile(configPath, "utf8")).replace(
          "trustCeiling: build",
          "trustCeiling: inspect",
        ),
      );
      await git(inspect.root, ["add", "mill.yaml"]);
      await git(inspect.root, ["commit", "--no-gpg-sign", "-m", "inspect"]);
      await expect(
        qualifyBaseline({
          root: inspect.root,
          taskPath: inspect.taskPath,
        }),
      ).rejects.toMatchObject({ code: "BUILD_NOT_AUTHORIZED" });
      await expect(
        readFile(unexpectedDockerCall, "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await inspect.cleanup();
    }

    const base = await runtimeFixture();
    activate(base);
    try {
      await writeFile(path.join(base.root, "second.txt"), "second\n");
      await git(base.root, ["add", "second.txt"]);
      await git(base.root, ["commit", "--no-gpg-sign", "-m", "second"]);
      const taskFile = path.join(base.root, base.taskPath);
      await writeFile(
        taskFile,
        (await readFile(taskFile, "utf8")).replace(
          "baseRef: HEAD",
          "baseRef: HEAD~1",
        ),
      );
      await git(base.root, ["add", base.taskPath]);
      await git(base.root, ["commit", "--no-gpg-sign", "-m", "bind base"]);
      const approvalDigest = await qualifiedApproval(base);
      await expect(
        startLocalRun({
          root: base.root,
          taskPath: base.taskPath,
          approvalDigest,
        }),
      ).rejects.toMatchObject({ code: "BASE_REF_NOT_CHECKED_OUT" });
    } finally {
      await base.cleanup();
    }
  });

  it("cancels and cleans up an interrupted baseline verifier", async () => {
    const fixture = await runtimeFixture();
    activate(fixture);
    const toolDirectory = path.dirname(fixture.dockerPath);
    const started = path.join(toolDirectory, "baseline-started");
    const cleaned = path.join(toolDirectory, "baseline-cleaned");
    try {
      await writeFile(
        fixture.dockerPath,
        `#!${process.execPath}
import {writeFileSync} from "node:fs";
const args=process.argv.slice(2);
if(args[0]==="image"&&args[1]==="inspect")process.exit(0);
if(args[0]==="rm"){writeFileSync(new URL("./baseline-cleaned",import.meta.url),"cleaned");process.exit(0)}
writeFileSync(new URL("./baseline-started",import.meta.url),"started");setInterval(()=>{},1000);
`,
        { mode: 0o755 },
      );
      const taskFile = path.join(fixture.root, fixture.taskPath);
      await writeFile(
        taskFile,
        (await readFile(taskFile, "utf8")).replace(
          "deadlineSeconds: 60",
          "deadlineSeconds: 1",
        ),
      );
      await git(fixture.root, ["add", fixture.taskPath]);
      await git(fixture.root, [
        "commit",
        "--no-gpg-sign",
        "-m",
        "short baseline deadline",
      ]);
      const controller = new AbortController();
      const qualification = qualifyBaseline({
        root: fixture.root,
        taskPath: fixture.taskPath,
        signal: controller.signal,
      });
      let verifierStarted = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          verifierStarted = (await readFile(started, "utf8")) === "started";
          if (verifierStarted) break;
        } catch (error) {
          if (!(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )) {
            throw error;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      controller.abort();
      const result = await qualification;
      expect(verifierStarted).toBe(true);
      expect(result).toMatchObject({
        approvalDigest: null,
        evidence: {
          passed: false,
          commands: [{ status: "failed", reason: "CANCELLED" }],
        },
      });
      await expect(readFile(cleaned, "utf8")).resolves.toBe("cleaned");
      expect(
        await git(fixture.root, ["worktree", "list", "--porcelain"]),
      ).not.toContain("baseline-");
    } finally {
      await fixture.cleanup();
    }
  });

  it("detects task policy and base-ref drift before validation", async () => {
    const policy = await runtimeFixture();
    activate(policy);
    try {
      const started = await startLocalRun({
        root: policy.root,
        taskPath: policy.taskPath,
        approvalDigest: await qualifiedApproval(policy),
      });
      const taskFile = path.join(policy.root, policy.taskPath);
      await writeFile(
        taskFile,
        (await readFile(taskFile, "utf8")).replace(
          "greater than one.",
          "greater than two.",
        ),
      );
      await expect(
        verifyRun({
          root: policy.root,
          taskPath: policy.taskPath,
          runId: started.run.id,
        }),
      ).rejects.toMatchObject({ code: "RUN_POLICY_DRIFT" });
    } finally {
      await policy.cleanup();
    }

    const base = await runtimeFixture();
    activate(base);
    try {
      const started = await startLocalRun({
        root: base.root,
        taskPath: base.taskPath,
        approvalDigest: await qualifiedApproval(base),
      });
      await writeFile(path.join(base.root, "advance.txt"), "advance\n");
      await git(base.root, ["add", "advance.txt"]);
      await git(base.root, ["commit", "--no-gpg-sign", "-m", "advance"]);
      await expect(
        verifyRun({
          root: base.root,
          taskPath: base.taskPath,
          runId: started.run.id,
        }),
      ).rejects.toMatchObject({ code: "BASE_REF_DRIFT" });
    } finally {
      await base.cleanup();
    }
  });

  it("fails closed for out-of-order and stale validation evidence", async () => {
    const early = await runtimeFixture();
    activate(early);
    try {
      const started = await startLocalRun({
        root: early.root,
        taskPath: early.taskPath,
        approvalDigest: await qualifiedApproval(early),
      });
      await expect(
        reviewRun({
          root: early.root,
          taskPath: early.taskPath,
          runId: started.run.id,
        }),
      ).rejects.toMatchObject({ code: "RUN_NOT_VERIFIED" });
      await expect(
        verifyRun({
          root: early.root,
          taskPath: early.taskPath,
          runId: started.run.id,
        }),
      ).rejects.toMatchObject({ code: "RUN_NOT_COMMITTED" });
    } finally {
      await early.cleanup();
    }

    const stale = await runtimeFixture();
    activate(stale);
    try {
      const started = await startLocalRun({
        root: stale.root,
        taskPath: stale.taskPath,
        approvalDigest: await qualifiedApproval(stale),
      });
      const store = await StateStore.open(
        "11111111-1111-4111-8111-111111111111",
        await commonGitDirectory(stale.root),
      );
      store.completeValidation(
        started.run.id,
        JSON.stringify({
          schemaVersion: "1",
          candidateCommit: "f".repeat(40),
          verifierImage:
            "node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e",
          network: "none",
          commands: [],
          passed: true,
        }),
        true,
      );
      store.close();
      await expect(
        reviewRun({
          root: stale.root,
          taskPath: stale.taskPath,
          runId: started.run.id,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_EVIDENCE_STALE" });
    } finally {
      await stale.cleanup();
    }
  });

  it("retries transient review failure once against the unchanged candidate", async () => {
    const fixture = await runtimeFixture();
    activate(fixture);
    try {
      const started = await startLocalRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        approvalDigest: await qualifiedApproval(fixture),
      });
      await verifyRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId: started.run.id,
      });
      process.env.MILL_CODEX_PATH = "/usr/bin/false";
      await expect(
        reviewRun({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId: started.run.id,
        }),
      ).rejects.toMatchObject({ code: "CODEX_PROFILE_UNAVAILABLE" });
      process.env.MILL_CODEX_PATH = fixture.codexPath;
      const reviewed = await reviewRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId: started.run.id,
      });
      expect(reviewed.run).toMatchObject({
        status: "reviewed",
        candidateCommit: started.run.candidateCommit,
      });
      const store = await StateStore.open(
        "11111111-1111-4111-8111-111111111111",
        await commonGitDirectory(fixture.root),
      );
      const databasePath = store.databasePath;
      store.close();
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const rows = database
          .prepare(
            "SELECT envelope_json FROM worker_invocations WHERE run_id = ? AND phase = 'review' ORDER BY created_at, id",
          )
          .all(started.run.id) as unknown as { envelope_json: string }[];
        expect(
          rows.map(
            (row) =>
              (JSON.parse(row.envelope_json) as { attempt: number }).attempt,
          ),
        ).toEqual([2]);
      } finally {
        database.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("bounds repeated provider review failures", async () => {
    const fixture = await runtimeFixture();
    activate(fixture);
    try {
      const started = await startLocalRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        approvalDigest: await qualifiedApproval(fixture),
      });
      await verifyRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId: started.run.id,
      });
      process.env.MILL_CODEX_PATH = "/usr/bin/false";
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(
          reviewRun({
            root: fixture.root,
            taskPath: fixture.taskPath,
            runId: started.run.id,
          }),
        ).rejects.toMatchObject({ code: "CODEX_PROFILE_UNAVAILABLE" });
      }
      await expect(
        reviewRun({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId: started.run.id,
        }),
      ).rejects.toMatchObject({ code: "REVIEW_RETRY_BUDGET_EXHAUSTED" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("reconciles an interrupted builder, but never resumes a live process", async () => {
    const createRunning = async (
      fixture: Awaited<ReturnType<typeof runtimeFixture>>,
      pid: number,
      identity = `sha256:${"f".repeat(64)}`,
      deadlineAt = new Date(Date.now() + 60_000).toISOString(),
    ): Promise<string> => {
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const qualified = await qualifyRepositoryForBuild(fixture.root, "HEAD");
      const store = await StateStore.open(
        inputs.config.repositoryId,
        qualified.commonDirectory,
      );
      const run = store.createRun({
        repositoryId: inputs.config.repositoryId,
        taskId: inputs.task.id,
        taskDigest: inputs.taskDigest,
        configDigest: inputs.configDigest,
        baseCommit: qualified.baseCommit,
        deadlineAt,
      });
      store.transition(run.id, "ready", "run.ready");
      const worktree = path.join(store.worktreesDirectory, run.id);
      await createCandidateWorktree(
        fixture.root,
        worktree,
        qualified.baseCommit,
        inputs.task.id,
        run.id,
      );
      const frozen = await buildContextManifest(
        worktree,
        qualified.baseCommit,
        inputs.task,
        inputs.config,
        inputs.taskDigest,
      );
      const gitControl = await captureGitControlState(worktree);
      store.setWorkspace(
        run.id,
        worktree,
        frozen.digest,
        JSON.stringify(frozen.manifest),
        JSON.stringify(gitControl),
      );
      store.transition(run.id, "running", "builder.started");
      store.beginBuilderAttempt(run.id, 2);
      store.setActiveProcess(run.id, {
        id: randomUUID(),
        pid,
        processGroup: pid,
        identity,
      });
      store.close();
      return run.id;
    };

    const interrupted = await runtimeFixture();
    activate(interrupted);
    try {
      const runId = await createRunning(interrupted, 99_999_999);
      await expect(
        runStatus({ root: interrupted.root, runId }),
      ).resolves.toMatchObject({ interrupted: true });
      const resumed = await resumeRun({
        root: interrupted.root,
        taskPath: interrupted.taskPath,
        runId,
      });
      expect(resumed).toMatchObject({ status: "committed", attemptCount: 2 });
      expect(resumed).not.toHaveProperty("worktreePath");
    } finally {
      await interrupted.cleanup();
    }

    const active = await runtimeFixture();
    activate(active);
    try {
      const runId = await createRunning(active, 99_999_999);
      const store = await StateStore.open(
        "11111111-1111-4111-8111-111111111111",
        await commonGitDirectory(active.root),
      );
      const lease = await acquireWriterLease(store);
      await expect(
        resumeRun({
          root: active.root,
          taskPath: active.taskPath,
          runId,
        }),
      ).rejects.toMatchObject({ code: "WRITER_ALREADY_ACTIVE" });
      await lease.release();
      store.close();
    } finally {
      await active.cleanup();
    }

    const expired = await runtimeFixture();
    activate(expired);
    try {
      const runId = await createRunning(
        expired,
        99_999_999,
        `sha256:${"f".repeat(64)}`,
        new Date(Date.now() - 1_000).toISOString(),
      );
      await expect(
        resumeRun({
          root: expired.root,
          taskPath: expired.taskPath,
          runId,
        }),
      ).rejects.toMatchObject({ code: "RUN_DEADLINE_EXCEEDED" });
      expect(
        await readFile(path.join(expired.root, "src", "value.js"), "utf8"),
      ).toBe("export const value = 1;\n");
    } finally {
      await expired.cleanup();
    }
  });

  it("never treats a persisted PID as cancellation authority", async () => {
    const fixture = await runtimeFixture();
    activate(fixture);
    try {
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const qualified = await qualifyRepositoryForBuild(fixture.root, "HEAD");
      const store = await StateStore.open(
        inputs.config.repositoryId,
        qualified.commonDirectory,
      );
      const run = store.createRun({
        repositoryId: inputs.config.repositoryId,
        taskId: inputs.task.id,
        taskDigest: inputs.taskDigest,
        configDigest: inputs.configDigest,
        baseCommit: qualified.baseCommit,
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      });
      store.setActiveProcess(run.id, {
        id: randomUUID(),
        pid: process.pid,
        processGroup: process.pid,
        identity: `sha256:${"0".repeat(64)}`,
      });
      store.close();
      await expect(
        cancelRun({ root: fixture.root, runId: run.id }),
      ).resolves.toMatchObject({ status: "cancelled" });
      expect(() => process.kill(process.pid, 0)).not.toThrow();
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed when an orphaned execution identity may still be live", async () => {
    const fixture = await runtimeFixture();
    activate(fixture);
    const controller = new AbortController();
    let publishActive: ((process: ActiveProcess) => void) | undefined;
    const activeReady = new Promise<ActiveProcess>((resolve) => {
      publishActive = resolve;
    });
    const child = runProcess({
      executable: process.execPath,
      args: ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
      cwd: fixture.root,
      env: {},
      deadlineMs: Date.now() + 10_000,
      maxOutputBytes: 1024,
      signal: controller.signal,
      onSpawn(process) {
        publishActive?.(process);
      },
    });
    try {
      const active = await activeReady;
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const qualified = await qualifyRepositoryForBuild(fixture.root, "HEAD");
      const store = await StateStore.open(
        inputs.config.repositoryId,
        qualified.commonDirectory,
      );
      const run = store.createRun({
        repositoryId: inputs.config.repositoryId,
        taskId: inputs.task.id,
        taskDigest: inputs.taskDigest,
        configDigest: inputs.configDigest,
        baseCommit: qualified.baseCommit,
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      });
      store.setActiveProcess(run.id, active);
      store.close();

      await expect(
        runStatus({ root: fixture.root, runId: run.id }),
      ).resolves.toMatchObject({ reconciliationRequired: true });
      await expect(
        cancelRun({ root: fixture.root, runId: run.id }),
      ).resolves.toMatchObject({
        status: "approved",
        cancelRequested: true,
      });
      await expect(
        resumeRun({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId: run.id,
        }),
      ).rejects.toMatchObject({
        code: "ORPHANED_EXECUTION_RECONCILIATION_REQUIRED",
      });
      expect(() => process.kill(active.pid, 0)).not.toThrow();
    } finally {
      controller.abort();
      await child;
      await fixture.cleanup();
    }
  });

  it("blocks a mutating launch that crashed before process identity was recorded", async () => {
    const fixture = await runtimeFixture();
    activate(fixture);
    try {
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const qualified = await qualifyRepositoryForBuild(fixture.root, "HEAD");
      const store = await StateStore.open(
        inputs.config.repositoryId,
        qualified.commonDirectory,
      );
      const run = store.createRun({
        repositoryId: inputs.config.repositoryId,
        taskId: inputs.task.id,
        taskDigest: inputs.taskDigest,
        configDigest: inputs.configDigest,
        baseCommit: qualified.baseCommit,
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      });
      store.transition(run.id, "ready", "run.ready");
      const worktree = path.join(store.worktreesDirectory, run.id);
      await createCandidateWorktree(
        fixture.root,
        worktree,
        qualified.baseCommit,
        inputs.task.id,
        run.id,
      );
      const frozen = await buildContextManifest(
        worktree,
        qualified.baseCommit,
        inputs.task,
        inputs.config,
        inputs.taskDigest,
      );
      store.setWorkspace(
        run.id,
        worktree,
        frozen.digest,
        JSON.stringify(frozen.manifest),
        JSON.stringify(await captureGitControlState(worktree)),
      );
      store.transition(run.id, "running", "builder.started");
      store.beginBuilderAttempt(run.id, 2);
      const invocationId = randomUUID();
      store.admitWorkerInvocation({
        runId: run.id,
        invocationId,
        phase: "build",
        envelopeDigest: `sha256:${"a".repeat(64)}`,
        envelopeJson: '{"redacted":true}',
      });
      store.markWorkerLaunchStarted(invocationId);
      store.close();

      await expect(
        runStatus({ root: fixture.root, runId: run.id }),
      ).resolves.toMatchObject({ reconciliationRequired: true });
      await expect(
        cancelRun({ root: fixture.root, runId: run.id }),
      ).resolves.toMatchObject({ status: "running", cancelRequested: true });
      await expect(
        resumeRun({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId: run.id,
        }),
      ).rejects.toMatchObject({
        code: "WORKER_INVOCATION_RECONCILIATION_REQUIRED",
      });
      expect(
        await readFile(path.join(worktree, "src", "value.js"), "utf8"),
      ).toBe("export const value = 1;\n");
    } finally {
      await fixture.cleanup();
    }
  });

  it("finalizes durable cancellation without launching a resumed builder", async () => {
    const fixture = await runtimeFixture();
    activate(fixture);
    try {
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const qualified = await qualifyRepositoryForBuild(fixture.root, "HEAD");
      const store = await StateStore.open(
        inputs.config.repositoryId,
        qualified.commonDirectory,
      );
      const run = store.createRun({
        repositoryId: inputs.config.repositoryId,
        taskId: inputs.task.id,
        taskDigest: inputs.taskDigest,
        configDigest: inputs.configDigest,
        baseCommit: qualified.baseCommit,
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      });
      store.transition(run.id, "ready", "run.ready");
      const worktree = path.join(store.worktreesDirectory, run.id);
      await createCandidateWorktree(
        fixture.root,
        worktree,
        qualified.baseCommit,
        inputs.task.id,
        run.id,
      );
      const frozen = await buildContextManifest(
        worktree,
        qualified.baseCommit,
        inputs.task,
        inputs.config,
        inputs.taskDigest,
      );
      store.setWorkspace(
        run.id,
        worktree,
        frozen.digest,
        JSON.stringify(frozen.manifest),
        JSON.stringify(await captureGitControlState(worktree)),
      );
      store.transition(run.id, "running", "builder.started");
      store.beginBuilderAttempt(run.id, 2);
      store.setActiveProcess(run.id, {
        id: randomUUID(),
        pid: 99_999_999,
        processGroup: 99_999_999,
        identity: `sha256:${"f".repeat(64)}`,
      });
      store.requestCancellation(run.id);
      store.close();

      const resumed = await resumeRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId: run.id,
      });
      expect(resumed).toMatchObject({
        status: "cancelled",
        cancelRequested: true,
        attemptCount: 1,
      });
      expect(
        await readFile(path.join(worktree, "src", "value.js"), "utf8"),
      ).toBe("export const value = 1;\n");
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports empty state and blocks purging a nonterminal run", async () => {
    const fixture = await runtimeFixture();
    activate(fixture);
    try {
      await expect(runStatus({ root: fixture.root })).resolves.toEqual({});
      await expect(
        supportBundle({ root: fixture.root }),
      ).resolves.toMatchObject({
        run: null,
        events: [],
      });
      await startLocalRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        approvalDigest: await qualifiedApproval(fixture),
      });
      await expect(
        statePurge({
          root: fixture.root,
          confirmation: "11111111-1111-4111-8111-111111111111",
        }),
      ).rejects.toMatchObject({ code: "ACTIVE_RUNS_BLOCK_PURGE" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("refuses to repair a worktree that drifted from the reviewed candidate", async () => {
    const fixture = await runtimeFixture({ reviewRepair: true });
    activate(fixture);
    try {
      const started = await startLocalRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        approvalDigest: await qualifiedApproval(fixture),
      });
      await verifyRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId: started.run.id,
      });
      await reviewRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId: started.run.id,
      });
      const store = await StateStore.open(
        "11111111-1111-4111-8111-111111111111",
        await commonGitDirectory(fixture.root),
      );
      const worktree = store.getRun(started.run.id).worktreePath;
      store.close();
      if (worktree === undefined) throw new Error("candidate worktree missing");
      await writeFile(
        path.join(worktree, "src", "value.js"),
        "export const value = 99;\n",
      );
      await expect(
        resumeRun({
          root: fixture.root,
          taskPath: fixture.taskPath,
          runId: started.run.id,
        }),
      ).rejects.toMatchObject({ code: "CANDIDATE_DRIFT" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("repairs one complete review generation and requires revalidation", async () => {
    const fixture = await runtimeFixture({
      reviewRepair: true,
      retryCount: 0,
    });
    activate(fixture);
    try {
      const started = await startLocalRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        approvalDigest: await qualifiedApproval(fixture),
      });
      await verifyRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId: started.run.id,
      });
      const firstReview = await reviewRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId: started.run.id,
      });
      expect(firstReview.run).toMatchObject({
        status: "blocked",
        blockCode: "REVIEW_FINDINGS",
      });
      const repaired = await resumeRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId: started.run.id,
      });
      expect(repaired).toMatchObject({ status: "committed", repairCount: 1 });
      expect(repaired.candidateCommit).not.toBe(started.run.candidateCommit);
      await verifyRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId: started.run.id,
      });
      const finalReview = await reviewRun({
        root: fixture.root,
        taskPath: fixture.taskPath,
        runId: started.run.id,
      });
      expect(finalReview.run.status).toBe("reviewed");
    } finally {
      await fixture.cleanup();
    }
  });
});
