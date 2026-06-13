import type { DB } from '../db/db';

export function tasksByState(db: DB): Record<string, number> {
  const rows = db.prepare('SELECT state, COUNT(*) AS n FROM task GROUP BY state').all() as { state: string; n: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.state] = r.n;
  return out;
}

export function costSince(db: DB, sinceIso: string): number {
  return (db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS s FROM spend_ledger WHERE created_at >= ?').get(sinceIso) as { s: number }).s;
}

export function recentRuns(db: DB, limit = 50): Record<string, unknown>[] {
  return db
    .prepare('SELECT id, repo, issue_number, title, state, status, spent_usd, updated_at FROM task ORDER BY id DESC LIMIT ?')
    .all(limit) as Record<string, unknown>[];
}

export function runDetail(db: DB, taskId: number): Record<string, unknown> {
  const task = db.prepare('SELECT * FROM task WHERE id = ?').get(taskId) ?? null;
  const steps = db
    .prepare('SELECT role, model, phase, status, cost_usd, summary, started_at, ended_at FROM step WHERE task_id = ? ORDER BY id')
    .all(taskId);
  const gates = db
    .prepare('SELECT gate, status, details_json, created_at FROM gate_result WHERE task_id = ? ORDER BY id')
    .all(taskId);
  return { task, steps, gates };
}
