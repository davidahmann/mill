import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireWriterLease,
  purgeRepositoryState,
  repositoryStateDirectory,
  restoreStateBackup,
  StateStore,
} from "../src/runtime/state.js";
import { temporaryDirectory } from "./helpers.js";

const originalStateHome = process.env.MILL_STATE_HOME;

afterEach(() => {
  if (originalStateHome === undefined) delete process.env.MILL_STATE_HOME;
  else process.env.MILL_STATE_HOME = originalStateHome;
});

describe("operational state", () => {
  it("persists transactional transitions and append-only redacted events with user-only permissions", async () => {
    const temporary = await temporaryDirectory("mill-state-");
    process.env.MILL_STATE_HOME = temporary.path;
    const store = await StateStore.open(
      "11111111-1111-4111-8111-111111111111",
      temporary.path,
    );
    try {
      const run = store.createRun({
        repositoryId: "11111111-1111-4111-8111-111111111111",
        taskId: "task",
        taskDigest: `sha256:${"a".repeat(64)}`,
        configDigest: `sha256:${"b".repeat(64)}`,
        baseCommit: "c".repeat(40),
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      });
      store.transition(run.id, "ready", "run.ready");
      expect(store.getRun(run.id).status).toBe("ready");
      expect(store.events(run.id).map((event) => event.type)).toEqual([
        "run.created",
        "run.ready",
      ]);
      expect((await stat(store.directory)).mode & 0o777).toBe(0o700);
      expect((await stat(store.databasePath)).mode & 0o777).toBe(0o600);
      const backup = await store.backup();
      expect((await stat(backup)).mode & 0o777).toBe(0o600);
    } finally {
      store.close();
      await temporary.cleanup();
    }
  });

  it("permits only one live writer lease", async () => {
    const temporary = await temporaryDirectory("mill-writer-");
    process.env.MILL_STATE_HOME = temporary.path;
    const store = await StateStore.open(
      "11111111-1111-4111-8111-111111111111",
      temporary.path,
    );
    try {
      const lease = await acquireWriterLease(store);
      await expect(acquireWriterLease(store)).rejects.toMatchObject({
        code: "WRITER_ALREADY_ACTIVE",
      });
      await lease.release();
      const next = await acquireWriterLease(store);
      await next.release();
    } finally {
      store.close();
      await temporary.cleanup();
    }
  });

  it("admits immutable worker invocations before launch and never replays a possible start", async () => {
    const temporary = await temporaryDirectory("mill-worker-admission-");
    process.env.MILL_STATE_HOME = temporary.path;
    const repositoryId = "11111111-1111-4111-8111-111111111111";
    const store = await StateStore.open(repositoryId, temporary.path);
    try {
      const run = store.createRun({
        repositoryId,
        taskId: "worker-admission",
        taskDigest: `sha256:${"a".repeat(64)}`,
        configDigest: `sha256:${"b".repeat(64)}`,
        baseCommit: "c".repeat(40),
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const invocationId = randomUUID();
      const admission = {
        runId: run.id,
        invocationId,
        phase: "build",
        envelopeDigest: `sha256:${"d".repeat(64)}`,
        envelopeJson: '{"redacted":true}',
      };
      expect(store.admitWorkerInvocation(admission)).toBe("created");
      expect(store.admitWorkerInvocation(admission)).toBe("existing");
      expect(store.workerInvocationStatus(invocationId)).toBe("admitted");
      expect(() =>
        store.admitWorkerInvocation({
          ...admission,
          envelopeDigest: `sha256:${"e".repeat(64)}`,
        }),
      ).toThrow(
        expect.objectContaining({
          code: "WORKER_INVOCATION_IDENTITY_CONFLICT",
        }),
      );

      store.markWorkerLaunchStarted(invocationId);
      expect(store.workerInvocationStatus(invocationId)).toBe("launch_started");
      expect(() => store.markWorkerLaunchStarted(invocationId)).toThrow(
        expect.objectContaining({ code: "WORKER_INVOCATION_POSSIBLY_STARTED" }),
      );
      store.settleWorkerInvocation(invocationId, "completed");
      expect(store.workerInvocationStatus(invocationId)).toBe("settled");
      expect(() =>
        store.settleWorkerInvocation(invocationId, "completed"),
      ).toThrow(
        expect.objectContaining({
          code: "WORKER_INVOCATION_SETTLEMENT_CONFLICT",
        }),
      );

      const uncertainId = randomUUID();
      store.admitWorkerInvocation({
        ...admission,
        invocationId: uncertainId,
        envelopeDigest: `sha256:${"f".repeat(64)}`,
      });
      store.markWorkerLaunchStarted(uncertainId);
      store.settleWorkerInvocation(uncertainId, "uncertain", {
        code: "CODEX_EXECUTION_FAILED",
        processExited: true,
      });
      expect(store.workerInvocationStatus(uncertainId)).toBe("uncertain");
      expect(store.unresolvedMutatingWorkerInvocations(run.id)).toEqual([
        {
          invocationId: uncertainId,
          phase: "build",
          status: "uncertain",
          processExited: true,
        },
      ]);
      store.reconcileWorkerInvocation(
        run.id,
        uncertainId,
        "process_exit_observed",
      );
      expect(store.workerInvocationStatus(uncertainId)).toBe("reconciled");
      expect(store.unresolvedMutatingWorkerInvocations(run.id)).toEqual([]);
      expect(store.events(run.id).map((event) => event.type)).toEqual([
        "run.created",
        "worker.admitted",
        "worker.admitted",
        "worker.reconciled",
      ]);
    } finally {
      store.close();
      await temporary.cleanup();
    }
  });

  it("enforces transition, retry, validation, review, and cancellation invariants", async () => {
    const temporary = await temporaryDirectory("mill-state-machine-");
    process.env.MILL_STATE_HOME = temporary.path;
    const repositoryId = "11111111-1111-4111-8111-111111111111";
    const store = await StateStore.open(repositoryId, temporary.path);
    const create = () =>
      store.createRun({
        repositoryId,
        taskId: "task",
        taskDigest: `sha256:${"a".repeat(64)}`,
        configDigest: `sha256:${"b".repeat(64)}`,
        baseCommit: "c".repeat(40),
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      });
    try {
      expect(store.latestRun()).toBeUndefined();
      expect(() => store.getRun("missing")).toThrow(
        expect.objectContaining({ code: "RUN_NOT_FOUND" }),
      );
      const failedValidation = create();
      expect(() =>
        store.transition(failedValidation.id, "reviewed", "invalid"),
      ).toThrow(expect.objectContaining({ code: "INVALID_RUN_TRANSITION" }));
      store.transition(failedValidation.id, "ready", "ready");
      store.setWorkspace(
        failedValidation.id,
        "/tmp/worktree",
        `sha256:${"d".repeat(64)}`,
        "{}",
        "{}",
      );
      expect(() =>
        store.setWorkspace(
          failedValidation.id,
          "/tmp/other",
          `sha256:${"e".repeat(64)}`,
          "{}",
          "{}",
        ),
      ).toThrow(expect.objectContaining({ code: "INVALID_RUN_TRANSITION" }));
      store.transition(failedValidation.id, "running", "running");
      store.beginBuilderAttempt(failedValidation.id, 1);
      expect(() => store.beginBuilderAttempt(failedValidation.id, 1)).toThrow(
        expect.objectContaining({ code: "BUILDER_RETRY_BUDGET_EXHAUSTED" }),
      );
      store.commitCandidate(
        failedValidation.id,
        "e".repeat(40),
        "f".repeat(40),
      );
      const blocked = store.completeValidation(
        failedValidation.id,
        '{"passed":false}',
        false,
      );
      expect(blocked).toMatchObject({
        status: "blocked",
        blockCode: "VALIDATION_FAILED",
        worktreePath: "/tmp/worktree",
      });
      store.beginRepair(blocked.id);
      expect(() => store.beginRepair(blocked.id)).toThrow(
        expect.objectContaining({ code: "REPAIR_BUDGET_EXHAUSTED" }),
      );

      const reviewed = create();
      store.transition(reviewed.id, "ready", "ready");
      store.transition(reviewed.id, "running", "running");
      store.commitCandidate(reviewed.id, "1".repeat(40), "2".repeat(40));
      store.completeValidation(reviewed.id, '{"passed":true}', true);
      store.beginReviewAttempt(reviewed.id, 1);
      expect(() => store.beginReviewAttempt(reviewed.id, 1)).toThrow(
        expect.objectContaining({ code: "REVIEW_RETRY_BUDGET_EXHAUSTED" }),
      );
      const findings = store.completeReview(
        reviewed.id,
        '{"findings":[1]}',
        1,
        false,
      );
      expect(findings).toMatchObject({
        status: "blocked",
        blockCode: "REVIEW_FINDINGS",
      });
      store.beginRepair(findings.id);
      store.commitCandidate(findings.id, "5".repeat(40), "6".repeat(40));
      store.completeValidation(findings.id, '{"passed":true}', true);
      expect(() => store.beginReviewAttempt(findings.id, 1)).not.toThrow();
      expect(() => store.beginReviewAttempt(findings.id, 1)).toThrow(
        expect.objectContaining({ code: "REVIEW_RETRY_BUDGET_EXHAUSTED" }),
      );

      const nonConverged = create();
      store.transition(nonConverged.id, "ready", "ready");
      store.transition(nonConverged.id, "running", "running");
      store.commitCandidate(nonConverged.id, "3".repeat(40), "4".repeat(40));
      store.completeValidation(nonConverged.id, '{"passed":true}', true);
      expect(
        store.completeReview(nonConverged.id, '{"findings":[1]}', 1, true),
      ).toMatchObject({
        status: "blocked",
        blockCode: "REVIEW_NON_CONVERGENCE",
      });

      const cancelled = create();
      const requested = store.requestCancellation(cancelled.id);
      expect(requested.cancelRequested).toBe(true);
      store.transition(cancelled.id, "cancelled", "cancelled");
      expect(store.requestCancellation(cancelled.id).status).toBe("cancelled");
      expect(store.runs()).toHaveLength(4);
    } finally {
      store.close();
      store.close();
      await temporary.cleanup();
    }
  });

  it("binds and clears active executions with cancellation-dominant compare-and-swap", async () => {
    const temporary = await temporaryDirectory("mill-state-active-");
    process.env.MILL_STATE_HOME = temporary.path;
    const store = await StateStore.open(
      "11111111-1111-4111-8111-111111111111",
      temporary.path,
    );
    const create = () =>
      store.createRun({
        repositoryId: "11111111-1111-4111-8111-111111111111",
        taskId: "active",
        taskDigest: `sha256:${"a".repeat(64)}`,
        configDigest: `sha256:${"b".repeat(64)}`,
        baseCommit: "c".repeat(40),
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      });
    try {
      const first = create();
      const attemptId = randomUUID();
      store.setActiveProcess(first.id, {
        id: attemptId,
        pid: 12345,
        processGroup: 12345,
        identity: `sha256:${"d".repeat(64)}`,
      });
      store.clearActiveProcess(first.id, randomUUID());
      expect(store.getRun(first.id).activeProcessId).toBe(attemptId);
      store.clearActiveProcess(first.id, attemptId);
      expect(store.getRun(first.id)).not.toHaveProperty("activeProcessId");

      const cancelled = create();
      store.requestCancellation(cancelled.id);
      expect(() =>
        store.setActiveProcess(cancelled.id, {
          id: randomUUID(),
          pid: 54321,
          processGroup: 54321,
          identity: `sha256:${"e".repeat(64)}`,
        }),
      ).toThrow(
        expect.objectContaining({ code: "ACTIVE_PROCESS_BINDING_REJECTED" }),
      );
      expect(() => store.beginBuilderAttempt(cancelled.id, 1)).toThrow(
        expect.objectContaining({ code: "OPERATOR_CANCELLED" }),
      );
    } finally {
      store.close();
      await temporary.cleanup();
    }
  });

  it("prevents cancelled runs from publishing candidate or evidence state", async () => {
    const temporary = await temporaryDirectory("mill-state-cancel-race-");
    process.env.MILL_STATE_HOME = temporary.path;
    const repositoryId = "11111111-1111-4111-8111-111111111111";
    const store = await StateStore.open(repositoryId, temporary.path);
    const create = (taskId: string) =>
      store.createRun({
        repositoryId,
        taskId,
        taskDigest: `sha256:${"a".repeat(64)}`,
        configDigest: `sha256:${"b".repeat(64)}`,
        baseCommit: "c".repeat(40),
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      });
    const advanceToRunning = (taskId: string) => {
      const run = create(taskId);
      store.transition(run.id, "ready", "run.ready");
      store.transition(run.id, "running", "run.running");
      return run;
    };
    const advanceToCommitted = (taskId: string) => {
      const run = advanceToRunning(taskId);
      store.commitCandidate(run.id, "d".repeat(40), "e".repeat(40));
      return run;
    };
    const advanceToVerified = (taskId: string) => {
      const run = advanceToCommitted(taskId);
      store.completeValidation(run.id, '{"passed":true}', true);
      return run;
    };
    const expectCancellationToWin = (operation: () => unknown) => {
      expect(operation).toThrow(
        expect.objectContaining({ code: "OPERATOR_CANCELLED" }),
      );
    };
    try {
      const candidate = advanceToRunning("candidate-race");
      store.requestCancellation(candidate.id);
      expectCancellationToWin(() =>
        store.commitCandidate(candidate.id, "f".repeat(40), "0".repeat(40)),
      );

      const validation = advanceToCommitted("validation-race");
      store.requestCancellation(validation.id);
      expectCancellationToWin(() =>
        store.completeValidation(validation.id, '{"passed":true}', true),
      );

      const reviewAttempt = advanceToVerified("review-attempt-race");
      store.requestCancellation(reviewAttempt.id);
      expectCancellationToWin(() =>
        store.beginReviewAttempt(reviewAttempt.id, 1),
      );

      const reviewEvidence = advanceToVerified("review-evidence-race");
      store.requestCancellation(reviewEvidence.id);
      expectCancellationToWin(() =>
        store.completeReview(reviewEvidence.id, '{"findings":[]}', 0, false),
      );
    } finally {
      store.close();
      await temporary.cleanup();
    }
  });

  it("restores only a validated, nonsymlink Mill-owned database", async () => {
    const temporary = await temporaryDirectory("mill-state-restore-");
    process.env.MILL_STATE_HOME = temporary.path;
    const repositoryId = "11111111-1111-4111-8111-111111111111";
    const store = await StateStore.open(repositoryId, temporary.path);
    const run = store.createRun({
      repositoryId,
      taskId: "restore",
      taskDigest: `sha256:${"a".repeat(64)}`,
      configDigest: `sha256:${"b".repeat(64)}`,
      baseCommit: "c".repeat(40),
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const directory = store.directory;
    const databasePath = store.databasePath;
    const backup = await store.backup();
    store.close();
    try {
      await writeFile(`${databasePath}-wal`, "stale");
      await writeFile(`${databasePath}-shm`, "stale");
      await restoreStateBackup(repositoryId, temporary.path, backup);
      const restored = await StateStore.open(repositoryId, temporary.path);
      expect(restored.getRun(run.id).taskId).toBe("restore");
      restored.close();
      await expect(access(`${databasePath}-wal`)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(access(`${databasePath}-shm`)).rejects.toMatchObject({
        code: "ENOENT",
      });

      const invalid = path.join(directory, "state-backup-invalid.sqlite3");
      await writeFile(invalid, "not a database\n");
      await expect(
        restoreStateBackup(repositoryId, temporary.path, invalid),
      ).rejects.toMatchObject({ code: "INVALID_STATE_BACKUP" });

      const linked = path.join(directory, "state-backup-linked.sqlite3");
      await symlink(backup, linked);
      await expect(
        restoreStateBackup(repositoryId, temporary.path, linked),
      ).rejects.toMatchObject({ code: "INVALID_STATE_BACKUP" });
    } finally {
      await temporary.cleanup();
    }
  });

  it("quarantines worktrees absent from an older restored backup", async () => {
    const temporary = await temporaryDirectory("mill-state-restore-orphan-");
    process.env.MILL_STATE_HOME = temporary.path;
    const repositoryId = "11111111-1111-4111-8111-111111111111";
    const store = await StateStore.open(repositoryId, temporary.path);
    const backup = await store.backup();
    const newerWorktree = path.join(store.worktreesDirectory, "newer-run");
    await mkdir(newerWorktree);
    store.close();
    try {
      const result = await restoreStateBackup(
        repositoryId,
        temporary.path,
        backup,
      );
      expect(result.quarantinedCount).toBe(1);
      expect(result.quarantineManifest).toBeDefined();
      await expect(access(newerWorktree)).rejects.toMatchObject({
        code: "ENOENT",
      });
      const manifestPath = result.quarantineManifest;
      expect(manifestPath).toBeDefined();
      if (manifestPath === undefined) throw new Error("manifest missing");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        protocol: string;
        worktrees: { original: string; quarantined: string }[];
      };
      expect(manifest.protocol).toBe("database_swap_commit_point");
      expect(manifest.worktrees).toHaveLength(1);
      expect(manifest.worktrees[0]?.original).toBe(newerWorktree);
      const quarantined = manifest.worktrees[0]?.quarantined;
      expect(quarantined).toBeDefined();
      if (quarantined === undefined) throw new Error("worktree missing");
      const quarantineStat = await stat(quarantined);
      expect(quarantineStat.mode).toEqual(expect.any(Number));
    } finally {
      await temporary.cleanup();
    }
  });

  it("uses an OS-released SQLite lease and fails closed for corrupt lease state", async () => {
    const temporary = await temporaryDirectory("mill-state-recovery-");
    process.env.MILL_STATE_HOME = temporary.path;
    const repositoryId = "11111111-1111-4111-8111-111111111111";
    const store = await StateStore.open(repositoryId, temporary.path);
    try {
      const leasePath = path.join(store.directory, "writer-lease.sqlite3");
      const child = spawn(
        process.execPath,
        [
          "-e",
          `const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1]);db.exec("PRAGMA journal_mode=DELETE;CREATE TABLE IF NOT EXISTS lease_anchor(singleton INTEGER PRIMARY KEY) STRICT;BEGIN EXCLUSIVE");process.stdout.write("ready\\n");setInterval(()=>{},1000);`,
          leasePath,
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      await once(child.stdout, "data");
      await expect(acquireWriterLease(store)).rejects.toMatchObject({
        code: "WRITER_ALREADY_ACTIVE",
      });
      child.kill("SIGKILL");
      await once(child, "close");
      const recovered = await acquireWriterLease(store);
      await recovered.release();

      await expect(
        restoreStateBackup(
          repositoryId,
          temporary.path,
          "/tmp/not-mill.sqlite3",
        ),
      ).rejects.toMatchObject({ code: "INVALID_STATE_BACKUP" });
      await writeFile(leasePath, "not-a-sqlite-database\n");
      await expect(acquireWriterLease(store)).rejects.toMatchObject({
        code: "WRITER_LEASE_UNAVAILABLE",
      });
    } finally {
      store.close();
      await temporary.cleanup();
    }
  });

  it("rejects relative state homes and treats absent purge state as complete", async () => {
    process.env.MILL_STATE_HOME = "relative-state";
    expect(() =>
      repositoryStateDirectory(
        "11111111-1111-4111-8111-111111111111",
        "/tmp/repository",
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE_HOME" }));

    const temporary = await temporaryDirectory("mill-state-absent-");
    process.env.MILL_STATE_HOME = temporary.path;
    try {
      await expect(
        purgeRepositoryState(
          "11111111-1111-4111-8111-111111111111",
          "/tmp/repository",
        ),
      ).resolves.toBeUndefined();
    } finally {
      await temporary.cleanup();
    }
  });
});
