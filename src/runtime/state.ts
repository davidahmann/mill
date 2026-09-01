import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import { ExitCode, MillError } from "../errors.js";
import { isWithin } from "../security/safe-path.js";

export type RunStatus =
  | "approved"
  | "ready"
  | "running"
  | "committed"
  | "verified"
  | "reviewed"
  | "proposing"
  | "effect_unknown"
  | "awaiting_ci"
  | "awaiting_human"
  | "merged"
  | "post_merge_verified"
  | "closed"
  | "blocked"
  | "cancelled"
  | "failed"
  | "stale";

export interface RunRecord {
  id: string;
  repositoryId: string;
  taskId: string;
  taskDigest: string;
  configDigest: string;
  status: RunStatus;
  baseCommit: string;
  worktreePath?: string;
  contextDigest?: string;
  contextJson?: string;
  controlJson?: string;
  candidateCommit?: string;
  candidateTree?: string;
  deadlineAt: string;
  activeProcessId?: string;
  activePid?: number;
  activeProcessGroup?: number;
  activeProcessIdentity?: string;
  cancelRequested: boolean;
  repairCount: number;
  attemptCount: number;
  blockCode?: string;
  validationJson?: string;
  reviewJson?: string;
  deliveryJson?: string;
  remoteFeedbackJson?: string;
  createdAt: string;
  updatedAt: string;
}

export type PublicRunRecord = Omit<
  RunRecord,
  | "worktreePath"
  | "contextJson"
  | "controlJson"
  | "activeProcessId"
  | "activeProcessGroup"
  | "activeProcessIdentity"
  | "deliveryJson"
  | "remoteFeedbackJson"
>;

export function publicRunRecord(run: RunRecord): PublicRunRecord {
  const publicRun = { ...run };
  delete publicRun.worktreePath;
  delete publicRun.contextJson;
  delete publicRun.controlJson;
  delete publicRun.activeProcessId;
  delete publicRun.activeProcessGroup;
  delete publicRun.activeProcessIdentity;
  delete publicRun.deliveryJson;
  delete publicRun.remoteFeedbackJson;
  return publicRun;
}

interface RunRow {
  id: string;
  repository_id: string;
  task_id: string;
  task_digest: string;
  config_digest: string;
  status: RunStatus;
  base_commit: string;
  worktree_path: string | null;
  context_digest: string | null;
  context_json: string | null;
  control_json: string | null;
  candidate_commit: string | null;
  candidate_tree: string | null;
  deadline_at: string;
  active_process_id: string | null;
  active_pid: number | null;
  active_process_group: number | null;
  active_process_identity: string | null;
  cancel_requested: number;
  repair_count: number;
  attempt_count: number;
  block_code: string | null;
  validation_json: string | null;
  review_json: string | null;
  delivery_json: string | null;
  remote_feedback_json: string | null;
  created_at: string;
  updated_at: string;
}

const terminal = new Set<RunStatus>(["closed", "cancelled", "failed", "stale"]);

export function isTerminalRun(status: RunStatus): boolean {
  return terminal.has(status);
}

export function isPurgeSafeRun(status: RunStatus): boolean {
  return status === "reviewed" || isTerminalRun(status);
}

const transitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  approved: ["ready", "blocked", "cancelled", "failed"],
  ready: ["running", "blocked", "cancelled", "failed", "stale"],
  running: ["committed", "blocked", "cancelled", "failed", "stale"],
  committed: ["verified", "blocked", "cancelled", "failed", "stale"],
  verified: ["reviewed", "blocked", "cancelled", "failed", "stale"],
  reviewed: ["proposing", "cancelled", "failed", "stale"],
  proposing: [
    "effect_unknown",
    "awaiting_ci",
    "blocked",
    "cancelled",
    "failed",
    "stale",
  ],
  effect_unknown: [
    "proposing",
    "awaiting_ci",
    "blocked",
    "cancelled",
    "failed",
    "stale",
  ],
  awaiting_ci: [
    "awaiting_human",
    "blocked",
    "effect_unknown",
    "cancelled",
    "failed",
    "stale",
  ],
  awaiting_human: ["merged", "blocked", "failed", "stale"],
  merged: ["post_merge_verified", "blocked", "failed", "stale"],
  post_merge_verified: ["closed", "blocked", "failed", "stale"],
  closed: [],
  blocked: [
    "ready",
    "running",
    "committed",
    "verified",
    "proposing",
    "awaiting_ci",
    "awaiting_human",
    "merged",
    "post_merge_verified",
    "cancelled",
    "failed",
    "stale",
  ],
  cancelled: [],
  failed: [],
  stale: [],
};

function stateRoot(): string {
  const configured = process.env.MILL_STATE_HOME;
  if (configured !== undefined) {
    if (!path.isAbsolute(configured)) {
      throw new MillError(
        "INVALID_STATE_HOME",
        "MILL_STATE_HOME must be absolute.",
        ExitCode.configuration,
      );
    }
    return configured;
  }
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "mill");
  }
  const xdg = process.env.XDG_STATE_HOME;
  return xdg !== undefined && path.isAbsolute(xdg)
    ? path.join(xdg, "mill")
    : path.join(homedir(), ".local", "state", "mill");
}

function namespace(repositoryId: string, commonDirectory: string): string {
  return createHash("sha256")
    .update(`${repositoryId}\0${path.resolve(commonDirectory)}`, "utf8")
    .digest("hex");
}

export function repositoryStateDirectory(
  repositoryId: string,
  commonDirectory: string,
): string {
  return path.join(
    stateRoot(),
    "repositories",
    namespace(repositoryId, commonDirectory),
  );
}

function fromRow(row: RunRow): RunRecord {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    taskId: row.task_id,
    taskDigest: row.task_digest,
    configDigest: row.config_digest,
    status: row.status,
    baseCommit: row.base_commit,
    ...(row.worktree_path === null ? {} : { worktreePath: row.worktree_path }),
    ...(row.context_digest === null
      ? {}
      : { contextDigest: row.context_digest }),
    ...(row.context_json === null ? {} : { contextJson: row.context_json }),
    ...(row.control_json === null ? {} : { controlJson: row.control_json }),
    ...(row.candidate_commit === null
      ? {}
      : { candidateCommit: row.candidate_commit }),
    ...(row.candidate_tree === null
      ? {}
      : { candidateTree: row.candidate_tree }),
    deadlineAt: row.deadline_at,
    ...(row.active_process_id === null
      ? {}
      : { activeProcessId: row.active_process_id }),
    ...(row.active_pid === null ? {} : { activePid: row.active_pid }),
    ...(row.active_process_group === null
      ? {}
      : { activeProcessGroup: row.active_process_group }),
    ...(row.active_process_identity === null
      ? {}
      : { activeProcessIdentity: row.active_process_identity }),
    cancelRequested: row.cancel_requested === 1,
    repairCount: row.repair_count,
    attemptCount: row.attempt_count,
    ...(row.block_code === null ? {} : { blockCode: row.block_code }),
    ...(row.validation_json === null
      ? {}
      : { validationJson: row.validation_json }),
    ...(row.review_json === null ? {} : { reviewJson: row.review_json }),
    ...(row.delivery_json === null ? {} : { deliveryJson: row.delivery_json }),
    ...(row.remote_feedback_json === null
      ? {}
      : { remoteFeedbackJson: row.remote_feedback_json }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class StateStore {
  readonly directory: string;
  readonly databasePath: string;
  readonly worktreesDirectory: string;
  readonly #database: DatabaseSync;
  #closed = false;

  private constructor(directory: string, database: DatabaseSync) {
    this.directory = directory;
    this.databasePath = path.join(directory, "state.sqlite3");
    this.worktreesDirectory = path.join(directory, "worktrees");
    this.#database = database;
  }

  static async open(
    repositoryId: string,
    commonDirectory: string,
  ): Promise<StateStore> {
    const directory = repositoryStateDirectory(repositoryId, commonDirectory);
    await mkdir(path.join(directory, "worktrees"), {
      recursive: true,
      mode: 0o700,
    });
    await chmod(directory, 0o700);
    await chmod(path.join(directory, "worktrees"), 0o700);
    const databasePath = path.join(directory, "state.sqlite3");
    const database = new DatabaseSync(databasePath, {
      timeout: 5_000,
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
    });
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA trusted_schema = OFF;
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      INSERT OR IGNORE INTO metadata(key, value) VALUES ('schema_version', '1');
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        task_digest TEXT NOT NULL,
        config_digest TEXT NOT NULL,
        status TEXT NOT NULL,
        base_commit TEXT NOT NULL,
        worktree_path TEXT,
        context_digest TEXT,
        context_json TEXT,
        control_json TEXT,
        candidate_commit TEXT,
        candidate_tree TEXT,
        deadline_at TEXT NOT NULL,
        active_process_id TEXT,
        active_pid INTEGER,
        active_process_group INTEGER,
        active_process_identity TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0, 1)),
        repair_count INTEGER NOT NULL DEFAULT 0 CHECK(repair_count BETWEEN 0 AND 1),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 2),
        block_code TEXT,
        validation_json TEXT,
        review_json TEXT,
        delivery_json TEXT,
        remote_feedback_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS run_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(id),
        occurred_at TEXT NOT NULL,
        type TEXT NOT NULL,
        data_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS baseline_qualifications (
        approval_digest TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        task_digest TEXT NOT NULL,
        config_digest TEXT NOT NULL,
        base_commit TEXT NOT NULL,
        evidence_digest TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS run_events_no_update
        BEFORE UPDATE ON run_events BEGIN SELECT RAISE(ABORT, 'run events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS run_events_no_delete
        BEFORE DELETE ON run_events BEGIN SELECT RAISE(ABORT, 'run events are append-only'); END;
    `);
    const runColumns = database
      .prepare("PRAGMA table_info(runs)")
      .all() as unknown as { name: string }[];
    for (const column of [
      "active_process_id TEXT",
      "active_process_group INTEGER",
      "active_process_identity TEXT",
      "delivery_json TEXT",
      "remote_feedback_json TEXT",
    ]) {
      const name = column.split(" ")[0];
      if (!runColumns.some((candidate) => candidate.name === name)) {
        database.exec(`ALTER TABLE runs ADD COLUMN ${column}`);
      }
    }
    const version = database
      .prepare("SELECT value FROM metadata WHERE key = 'schema_version'")
      .get() as { value?: string } | undefined;
    if (version?.value !== "1") {
      database.close();
      throw new MillError(
        "UNSUPPORTED_STATE_SCHEMA",
        "Operational state uses an unsupported schema version.",
        ExitCode.configuration,
      );
    }
    await chmod(databasePath, 0o600);
    return new StateStore(directory, database);
  }

  close(): void {
    if (!this.#closed) {
      this.#database.close();
      this.#closed = true;
    }
  }

  createRun(input: {
    repositoryId: string;
    taskId: string;
    taskDigest: string;
    configDigest: string;
    baseCommit: string;
    deadlineAt: string;
  }): RunRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.#transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO runs(
            id, repository_id, task_id, task_digest, config_digest, status,
            base_commit, deadline_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.repositoryId,
          input.taskId,
          input.taskDigest,
          input.configDigest,
          input.baseCommit,
          input.deadlineAt,
          now,
          now,
        );
      this.#event(id, "run.created", { status: "approved" });
    });
    return this.getRun(id);
  }

  getRun(id: string): RunRecord {
    const row = this.#database
      .prepare("SELECT * FROM runs WHERE id = ?")
      .get(id) as RunRow | undefined;
    if (row === undefined) {
      throw new MillError(
        "RUN_NOT_FOUND",
        `Run not found: ${id}`,
        ExitCode.data,
      );
    }
    return fromRow(row);
  }

  latestRun(): RunRecord | undefined {
    const row = this.#database
      .prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT 1")
      .get() as RunRow | undefined;
    return row === undefined ? undefined : fromRow(row);
  }

  runs(): readonly RunRecord[] {
    return (
      this.#database
        .prepare("SELECT * FROM runs ORDER BY created_at")
        .all() as unknown as RunRow[]
    ).map(fromRow);
  }

  transition(
    id: string,
    to: RunStatus,
    eventType: string,
    details: Record<string, string | number | boolean | null> = {},
  ): RunRecord {
    this.#transaction(() => {
      const current = this.getRun(id);
      if (!transitions[current.status].includes(to)) {
        throw new MillError(
          "INVALID_RUN_TRANSITION",
          `Cannot transition run from ${current.status} to ${to}.`,
          ExitCode.configuration,
        );
      }
      if (to === "running" && current.cancelRequested) {
        throw new MillError(
          "OPERATOR_CANCELLED",
          "A cancelled run cannot start or resume execution.",
          ExitCode.temporary,
        );
      }
      if (to === "cancelled" && current.activeProcessId !== undefined) {
        throw new MillError(
          "CANCELLATION_IN_PROGRESS",
          "The active execution must exit or be reconciled before cancellation is terminal.",
          ExitCode.temporary,
        );
      }
      const now = new Date().toISOString();
      this.#database
        .prepare(
          "UPDATE runs SET status = ?, block_code = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          to,
          typeof details.code === "string" ? details.code : null,
          now,
          id,
        );
      this.#event(id, eventType, { from: current.status, to, ...details });
    });
    return this.getRun(id);
  }

  setWorkspace(
    id: string,
    worktreePath: string,
    contextDigest: string,
    contextJson: string,
    controlJson: string,
  ): void {
    this.#transaction(() => {
      const current = this.getRun(id);
      if (
        current.status !== "ready" ||
        current.worktreePath !== undefined ||
        current.contextDigest !== undefined ||
        current.contextJson !== undefined ||
        current.controlJson !== undefined
      ) {
        throw new MillError(
          "INVALID_RUN_TRANSITION",
          "A workspace can be bound exactly once while the run is ready.",
          ExitCode.configuration,
        );
      }
      this.#database
        .prepare(
          "UPDATE runs SET worktree_path = ?, context_digest = ?, context_json = ?, control_json = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          worktreePath,
          contextDigest,
          contextJson,
          controlJson,
          new Date().toISOString(),
          id,
        );
      this.#event(id, "workspace.created", { contextDigest });
    });
  }

  commitCandidate(id: string, commit: string, tree: string): RunRecord {
    this.#transaction(() => {
      const current = this.getRun(id);
      if (current.cancelRequested) {
        throw new MillError(
          "OPERATOR_CANCELLED",
          "A cancelled run cannot publish a candidate commit.",
          ExitCode.temporary,
        );
      }
      if (current.status !== "running") {
        throw new MillError(
          "INVALID_RUN_TRANSITION",
          `Cannot commit a candidate from ${current.status}.`,
          ExitCode.configuration,
        );
      }
      this.#database
        .prepare(
          `UPDATE runs SET candidate_commit = ?, candidate_tree = ?,
           validation_json = NULL, review_json = NULL,
           remote_feedback_json = NULL, status = 'committed',
           block_code = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(commit, tree, new Date().toISOString(), id);
      this.#event(id, "candidate.committed", {
        from: current.status,
        to: "committed",
        commit,
        tree,
      });
    });
    return this.getRun(id);
  }

  completeValidation(id: string, value: string, passed: boolean): RunRecord {
    this.#transaction(() => {
      const current = this.getRun(id);
      if (current.cancelRequested) {
        throw new MillError(
          "OPERATOR_CANCELLED",
          "A cancelled run cannot publish validation evidence.",
          ExitCode.temporary,
        );
      }
      if (current.status !== "committed") {
        throw new MillError(
          "INVALID_RUN_TRANSITION",
          `Cannot record validation from ${current.status}.`,
          ExitCode.configuration,
        );
      }
      const status: RunStatus = passed ? "verified" : "blocked";
      const code = passed ? null : "VALIDATION_FAILED";
      this.#database
        .prepare(
          "UPDATE runs SET validation_json = ?, status = ?, block_code = ?, updated_at = ? WHERE id = ?",
        )
        .run(value, status, code, new Date().toISOString(), id);
      this.#event(id, passed ? "validation.passed" : "validation.failed", {
        from: current.status,
        to: status,
        ...(code === null ? {} : { code }),
      });
    });
    return this.getRun(id);
  }

  completeReview(
    id: string,
    value: string,
    findings: number,
    nonConverged: boolean,
  ): RunRecord {
    this.#transaction(() => {
      const current = this.getRun(id);
      if (current.cancelRequested) {
        throw new MillError(
          "OPERATOR_CANCELLED",
          "A cancelled run cannot publish review evidence.",
          ExitCode.temporary,
        );
      }
      if (current.status !== "verified") {
        throw new MillError(
          "INVALID_RUN_TRANSITION",
          `Cannot record review from ${current.status}.`,
          ExitCode.configuration,
        );
      }
      const status: RunStatus = findings === 0 ? "reviewed" : "blocked";
      const code =
        findings === 0
          ? null
          : nonConverged
            ? "REVIEW_NON_CONVERGENCE"
            : "REVIEW_FINDINGS";
      this.#database
        .prepare(
          "UPDATE runs SET review_json = ?, status = ?, block_code = ?, updated_at = ? WHERE id = ?",
        )
        .run(value, status, code, new Date().toISOString(), id);
      this.#event(id, findings === 0 ? "review.passed" : "review.blocked", {
        from: current.status,
        to: status,
        findings,
        ...(code === null ? {} : { code }),
      });
    });
    return this.getRun(id);
  }

  setDelivery(
    id: string,
    deliveryJson: string,
    eventType: string,
    details: Record<string, string | number | boolean | null> = {},
  ): RunRecord {
    this.#transaction(() => {
      this.getRun(id);
      this.#database
        .prepare(
          "UPDATE runs SET delivery_json = ?, updated_at = ? WHERE id = ?",
        )
        .run(deliveryJson, new Date().toISOString(), id);
      this.#event(id, eventType, details);
    });
    return this.getRun(id);
  }

  setRemoteFeedback(id: string, feedbackJson: string): RunRecord {
    this.#transaction(() => {
      this.getRun(id);
      this.#database
        .prepare(
          "UPDATE runs SET remote_feedback_json = ?, updated_at = ? WHERE id = ?",
        )
        .run(feedbackJson, new Date().toISOString(), id);
      this.#event(id, "remote.feedback_recorded", {});
    });
    return this.getRun(id);
  }

  replaceBlocker(
    id: string,
    code: string,
    eventType: string,
    details: Record<string, string | number | boolean | null> = {},
  ): RunRecord {
    this.#transaction(() => {
      const current = this.getRun(id);
      if (current.status !== "blocked") {
        throw new MillError(
          "INVALID_RUN_TRANSITION",
          `Cannot replace a blocker while run is ${current.status}.`,
          ExitCode.configuration,
        );
      }
      this.#database
        .prepare("UPDATE runs SET block_code = ?, updated_at = ? WHERE id = ?")
        .run(code, new Date().toISOString(), id);
      this.#event(id, eventType, {
        from: current.blockCode ?? null,
        to: code,
        ...details,
      });
    });
    return this.getRun(id);
  }

  beginRepair(id: string): RunRecord {
    this.#transaction(() => {
      const current = this.getRun(id);
      if (current.cancelRequested) {
        throw new MillError(
          "OPERATOR_CANCELLED",
          "A cancelled run cannot begin a repair execution.",
          ExitCode.temporary,
        );
      }
      if (current.status !== "blocked" || current.repairCount >= 1) {
        throw new MillError(
          "REPAIR_BUDGET_EXHAUSTED",
          "The single systemic repair budget is exhausted or the run is not blocked.",
          ExitCode.configuration,
        );
      }
      this.#database
        .prepare(
          "UPDATE runs SET repair_count = repair_count + 1, status = 'running', block_code = NULL, updated_at = ? WHERE id = ?",
        )
        .run(new Date().toISOString(), id);
      this.#event(id, "repair.started", {
        from: current.status,
        to: "running",
        repairCount: current.repairCount + 1,
      });
    });
    return this.getRun(id);
  }

  beginReviewAttempt(id: string, maximum: number): void {
    this.#transaction(() => {
      const current = this.getRun(id);
      if (current.cancelRequested) {
        throw new MillError(
          "OPERATOR_CANCELLED",
          "A cancelled run cannot begin a review attempt.",
          ExitCode.temporary,
        );
      }
      if (current.status !== "verified") {
        throw new MillError(
          "INVALID_RUN_TRANSITION",
          `Cannot begin review from ${current.status}.`,
          ExitCode.configuration,
        );
      }
      if (current.candidateCommit === undefined) {
        throw new MillError(
          "CANDIDATE_MISSING",
          "A review attempt requires an exact committed candidate.",
          ExitCode.configuration,
        );
      }
      const row = this.#database
        .prepare(
          `SELECT COUNT(*) AS count FROM run_events
           WHERE run_id = ? AND type = 'review.started'
             AND json_extract(data_json, '$.candidateCommit') = ?`,
        )
        .get(id, current.candidateCommit) as { count: number };
      if (row.count >= maximum) {
        throw new MillError(
          "REVIEW_RETRY_BUDGET_EXHAUSTED",
          "The bounded review attempt budget is exhausted.",
          ExitCode.configuration,
        );
      }
      this.#event(id, "review.started", {
        candidateCommit: current.candidateCommit,
        attempt: row.count + 1,
      });
    });
  }

  recordBaselineQualification(input: {
    approvalDigest: string;
    repositoryId: string;
    taskDigest: string;
    configDigest: string;
    baseCommit: string;
    evidenceDigest: string;
  }): void {
    this.#transaction(() => {
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO baseline_qualifications(
            approval_digest, repository_id, task_digest, config_digest,
            base_commit, evidence_digest, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.approvalDigest,
          input.repositoryId,
          input.taskDigest,
          input.configDigest,
          input.baseCommit,
          input.evidenceDigest,
          new Date().toISOString(),
        );
      const stored = this.#database
        .prepare(
          `SELECT repository_id, task_digest, config_digest, base_commit,
                  evidence_digest
           FROM baseline_qualifications WHERE approval_digest = ?`,
        )
        .get(input.approvalDigest) as
        | {
            repository_id: string;
            task_digest: string;
            config_digest: string;
            base_commit: string;
            evidence_digest: string;
          }
        | undefined;
      if (
        stored?.repository_id !== input.repositoryId ||
        stored.task_digest !== input.taskDigest ||
        stored.config_digest !== input.configDigest ||
        stored.base_commit !== input.baseCommit ||
        stored.evidence_digest !== input.evidenceDigest
      ) {
        throw new MillError(
          "QUALIFICATION_IDENTITY_COLLISION",
          "Baseline qualification identity conflicts with stored state.",
          ExitCode.io,
        );
      }
    });
  }

  hasBaselineQualification(input: {
    approvalDigest: string;
    repositoryId: string;
    taskDigest: string;
    configDigest: string;
    baseCommit: string;
  }): boolean {
    const row = this.#database
      .prepare(
        `SELECT 1 AS present FROM baseline_qualifications
         WHERE approval_digest = ? AND repository_id = ? AND task_digest = ?
           AND config_digest = ? AND base_commit = ?`,
      )
      .get(
        input.approvalDigest,
        input.repositoryId,
        input.taskDigest,
        input.configDigest,
        input.baseCommit,
      ) as { present: number } | undefined;
    return row?.present === 1;
  }

  beginBuilderAttempt(id: string, maximum: number): void {
    if (this.getRun(id).cancelRequested) {
      throw new MillError(
        "OPERATOR_CANCELLED",
        "A cancelled run cannot consume another builder attempt.",
        ExitCode.temporary,
      );
    }
    const result = this.#database
      .prepare(
        `UPDATE runs SET attempt_count = attempt_count + 1, updated_at = ?
         WHERE id = ? AND attempt_count < ? AND cancel_requested = 0`,
      )
      .run(new Date().toISOString(), id, maximum);
    if (result.changes !== 1) {
      if (this.getRun(id).cancelRequested) {
        throw new MillError(
          "OPERATOR_CANCELLED",
          "A cancelled run cannot consume another builder attempt.",
          ExitCode.temporary,
        );
      }
      throw new MillError(
        "BUILDER_RETRY_BUDGET_EXHAUSTED",
        "The builder retry budget is exhausted.",
        ExitCode.configuration,
      );
    }
  }

  setActiveProcess(
    id: string,
    process: {
      id: string;
      pid: number;
      processGroup: number;
      identity: string;
    } | null,
  ): void {
    if (
      process !== null &&
      (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        process.id,
      ) ||
        !Number.isSafeInteger(process.pid) ||
        process.pid <= 0 ||
        process.processGroup !== process.pid ||
        !/^sha256:[a-f0-9]{64}$/u.test(process.identity))
    ) {
      throw new MillError(
        "INVALID_PROCESS_IDENTITY",
        "An active PID and its opaque process-start identity must be stored together.",
        ExitCode.configuration,
      );
    }
    if (process === null) {
      this.#database
        .prepare(
          "UPDATE runs SET active_process_id = NULL, active_pid = NULL, active_process_group = NULL, active_process_identity = NULL, updated_at = ? WHERE id = ?",
        )
        .run(new Date().toISOString(), id);
      return;
    }
    const result = this.#database
      .prepare(
        `UPDATE runs SET active_process_id = ?, active_pid = ?,
         active_process_group = ?, active_process_identity = ?, updated_at = ?
         WHERE id = ? AND cancel_requested = 0 AND active_process_id IS NULL`,
      )
      .run(
        process.id,
        process.pid,
        process.processGroup,
        process.identity,
        new Date().toISOString(),
        id,
      );
    if (result.changes !== 1) {
      throw new MillError(
        "ACTIVE_PROCESS_BINDING_REJECTED",
        "Cancellation or another active execution won before process binding.",
        ExitCode.temporary,
      );
    }
  }

  clearActiveProcess(id: string, processId: string): void {
    this.#database
      .prepare(
        `UPDATE runs SET active_process_id = NULL, active_pid = NULL,
         active_process_group = NULL, active_process_identity = NULL,
         updated_at = ? WHERE id = ? AND active_process_id = ?`,
      )
      .run(new Date().toISOString(), id, processId);
  }

  requestCancellation(id: string): RunRecord {
    this.#transaction(() => {
      const run = this.getRun(id);
      if (terminal.has(run.status)) return;
      this.#database
        .prepare(
          "UPDATE runs SET cancel_requested = 1, updated_at = ? WHERE id = ?",
        )
        .run(new Date().toISOString(), id);
      this.#event(id, "run.cancellation_requested", {});
    });
    return this.getRun(id);
  }

  async backup(): Promise<string> {
    const destination = path.join(
      this.directory,
      `state-backup-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}.sqlite3`,
    );
    await backup(this.#database, destination);
    await chmod(destination, 0o600);
    return destination;
  }

  events(id: string): readonly Record<string, unknown>[] {
    return this.#database
      .prepare(
        "SELECT sequence, occurred_at, type, data_json FROM run_events WHERE run_id = ? ORDER BY sequence",
      )
      .all(id)
      .map((row) => {
        const item = row as {
          sequence: number;
          occurred_at: string;
          type: string;
          data_json: string;
        };
        return {
          sequence: item.sequence,
          occurredAt: item.occurred_at,
          type: item.type,
          data: JSON.parse(item.data_json) as unknown,
        };
      });
  }

  recordEvent(
    id: string,
    type: string,
    data: Record<string, string | number | boolean | null>,
  ): void {
    this.#transaction(() => this.#event(id, type, data));
  }

  #transaction(action: () => void): void {
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      action();
      this.#database.exec("COMMIT");
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the original state error.
      }
      if (error instanceof MillError) throw error;
      throw new MillError(
        "STATE_WRITE_FAILED",
        "Operational state transaction failed.",
        ExitCode.io,
        { cause: String(error) },
      );
    }
  }

  #event(id: string, type: string, data: Record<string, unknown>): void {
    this.#database
      .prepare(
        "INSERT INTO run_events(run_id, occurred_at, type, data_json) VALUES (?, ?, ?, ?)",
      )
      .run(id, new Date().toISOString(), type, JSON.stringify(data));
  }
}

export interface WriterLease {
  release(): Promise<void>;
}

export async function acquireWriterLease(
  store: StateStore,
): Promise<WriterLease> {
  const leasePath = path.join(store.directory, "writer-lease.sqlite3");
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(leasePath, {
      timeout: 0,
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
    });
    database.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS lease_anchor (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1)
      ) STRICT;
      BEGIN EXCLUSIVE;
    `);
    await chmod(leasePath, 0o600);
  } catch (error) {
    try {
      database?.close();
    } catch {
      // Preserve the acquisition error.
    }
    if (
      error instanceof Error &&
      "errcode" in error &&
      (error.errcode === 5 || error.errcode === 6)
    ) {
      throw new MillError(
        "WRITER_ALREADY_ACTIVE",
        "Another Mill writer is active for this repository.",
        ExitCode.temporary,
      );
    }
    throw new MillError(
      "WRITER_LEASE_UNAVAILABLE",
      "The repository writer lease could not be acquired safely.",
      ExitCode.io,
      { cause: String(error) },
    );
  }
  let released = false;
  return {
    release(): Promise<void> {
      if (released) return Promise.resolve();
      released = true;
      try {
        database.exec("ROLLBACK");
      } finally {
        database.close();
      }
      return Promise.resolve();
    },
  };
}

export async function restoreStateBackup(
  repositoryId: string,
  commonDirectory: string,
  backupPath: string,
): Promise<StateRestoreReport> {
  const directory = repositoryStateDirectory(repositoryId, commonDirectory);
  const resolvedBackup = path.resolve(backupPath);
  if (!isWithin(directory, resolvedBackup)) {
    throw new MillError(
      "INVALID_STATE_BACKUP",
      "State backup must be a Mill-owned file in this repository namespace.",
      ExitCode.configuration,
    );
  }
  const information = await lstat(resolvedBackup);
  if (!information.isFile() || information.isSymbolicLink()) {
    throw new MillError(
      "INVALID_STATE_BACKUP",
      "State backup is not a regular file.",
      ExitCode.configuration,
    );
  }
  const databasePath = path.join(directory, "state.sqlite3");
  const temporaryPath = path.join(directory, `restore-${randomUUID()}.sqlite3`);
  const expectedWorktrees = new Set<string>();
  let quarantineManifest: string | undefined;
  const moved: { original: string; quarantined: string }[] = [];
  try {
    await copyFile(resolvedBackup, temporaryPath, constants.COPYFILE_EXCL);
    await chmod(temporaryPath, 0o600);
    let candidate: DatabaseSync | undefined;
    try {
      candidate = new DatabaseSync(temporaryPath, {
        readOnly: true,
        allowExtension: false,
        enableDoubleQuotedStringLiterals: false,
      });
      candidate.exec("PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON;");
      const integrity = candidate.prepare("PRAGMA integrity_check").get() as
        { integrity_check?: string } | undefined;
      const version = candidate
        .prepare("SELECT value FROM metadata WHERE key = 'schema_version'")
        .get() as { value?: string } | undefined;
      const requiredObjects = candidate
        .prepare(
          `SELECT name FROM sqlite_schema
           WHERE (type = 'table' AND name IN ('metadata', 'runs', 'run_events'))
              OR (type = 'table' AND name = 'baseline_qualifications')
              OR (type = 'trigger' AND name IN ('run_events_no_update', 'run_events_no_delete'))`,
        )
        .all() as unknown as { name: string }[];
      const worktrees = candidate
        .prepare(
          "SELECT worktree_path FROM runs WHERE worktree_path IS NOT NULL",
        )
        .all() as unknown as { worktree_path: string }[];
      if (
        integrity?.integrity_check !== "ok" ||
        version?.value !== "1" ||
        new Set(requiredObjects.map((object) => object.name)).size !== 6
      ) {
        throw new Error("backup integrity, schema version, or objects invalid");
      }
      const worktreesDirectory = path.join(directory, "worktrees");
      for (const row of worktrees) {
        const resolved = path.resolve(row.worktree_path);
        if (!isWithin(worktreesDirectory, resolved)) {
          throw new Error("backup references a worktree outside Mill state");
        }
        expectedWorktrees.add(resolved);
      }
    } catch (error) {
      throw new MillError(
        "INVALID_STATE_BACKUP",
        "State backup failed integrity and schema validation.",
        ExitCode.data,
        { cause: String(error) },
      );
    } finally {
      candidate?.close();
    }
    const worktreesDirectory = path.join(directory, "worktrees");
    const entries = await readdir(worktreesDirectory, { withFileTypes: true });
    const orphaned = entries
      .map((entry) => ({
        entry,
        original: path.join(worktreesDirectory, entry.name),
      }))
      .filter(({ original }) => !expectedWorktrees.has(path.resolve(original)));
    if (orphaned.length > 0) {
      for (const { entry } of orphaned) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          throw new MillError(
            "UNSAFE_ORPHANED_WORKTREE",
            "Restore found an unclassified entry in the Mill worktree directory.",
            ExitCode.configuration,
            { name: entry.name },
          );
        }
      }
      const quarantineId = `restore-${new Date()
        .toISOString()
        .replaceAll(/[:.]/gu, "-")}-${randomUUID()}`;
      const quarantineDirectory = path.join(
        directory,
        "quarantine",
        quarantineId,
      );
      await mkdir(quarantineDirectory, { recursive: true, mode: 0o700 });
      await chmod(quarantineDirectory, 0o700);
      quarantineManifest = path.join(quarantineDirectory, "manifest.json");
      const planned = orphaned.map(({ entry, original }) => ({
        original,
        quarantined: path.join(quarantineDirectory, entry.name),
      }));
      await writeFile(
        quarantineManifest,
        `${JSON.stringify(
          {
            schemaVersion: "1",
            repositoryId,
            backupPath: resolvedBackup,
            protocol: "database_swap_commit_point",
            worktrees: planned,
          },
          null,
          2,
        )}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      for (const item of planned) {
        await rename(item.original, item.quarantined);
        moved.push(item);
      }
    }
    await rm(`${databasePath}-wal`, { force: true });
    await rm(`${databasePath}-shm`, { force: true });
    await rename(temporaryPath, databasePath);
    return {
      quarantinedCount: moved.length,
      ...(quarantineManifest === undefined ? {} : { quarantineManifest }),
    };
  } catch (error) {
    for (const item of moved.toReversed()) {
      try {
        await rename(item.quarantined, item.original);
      } catch {
        // The recovery manifest preserves attended recovery evidence.
      }
    }
    throw error;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export interface StateRestoreReport {
  quarantinedCount: number;
  quarantineManifest?: string;
}

export async function purgeRepositoryState(
  repositoryId: string,
  commonDirectory: string,
): Promise<void> {
  const directory = repositoryStateDirectory(repositoryId, commonDirectory);
  try {
    await access(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
  await rm(directory, { recursive: true });
}
