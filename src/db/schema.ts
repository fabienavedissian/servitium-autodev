export const SCHEMA_VERSION = 1;

// State lives here only to make a crashed run resumable; GitHub stays the source of
// truth for the queue and approvals. See AUTODEV-BUILD-PLAN-v1.md s4.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS task (
  id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  allowed_paths_json TEXT,            -- human-confirmed at SPEC_APPROVAL, not LLM-final
  spec_md TEXT,
  worktree_path TEXT,
  branch TEXT,
  prefix_hash TEXT,                   -- frozen context prefix hash (guard integrity)
  frozen_tests_json TEXT,             -- content hashes of TDD/red-team specs (immutability)
  loop_count INTEGER NOT NULL DEFAULT 0,
  opus_reentries INTEGER NOT NULL DEFAULT 0,
  budget_usd REAL NOT NULL,
  spent_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS step (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES task(id),
  role TEXT NOT NULL,
  model TEXT NOT NULL,
  phase TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_input_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  cost_usd REAL,
  summary TEXT,
  started_at TEXT,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS checkpoint (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES task(id),
  step_id INTEGER REFERENCES step(id),
  git_sha TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gate_result (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES task(id),
  step_id INTEGER REFERENCES step(id),
  gate TEXT NOT NULL,
  status TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spend_ledger (
  id INTEGER PRIMARY KEY,
  task_id INTEGER REFERENCES task(id),
  step_id INTEGER REFERENCES step(id),
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_input_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  cost_usd REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lesson (
  id INTEGER PRIMARY KEY,
  task_id INTEGER REFERENCES task(id),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  approved_at TEXT,                   -- null until a human approves it joining the prefix
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comment (
  id INTEGER PRIMARY KEY,
  task_id INTEGER REFERENCES task(id),
  body TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_step_task ON step(task_id);
CREATE INDEX IF NOT EXISTS idx_gate_task ON gate_result(task_id);
CREATE INDEX IF NOT EXISTS idx_spend_created ON spend_ledger(created_at);
`;
