import type { DB } from '../db/db';
import { scoreOpportunity, DEFAULT_WEIGHTS, FEATURE_KEYS } from '../intel/score/rubric';
import { recordDecision, rerankShown } from '../intel/repos';

// Dashboard read/write for the Intelligence Engine: ranked opportunities + the explainable score
// breakdown, the logbook feed, sie run KPIs, and the decide endpoint (banks the decision + reranks).

function parseFeatureJson(s: string): { features: Record<string, number>; evidenceCount: Record<string, number>; justifications: Record<string, string> } {
  try {
    const d = JSON.parse(s || '{}');
    return { features: d.features ?? {}, evidenceCount: d.evidenceCount ?? {}, justifications: d.justifications ?? {} };
  } catch {
    return { features: {}, evidenceCount: {}, justifications: {} };
  }
}

function breakdown(featureJson: string, signalCount: number, lastSignalAt?: string) {
  const fj = parseFeatureJson(featureJson);
  const days = lastSignalAt ? Math.max(0, (Date.now() - Date.parse(lastSignalAt)) / 86_400_000) : 0;
  const res = scoreOpportunity({ features: fj.features, evidenceCount: fj.evidenceCount, signalCount: signalCount || 1, daysSinceLastSignal: days }, DEFAULT_WEIGHTS);
  return {
    score: res.score,
    bars: FEATURE_KEYS.map((k) => ({ key: k, value: res.features[k], weight: DEFAULT_WEIGHTS.weights[k], evidence: fj.evidenceCount[k] ?? 0, why: fj.justifications[k] ?? '' })),
    modifiers: res.modifiers,
    evidenceCoverage: res.evidenceCoverage,
  };
}

export function listOpportunities(db: DB, status = 'open', source = 'all'): Record<string, unknown>[] {
  const statusWhere =
    status === 'open'
      ? "status IN ('proposed','greenlit','accepted')"
      : status === 'all'
        ? '1=1'
        : 'status = @status';
  const where = source === 'web' || source === 'code' ? `${statusWhere} AND source_kind = @source` : statusWhere;
  const params: Record<string, unknown> = {};
  if (status !== 'open' && status !== 'all') params.status = status;
  if (source === 'web' || source === 'code') params.source = source;
  const rows = db
    .prepare(`SELECT id, rank, score, kind, angle, source_kind, repo, COALESCE(title_fr,title) AS title, COALESCE(thesis_fr,thesis) AS thesis, COALESCE(why_now_fr,why_now) AS why_now, COALESCE(fit_fr,fit) AS fit, sources_json, feature_json, signal_count, last_signal_at, flagship, seen_before, relevance, status, comment, (brief_md IS NOT NULL) AS has_brief FROM opportunity WHERE ${where} ORDER BY (rank IS NULL), rank, score DESC`)
    .all(params) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...r,
    sources: safeArr(r.sources_json),
    breakdown: breakdown(String(r.feature_json ?? '{}'), Number(r.signal_count ?? 1), r.last_signal_at as string | undefined),
  }));
}

export function opportunityDetail(db: DB, id: number): Record<string, unknown> | null {
  const r = db.prepare('SELECT * FROM opportunity WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  const decisions = db.prepare('SELECT verdict, comment, created_at FROM intel_decision WHERE opportunity_id=? ORDER BY id').all(id);
  return {
    ...r,
    sources: safeArr(r.sources_json),
    breakdown: breakdown(String(r.feature_json ?? '{}'), Number(r.signal_count ?? 1), r.last_signal_at as string | undefined),
    decisions,
  };
}

export type DecideAction = 'accept' | 'reject' | 'greenlight' | 'comment' | 'thumbs_up' | 'thumbs_down';

export function decideOpportunity(db: DB, id: number, action: DecideAction, comment: string | null, at: string): void {
  const map: Record<DecideAction, { status?: string; relevance?: number; verdict: 'accept' | 'reject' | 'comment' | 'thumbs' }> = {
    accept: { status: 'accepted', verdict: 'accept' },
    reject: { status: 'rejected', verdict: 'reject' },
    greenlight: { status: 'greenlit', verdict: 'accept' },
    comment: { verdict: 'comment' },
    thumbs_up: { relevance: 1, verdict: 'thumbs' },
    thumbs_down: { relevance: -1, verdict: 'thumbs' },
  };
  const m = map[action];
  const sets: string[] = ['updated_at=@at'];
  const params: Record<string, unknown> = { at, id };
  if (m.status) {
    sets.push('status=@status', 'decided_at=@at');
    params.status = m.status;
  }
  if (m.relevance !== undefined) {
    sets.push('relevance=@relevance');
    params.relevance = m.relevance;
  }
  if (comment) {
    sets.push('comment=@comment');
    params.comment = comment;
  }
  db.prepare(`UPDATE opportunity SET ${sets.join(', ')} WHERE id=@id`).run(params);
  recordDecision(db, id, m.verdict, comment, at);
  rerankShown(db);
}

export function sieOverview(db: DB, monthStartIso: string): Record<string, unknown> {
  const last = db.prepare('SELECT run_date, status, signals_new, opportunities, briefs, cost_usd, started_at, ended_at FROM sie_run ORDER BY id DESC LIMIT 1').get() ?? null;
  const intelMonth = (db.prepare("SELECT COALESCE(SUM(cost_usd),0) AS s FROM spend_ledger WHERE scope='intel' AND created_at >= ?").get(monthStartIso) as { s: number }).s;
  const counts = db.prepare("SELECT COUNT(*) AS open FROM opportunity WHERE status IN ('proposed','greenlit','accepted')").get() as { open: number };
  const flagship = db.prepare("SELECT COUNT(*) AS n FROM opportunity WHERE flagship=1 AND status IN ('proposed','greenlit','accepted')").get() as { n: number };
  return { lastRun: last, intelMonthUsd: intelMonth, openOpportunities: counts.open, flagshipOpen: flagship.n };
}

export function logbookFeed(db: DB, limit = 80): Record<string, unknown>[] {
  return db.prepare('SELECT id, kind, area, summary, source_ref, source, dated_on, created_at FROM logbook ORDER BY id DESC LIMIT ?').all(limit) as Record<string, unknown>[];
}

export function addLogbookNote(db: DB, kind: string, summary: string, at: string): void {
  db.prepare("INSERT INTO logbook (kind, summary, source, dated_on, created_at) VALUES (?,?,'owner',?,?)").run(kind, summary, at.slice(0, 10), at);
}

export function recentSenseRuns(db: DB, limit = 20): Record<string, unknown>[] {
  return db.prepare('SELECT id, run_date, status, signals_new, opportunities, briefs, cost_usd, started_at, ended_at FROM sie_run ORDER BY id DESC LIMIT ?').all(limit) as Record<string, unknown>[];
}

function safeArr(s: unknown): unknown[] {
  try {
    const v = JSON.parse(String(s ?? '[]'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
