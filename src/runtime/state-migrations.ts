import type { DatabaseSync } from "node:sqlite";

import { ExitCode, MillError } from "../errors.js";

export const CURRENT_STATE_SCHEMA_VERSION = 3;

export interface AppliedStateMigration {
  version: number;
  name: string;
  appliedAt: string;
}

interface StateMigration {
  version: number;
  name: string;
  apply(database: DatabaseSync): void;
}

function createInitialTables(database: DatabaseSync): void {
  database.exec(`
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
    CREATE TABLE IF NOT EXISTS worker_invocations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      phase TEXT NOT NULL,
      envelope_digest TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS worker_invocation_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      invocation_id TEXT NOT NULL REFERENCES worker_invocations(id),
      occurred_at TEXT NOT NULL,
      type TEXT NOT NULL,
      data_json TEXT NOT NULL
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS run_events_no_update
      BEFORE UPDATE ON run_events BEGIN SELECT RAISE(ABORT, 'run events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS run_events_no_delete
      BEFORE DELETE ON run_events BEGIN SELECT RAISE(ABORT, 'run events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS worker_invocations_no_update
      BEFORE UPDATE ON worker_invocations BEGIN SELECT RAISE(ABORT, 'worker invocations are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS worker_invocations_no_delete
      BEFORE DELETE ON worker_invocations BEGIN SELECT RAISE(ABORT, 'worker invocations are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS worker_invocation_events_no_update
      BEFORE UPDATE ON worker_invocation_events BEGIN SELECT RAISE(ABORT, 'worker invocation events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS worker_invocation_events_no_delete
      BEFORE DELETE ON worker_invocation_events BEGIN SELECT RAISE(ABORT, 'worker invocation events are append-only'); END;
  `);
}

function columnNames(database: DatabaseSync, table: string): Set<string> {
  return new Set(
    (
      database.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
        name: string;
      }[]
    ).map((column) => column.name),
  );
}

function addV2RunColumns(database: DatabaseSync): void {
  const columns = columnNames(database, "runs");
  for (const column of [
    "active_process_id TEXT",
    "active_process_group INTEGER",
    "active_process_identity TEXT",
    "delivery_json TEXT",
    "remote_feedback_json TEXT",
  ]) {
    const [name] = column.split(" ");
    if (name !== undefined && !columns.has(name)) {
      database.exec(`ALTER TABLE runs ADD COLUMN ${column}`);
    }
  }
}

const stateMigrations: readonly StateMigration[] = [
  {
    version: 1,
    name: "initial-durable-state",
    apply: createInitialTables,
  },
  {
    version: 2,
    name: "worker-and-delivery-recovery-columns",
    apply: addV2RunColumns,
  },
  {
    version: 3,
    name: "numbered-migration-ledger",
    apply: () => undefined,
  },
];

function stateVersion(database: DatabaseSync): number {
  const row = database
    .prepare("SELECT value FROM metadata WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  if (row === undefined) return 0;
  if (!/^[1-9][0-9]*$/u.test(row.value)) {
    throw new MillError(
      "UNSUPPORTED_STATE_SCHEMA",
      "Operational state uses an invalid schema version.",
      ExitCode.configuration,
    );
  }
  const version = Number(row.value);
  if (
    !Number.isSafeInteger(version) ||
    version > CURRENT_STATE_SCHEMA_VERSION
  ) {
    throw new MillError(
      "UNSUPPORTED_STATE_SCHEMA",
      "Operational state uses an unsupported schema version.",
      ExitCode.configuration,
    );
  }
  return version;
}

function recordMigration(
  database: DatabaseSync,
  migration: StateMigration,
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
       VALUES (?, ?, ?)`,
    )
    .run(migration.version, migration.name, new Date().toISOString());
  const stored = database
    .prepare("SELECT name FROM schema_migrations WHERE version = ?")
    .get(migration.version) as { name: string } | undefined;
  if (stored?.name !== migration.name) {
    throw new MillError(
      "STATE_MIGRATION_CONFLICT",
      "Operational state contains a conflicting recorded migration.",
      ExitCode.configuration,
    );
  }
}

function updateSchemaVersion(database: DatabaseSync, version: number): void {
  database
    .prepare(
      `INSERT INTO metadata(key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(String(version));
}

function applyMigration(
  database: DatabaseSync,
  migration: StateMigration,
): void {
  migration.apply(database);
  recordMigration(database, migration);
  updateSchemaVersion(database, migration.version);
}

function hasRecordedMigration(
  database: DatabaseSync,
  version: number,
): boolean {
  const row = database
    .prepare("SELECT 1 AS present FROM schema_migrations WHERE version = ?")
    .get(version) as { present: number } | undefined;
  return row?.present === 1;
}

function validateRecordedMigrations(
  database: DatabaseSync,
  current: number,
): void {
  const records = database
    .prepare("SELECT version, name FROM schema_migrations ORDER BY version ASC")
    .all() as unknown as { version: number; name: string }[];
  for (const record of records) {
    const migration = stateMigrations.find(
      (candidate) => candidate.version === record.version,
    );
    if (migration?.name !== record.name || record.version > current) {
      throw new MillError(
        "STATE_MIGRATION_CONFLICT",
        "Operational state contains an incompatible recorded migration.",
        ExitCode.configuration,
      );
    }
  }
}

export function applyStateMigrations(database: DatabaseSync): void {
  let transactionStarted = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    database.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    const current = stateVersion(database);
    validateRecordedMigrations(database, current);
    if (current === CURRENT_STATE_SCHEMA_VERSION) {
      assertCurrentStateMigrations(database);
    } else {
      for (const migration of stateMigrations) {
        if (migration.version <= current) {
          migration.apply(database);
          recordMigration(database, migration);
          continue;
        }
        applyMigration(database, migration);
      }
    }
    database.exec("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // The original migration failure is authoritative.
      }
    }
    if (error instanceof MillError) throw error;
    throw new MillError(
      "STATE_MIGRATION_FAILED",
      "Operational state migration failed.",
      ExitCode.io,
      { cause: String(error) },
    );
  }
}

export function stateMigrationHistory(
  database: DatabaseSync,
): AppliedStateMigration[] {
  return database
    .prepare(
      `SELECT version, name, applied_at
       FROM schema_migrations ORDER BY version ASC`,
    )
    .all()
    .map((row) => {
      const record = row as {
        version: number;
        name: string;
        applied_at: string;
      };
      return {
        version: record.version,
        name: record.name,
        appliedAt: record.applied_at,
      };
    });
}

export function assertCurrentStateMigrations(database: DatabaseSync): void {
  validateRecordedMigrations(database, CURRENT_STATE_SCHEMA_VERSION);
  for (const migration of stateMigrations) {
    if (!hasRecordedMigration(database, migration.version)) {
      throw new MillError(
        "STATE_MIGRATION_INCOMPLETE",
        "Operational state is missing a recorded migration.",
        ExitCode.configuration,
      );
    }
  }
}
