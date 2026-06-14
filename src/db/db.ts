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
  // Key-value store for the auto-refreshed dossier + the learned per-kind ranking bias.
  db.exec('CREATE TABLE IF NOT EXISTS sie_kv (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
}

function ensureColumn(db: DB, table: string, col: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}
