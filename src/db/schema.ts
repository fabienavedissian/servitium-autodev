export const SCHEMA_VERSION = 3;

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
  detail TEXT,                        -- live fine-grained sub-status for the in-progress phase
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

CREATE TABLE IF NOT EXISTS proposal (
  id INTEGER PRIMARY KEY,
  rank INTEGER,
  title TEXT NOT NULL,
  category TEXT NOT NULL,             -- security | performance | refactor | test-gap | bug
  module TEXT,
  problem TEXT,
  solution TEXT,
  impact TEXT,                        -- high | medium | low
  effort TEXT,                        -- small | medium | large
  rationale TEXT,
  acceptance_hint TEXT,
  source TEXT,                        -- e.g. 'api-audit'
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed | approved | rejected | queued | done
  comment TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);

-- ── Intelligence Engine (SIE) — Phase 0 ──────────────────────────────────────
-- One row per daily veille run: idempotency guard (run_date UNIQUE) + cost + status.
CREATE TABLE IF NOT EXISTS sie_run (
  id INTEGER PRIMARY KEY,
  run_date TEXT NOT NULL UNIQUE,        -- 'YYYY-MM-DD' UTC, the once-per-day guard
  status TEXT NOT NULL,                 -- running|done|partial-budget|skipped-capped|error
  angles_run INTEGER DEFAULT 0,
  queries_run INTEGER DEFAULT 0,
  hits_fetched INTEGER DEFAULT 0,
  signals_new INTEGER DEFAULT 0,
  opportunities INTEGER DEFAULT 0,
  briefs INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  note TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

-- Raw deduped veille signals. Sources are columns (Phase 0 keeps it one table).
CREATE TABLE IF NOT EXISTS signal (
  id INTEGER PRIMARY KEY,
  run_id INTEGER REFERENCES sie_run(id),
  angle TEXT NOT NULL,                  -- tech|product|competitor|market|game|business|platform
  title TEXT NOT NULL,
  summary TEXT,
  dedup_key TEXT NOT NULL,              -- canonical-url OR lowercased-title key
  source_url TEXT,
  source_domain TEXT,
  source_type TEXT,
  claimed_date TEXT,
  seen_before INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'new',   -- new|promoted|stale|archived
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signal_dedup  ON signal(dedup_key);
CREATE INDEX IF NOT EXISTS idx_signal_status ON signal(status);

-- The ranked, scored, owner-facing artifact. Score is code-computed from feature_json.
CREATE TABLE IF NOT EXISTS opportunity (
  id INTEGER PRIMARY KEY,
  rank INTEGER,
  score INTEGER,                        -- 0..100, code-computed
  kind TEXT NOT NULL,                   -- feature|game|business|integration|pricing|tech-enabler
  angle TEXT NOT NULL,
  dedup_key TEXT NOT NULL,              -- slugified canonical noun e.g. 'game:rust'
  title TEXT NOT NULL,
  thesis TEXT,
  why_now TEXT,
  fit TEXT,
  feature_json TEXT,                    -- {features:{8 in [0,1]}, justifications, evidence ids}
  weight_set_version INTEGER,
  sources_json TEXT,                    -- [{label,url}]
  signal_count INTEGER NOT NULL DEFAULT 1,
  last_signal_at TEXT,
  brief_md TEXT,                        -- deep concrete brief (on greenlight)
  max_prompt TEXT,                      -- ready-to-paste Claude Code Max prompt
  deeper_prompt TEXT,                   -- optional 'go deeper on Max' investigation prompt
  flagship INTEGER NOT NULL DEFAULT 0,
  seen_before INTEGER NOT NULL DEFAULT 0,
  relevance INTEGER,                    -- owner thumbs: 1 up, -1 down, null untouched
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed|parked|greenlit|accepted|rejected|done|archived
  comment TEXT,
  spent_usd REAL NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opportunity_status ON opportunity(status);
CREATE INDEX IF NOT EXISTS idx_opportunity_dedup  ON opportunity(dedup_key);

-- Append-only decision ledger: banks owner accept/reject/comment from day 1 (the learning loop's
-- training data) with the frozen scoring context. Never edited.
CREATE TABLE IF NOT EXISTS intel_decision (
  id INTEGER PRIMARY KEY,
  opportunity_id INTEGER NOT NULL REFERENCES opportunity(id),
  verdict TEXT NOT NULL,                -- accept|reject|comment|thumbs
  comment TEXT,
  feature_json TEXT NOT NULL,           -- frozen snapshot at decision time
  score INTEGER NOT NULL,
  rank_shown INTEGER,
  weight_set_version INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intel_decision_opp ON intel_decision(opportunity_id);

CREATE INDEX IF NOT EXISTS idx_step_task ON step(task_id);
CREATE INDEX IF NOT EXISTS idx_gate_task ON gate_result(task_id);
CREATE INDEX IF NOT EXISTS idx_spend_created ON spend_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_proposal_status ON proposal(status);
`;
