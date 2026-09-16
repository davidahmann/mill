-- Exact v0.5.0 state table shape from src/runtime/state-migrations.ts.
-- The fixture omits only runtime-generated timestamps and row values.
CREATE TABLE runs (
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
CREATE TABLE run_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  occurred_at TEXT NOT NULL,
  type TEXT NOT NULL,
  data_json TEXT NOT NULL
) STRICT;
CREATE TABLE baseline_qualifications (
  approval_digest TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  task_digest TEXT NOT NULL,
  config_digest TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE worker_invocations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  phase TEXT NOT NULL,
  envelope_digest TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE worker_invocation_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  invocation_id TEXT NOT NULL REFERENCES worker_invocations(id),
  occurred_at TEXT NOT NULL,
  type TEXT NOT NULL,
  data_json TEXT NOT NULL
) STRICT;
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER run_events_no_update
  BEFORE UPDATE ON run_events BEGIN SELECT RAISE(ABORT, 'run events are append-only'); END;
CREATE TRIGGER run_events_no_delete
  BEFORE DELETE ON run_events BEGIN SELECT RAISE(ABORT, 'run events are append-only'); END;
CREATE TRIGGER worker_invocations_no_update
  BEFORE UPDATE ON worker_invocations BEGIN SELECT RAISE(ABORT, 'worker invocations are immutable'); END;
CREATE TRIGGER worker_invocations_no_delete
  BEFORE DELETE ON worker_invocations BEGIN SELECT RAISE(ABORT, 'worker invocations are immutable'); END;
CREATE TRIGGER worker_invocation_events_no_update
  BEFORE UPDATE ON worker_invocation_events BEGIN SELECT RAISE(ABORT, 'worker invocation events are append-only'); END;
CREATE TRIGGER worker_invocation_events_no_delete
  BEFORE DELETE ON worker_invocation_events BEGIN SELECT RAISE(ABORT, 'worker invocation events are append-only'); END;
