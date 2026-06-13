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
    .prepare(
      `SELECT t.id, t.repo, t.issue_number, t.title, t.state, t.status, t.spent_usd, t.updated_at,
              (SELECT COUNT(*) FROM step s WHERE s.task_id = t.id) AS steps
       FROM task t ORDER BY t.id DESC LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[];
}

// Rich run detail: each step with the agent's output/decision, its gate matrix, diff, and cost.
export function runDetail(db: DB, taskId: number): Record<string, unknown> {
  const task = db.prepare('SELECT * FROM task WHERE id = ?').get(taskId) ?? null;
  const rawSteps = db
    .prepare('SELECT id, role, model, phase, status, cost_usd, summary, started_at FROM step WHERE task_id = ? ORDER BY id')
    .all(taskId) as { id: number; role: string; model: string; phase: string; status: string; cost_usd: number; summary: string; started_at: string }[];
  const gateRows = db
    .prepare('SELECT step_id, gate, status, details_json FROM gate_result WHERE task_id = ? ORDER BY id')
    .all(taskId) as { step_id: number; gate: string; status: string; details_json: string }[];

  const gatesByStep = new Map<number, { gate: string; status: string; details: unknown }[]>();
  for (const g of gateRows) {
    let details: unknown = undefined;
    try {
      details = JSON.parse(g.details_json);
    } catch {
      /* ignore */
    }
    const arr = gatesByStep.get(g.step_id) ?? [];
    arr.push({ gate: g.gate, status: g.status, details });
    gatesByStep.set(g.step_id, arr);
  }

  const steps = rawSteps.map((s) => {
    let d: { outcome?: string; note?: string; text?: string; diff?: string } = {};
    try {
      d = JSON.parse(s.summary || '{}');
    } catch {
      /* summary not JSON */
    }
    return {
      id: s.id,
      role: s.role,
      model: s.model,
      phase: s.phase,
      status: s.status,
      costUsd: s.cost_usd,
      startedAt: s.started_at,
      outcome: d.outcome,
      note: d.note,
      text: d.text,
      diff: d.diff,
      gates: gatesByStep.get(s.id) ?? [],
    };
  });

  const comments = db.prepare('SELECT id, body, consumed_at, created_at FROM comment WHERE task_id = ? ORDER BY id').all(taskId);
  return { task, steps, comments };
}

export function addComment(db: DB, taskId: number, body: string, at: string): void {
  db.prepare('INSERT INTO comment (task_id, body, created_at) VALUES (?,?,?)').run(taskId, body, at);
}
