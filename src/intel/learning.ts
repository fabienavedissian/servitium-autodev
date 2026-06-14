import type { DB } from '../db/db';

// Phase 2 learning loop (simple + bounded + auditable): a per-kind ranking bias learned from the
// owner's decisions. Kinds he validates rise, kinds he rejects fall. Clamped to +/-0.08 (~8 score
// points) so it tunes, never dominates. Token-free, recomputed after each decision. One row per
// opportunity (no double counting). This is enough learning for months; the heavier feature-weight
// calibration stays deferred until there is real data volume.

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function kvGet(db: DB, key: string): string | null {
  const r = db.prepare('SELECT value FROM sie_kv WHERE key=?').get(key) as { value: string } | undefined;
  return r ? r.value : null;
}

export function kvSet(db: DB, key: string, value: string, at: string): void {
  db.prepare('INSERT INTO sie_kv (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').run(key, value, at);
}

export function recomputeKindBias(db: DB, at: string): Record<string, number> {
  const rows = db.prepare('SELECT kind, status, relevance FROM opportunity').all() as { kind: string; status: string; relevance: number | null }[];
  const tally: Record<string, number> = {};
  for (const r of rows) {
    if (!r.kind) continue;
    let d = 0;
    if (['greenlit', 'accepted', 'done'].includes(r.status)) d += 1;
    else if (r.status === 'rejected') d -= 1;
    if (r.relevance === 1) d += 0.5;
    else if (r.relevance === -1) d -= 0.5;
    if (d !== 0) tally[r.kind] = (tally[r.kind] ?? 0) + d;
  }
  const bias: Record<string, number> = {};
  for (const [k, net] of Object.entries(tally)) {
    const b = clamp(0.03 * net, -0.08, 0.08);
    if (b !== 0) bias[k] = b;
  }
  kvSet(db, 'kind_bias', JSON.stringify(bias), at);
  return bias;
}

export function getKindBias(db: DB): Record<string, number> {
  const v = kvGet(db, 'kind_bias');
  if (!v) return {};
  try {
    return JSON.parse(v) as Record<string, number>;
  } catch {
    return {};
  }
}
