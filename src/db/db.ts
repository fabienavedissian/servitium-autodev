import Database from 'better-sqlite3';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

export type DB = Database.Database;

export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const current = Number(db.pragma('user_version', { simple: true })) || 0;
  if (current < SCHEMA_VERSION) {
    db.exec(SCHEMA_SQL);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
  // Additive, idempotent: columns added after the initial schema land on already-created DBs.
  ensureColumn(db, 'task', 'detail', 'TEXT');
  // SIE budget scope: existing rows default to the build lane; the intel lane is opt-in per record().
  ensureColumn(db, 'spend_ledger', 'scope', "TEXT NOT NULL DEFAULT 'build'");
  db.exec('CREATE INDEX IF NOT EXISTS idx_spend_scope ON spend_ledger(scope, created_at)');
  // French display columns (the veille reasons in English; only the owner-facing text is translated).
  for (const c of ['title_fr', 'thesis_fr', 'why_now_fr', 'fit_fr']) ensureColumn(db, 'opportunity', c, 'TEXT');
  // Opportunity origin: web veille vs a code-analysis pass over the repos.
  ensureColumn(db, 'opportunity', 'source_kind', "TEXT NOT NULL DEFAULT 'web'");
  ensureColumn(db, 'opportunity', 'repo', 'TEXT');
  // Brief reliability: the recommendation + how many unknowns the brief still has to spike.
  ensureColumn(db, 'opportunity', 'recommendation', 'TEXT');
  ensureColumn(db, 'opportunity', 'unknowns_count', 'INTEGER');
  // Live brief investigation state, shown in real time under "Validées".
  ensureColumn(db, 'opportunity', 'brief_state', 'TEXT'); // running | done | failed | null
  ensureColumn(db, 'opportunity', 'detail', 'TEXT'); // live sub-status (what the investigation is doing)
  ensureColumn(db, 'opportunity', 'brief_progress', 'INTEGER'); // 0..100 live progress of the investigation
  ensureColumn(db, 'opportunity', 'brief_started_at', 'TEXT'); // for the live ETA
  ensureColumn(db, 'opportunity', 'feasibility_json', 'TEXT'); // English feasibility -> cumulative "Approfondir"
  ensureColumn(db, 'opportunity', 'brief_steer', 'TEXT'); // owner's extra instruction to steer the next investigation
  // Post-integration follow-up: after the owner ships the feature, the engine audits the real code
  // against the brief's acceptance criteria, scores completeness, and emits a finishing prompt — looped
  // (owner ships gaps -> re-verify) until the engine judges it done, then it can be closed.
  ensureColumn(db, 'opportunity', 'integration_state', 'TEXT'); // verifying | gaps | complete | failed | null
  ensureColumn(db, 'opportunity', 'integration_score', 'INTEGER'); // 0..100 completeness vs acceptance criteria
  ensureColumn(db, 'opportunity', 'integration_md', 'TEXT'); // FR audit report for the owner to read
  ensureColumn(db, 'opportunity', 'integration_prompt', 'TEXT'); // EN finishing Max prompt for the remaining gaps
  ensureColumn(db, 'opportunity', 'integration_json', 'TEXT'); // EN audit -> cumulative across re-verify passes
  ensureColumn(db, 'opportunity', 'integration_progress', 'INTEGER');
  ensureColumn(db, 'opportunity', 'integration_detail', 'TEXT');
  ensureColumn(db, 'opportunity', 'integration_started_at', 'TEXT');
  ensureColumn(db, 'opportunity', 'integration_branch', 'TEXT'); // optional branch to audit (default: repo default)
  ensureColumn(db, 'opportunity', 'integration_repo', 'TEXT'); // owner-picked repo to audit (default: opportunity repo)
  // Key-value store for the auto-refreshed dossier + the learned per-kind ranking bias.
  db.exec('CREATE TABLE IF NOT EXISTS sie_kv (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
  // Live veille progress, shown in the dashboard while a run is in flight.
  ensureColumn(db, 'sie_run', 'stage', 'TEXT');
  ensureColumn(db, 'sie_run', 'progress', 'INTEGER');
  ensureColumn(db, 'sie_run', 'kind', 'TEXT'); // 'veille' (web) | 'code' — distinguishes the two run types
  // Research reports (comptes-rendus): an owner question -> a deep researched informational report
  // (e.g. "what is Oxide, which games, competitor or not"), distinct from actionable opportunities.
  db.exec(`CREATE TABLE IF NOT EXISTS report (
    id INTEGER PRIMARY KEY,
    question TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'running', -- running | done | failed
    progress INTEGER,
    detail TEXT,
    body_md TEXT,
    sources_json TEXT,
    cost_usd REAL NOT NULL DEFAULT 0,
    started_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

function ensureColumn(db: DB, table: string, col: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}
