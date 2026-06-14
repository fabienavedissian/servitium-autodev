import type { DB } from '../db/db';
import { tierForScore, type WeightSet, DEFAULT_WEIGHTS } from './score/rubric';
import { rankOpportunities, type Rankable } from './score/gate';
import { getKindBias } from './learning';

// Data layer for the Intelligence Engine (mirrors dashboard/proposals.ts style). Pure better-sqlite3.

export interface SieRun {
  id: number;
  run_date: string;
  status: string;
  cost_usd: number;
  opportunities: number;
  briefs: number;
  signals_new: number;
  started_at: string;
  ended_at: string | null;
  note: string | null;
}

// Once-per-UTC-day guard: insert a 'running' row; returns its id, or null if today already ran.
export function startRun(db: DB, runDate: string, at: string): number | null {
  const res = db
    .prepare(`INSERT OR IGNORE INTO sie_run (run_date, status, started_at) VALUES (?, 'running', ?)`)
    .run(runDate, at);
  if (res.changes === 0) return null;
  return Number(res.lastInsertRowid);
}

export function finishRun(
  db: DB,
  runId: number,
  status: string,
  counts: Partial<Pick<SieRun, 'cost_usd' | 'opportunities' | 'briefs' | 'signals_new'>> & {
    angles_run?: number;
    queries_run?: number;
    hits_fetched?: number;
  },
  at: string,
  note?: string,
): void {
  db.prepare(
    `UPDATE sie_run SET status=?, cost_usd=?, opportunities=?, briefs=?, signals_new=?, angles_run=?, queries_run=?, hits_fetched=?, note=?, ended_at=? WHERE id=?`,
  ).run(
    status,
    counts.cost_usd ?? 0,
    counts.opportunities ?? 0,
    counts.briefs ?? 0,
    counts.signals_new ?? 0,
    counts.angles_run ?? 0,
    counts.queries_run ?? 0,
    counts.hits_fetched ?? 0,
    note ?? null,
    at,
    runId,
  );
}

export function knownSignalKeys(db: DB, sinceIso: string): Set<string> {
  const rows = db.prepare('SELECT dedup_key FROM signal WHERE last_seen_at >= ?').all(sinceIso) as { dedup_key: string }[];
  return new Set(rows.map((r) => r.dedup_key));
}

export interface SignalInsert {
  runId: number;
  angle: string;
  title: string;
  summary?: string;
  dedupKey: string;
  url?: string;
  domain?: string;
  sourceType?: string;
  claimedDate?: string;
  seenBefore: boolean;
}

export function insertSignal(db: DB, s: SignalInsert, at: string): number {
  const res = db
    .prepare(
      `INSERT INTO signal (run_id, angle, title, summary, dedup_key, source_url, source_domain, source_type, claimed_date, seen_before, first_seen_at, last_seen_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(s.runId, s.angle, s.title, s.summary ?? null, s.dedupKey, s.url ?? null, s.domain ?? null, s.sourceType ?? null, s.claimedDate ?? null, s.seenBefore ? 1 : 0, at, at);
  return Number(res.lastInsertRowid);
}

export function bumpSeenSignal(db: DB, dedupKey: string, at: string): void {
  db.prepare('UPDATE signal SET source_count = source_count + 1, last_seen_at = ? WHERE dedup_key = ?').run(at, dedupKey);
}

export interface OpportunityUpsert {
  kind: string;
  angle: string;
  dedupKey: string;
  title: string;
  thesis?: string;
  whyNow?: string;
  fit?: string;
  featureJson: string;
  sourcesJson: string;
  signalCount: number;
  lastSignalAt?: string;
  sourceKind?: 'web' | 'code';
  repo?: string;
}

// Upsert by dedup_key: a re-surfaced opportunity accretes (signal_count, seen_before, refreshed
// features) instead of spawning a duplicate. Returns the row id.
export function upsertOpportunity(db: DB, o: OpportunityUpsert, score: number, weightSetVersion: number, at: string): number {
  const existing = db.prepare('SELECT id, status FROM opportunity WHERE dedup_key = ?').get(o.dedupKey) as
    | { id: number; status: string }
    | undefined;
  const tier = tierForScore(score, o.kind);
  if (existing) {
    db.prepare(
      `UPDATE opportunity SET score=?, kind=?, angle=?, title=?, thesis=?, why_now=?, fit=?, feature_json=?, weight_set_version=?, sources_json=?,
        signal_count=?, last_signal_at=?, flagship=?, seen_before=1, updated_at=? WHERE id=?`,
    ).run(
      score, o.kind, o.angle, o.title, o.thesis ?? null, o.whyNow ?? null, o.fit ?? null, o.featureJson, weightSetVersion, o.sourcesJson,
      o.signalCount, o.lastSignalAt ?? at, tier.flagship ? 1 : 0, at, existing.id,
    );
    return existing.id;
  }
  const res = db
    .prepare(
      `INSERT INTO opportunity (score, kind, angle, source_kind, repo, dedup_key, title, thesis, why_now, fit, feature_json, weight_set_version, sources_json,
        signal_count, last_signal_at, flagship, status, first_seen_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      score, o.kind, o.angle, o.sourceKind ?? 'web', o.repo ?? null, o.dedupKey, o.title, o.thesis ?? null, o.whyNow ?? null, o.fit ?? null, o.featureJson, weightSetVersion, o.sourcesJson,
      o.signalCount, o.lastSignalAt ?? at, tier.flagship ? 1 : 0, tier.status, at, at, at,
    );
  return Number(res.lastInsertRowid);
}

// Recompute dense ranks over all currently-shown opportunities (token-free; safe to call often).
export function rerankShown(db: DB, ws: WeightSet = DEFAULT_WEIGHTS): void {
  const bias = getKindBias(db); // learned per-kind preference
  const rows = db
    .prepare(`SELECT id, kind, feature_json, signal_count, last_signal_at, created_at FROM opportunity WHERE status IN ('proposed','greenlit','accepted')`)
    .all() as { id: number; kind: string; feature_json: string; signal_count: number; last_signal_at: string; created_at: string }[];
  const now = Date.now();
  const items: Rankable[] = rows.map((r) => {
    let fj: { features?: Record<string, number>; evidenceCount?: Record<string, number> } = {};
    try {
      fj = JSON.parse(r.feature_json || '{}');
    } catch {
      /* ignore */
    }
    const days = r.last_signal_at ? Math.max(0, (now - Date.parse(r.last_signal_at)) / 86_400_000) : 0;
    return {
      id: r.id,
      kind: r.kind,
      createdAt: r.created_at,
      input: { features: fj.features ?? {}, evidenceCount: fj.evidenceCount ?? {}, signalCount: r.signal_count, daysSinceLastSignal: days, categoryBias: bias[r.kind] ?? 0 },
    };
  });
  const ranked = rankOpportunities(items, ws);
  const upd = db.prepare('UPDATE opportunity SET rank=?, score=? WHERE id=?');
  const tx = db.transaction(() => ranked.forEach((r) => upd.run(r.rank, r.result.score, r.id)));
  tx();
}

export function recordDecision(
  db: DB,
  opportunityId: number,
  verdict: 'accept' | 'reject' | 'comment' | 'thumbs',
  comment: string | null,
  at: string,
): void {
  const o = db.prepare('SELECT score, rank, feature_json, weight_set_version FROM opportunity WHERE id=?').get(opportunityId) as
    | { score: number; rank: number; feature_json: string; weight_set_version: number }
    | undefined;
  if (!o) return;
  db.prepare(
    `INSERT INTO intel_decision (opportunity_id, verdict, comment, feature_json, score, rank_shown, weight_set_version, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(opportunityId, verdict, comment, o.feature_json ?? '{}', o.score ?? 0, o.rank ?? null, o.weight_set_version ?? 0, at);
}
