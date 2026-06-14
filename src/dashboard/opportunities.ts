import type { DB } from '../db/db';
import { scoreOpportunity, DEFAULT_WEIGHTS, FEATURE_KEYS } from '../intel/score/rubric';
import { recordDecision, rerankShown } from '../intel/repos';
import { recomputeKindBias, getKindBias } from '../intel/learning';

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

// How reliable is the generated Max prompt? Driven by the brief's recommendation, how many unknowns
// it still has to spike, and how well-evidenced the opportunity is. Null until a brief exists.
function promptQuality(rec: string | null, unknowns: number | null, evidenceCoverage: number): number | null {
  if (!rec) return null;
  let q = 96 - (unknowns ?? 0) * 14; // only BLOCKING unknowns drag the score (field-validation items don't)
  if (rec === 'incubate') q -= 8;
  else if (rec === 'park') q -= 20;
  else if (rec === 'drop') q -= 30;
  q += Math.round((evidenceCoverage - 0.5) * 16);
  return Math.max(25, Math.min(100, q));
}

// A plain-language verdict so the owner knows whether to send the prompt or keep digging — replaces
// the ambiguous bare percentage. ready=true means: send it, the feature will work. Field-validation
// items (confirmed during dev) are normal and do NOT block readiness.
function readinessOf(rec: string | null, blockers: number, fieldCount: number, hasBrief: boolean): Record<string, unknown> | null {
  if (!hasBrief || !rec) return null;
  const field = fieldCount > 0 ? ` ${fieldCount} point${fieldCount > 1 ? 's' : ''} se confirmeront pendant le dev (normal, non bloquant).` : '';
  if (rec === 'drop') return { ready: false, level: 'discouraged', label: 'Déconseillé', msg: 'Le moteur déconseille de construire ça en l’état.' };
  if (rec === 'park') return { ready: false, level: 'discouraged', label: 'À mettre de côté', msg: 'Pas le bon moment selon le moteur — à garder pour plus tard.' };
  if (blockers > 0) return { ready: false, level: 'blocked', label: `${blockers} point${blockers > 1 ? 's' : ''} à creuser`, msg: `Encore ${blockers} inconnue${blockers > 1 ? 's' : ''} bloquante${blockers > 1 ? 's' : ''} avant d’être sûr. Clique « Approfondir » (ou relance) pour les lever.` };
  if (rec === 'incubate') return { ready: true, level: 'ready', label: 'Prêt (à incuber)', msg: `Techniquement prêt : faisable, mais à incuber (pas la priorité immédiate).${field}` };
  return { ready: true, level: 'ready', label: 'Prêt à envoyer', msg: `C’est bon : investigation complète, la feature est faisable. Inutile de pousser plus — colle-le dans Max.${field}` };
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
      : status === 'validated'
        ? "status IN ('greenlit','accepted')"
        : status === 'all'
          ? '1=1'
          : 'status = @status';
  const where = source === 'web' || source === 'code' ? `${statusWhere} AND source_kind = @source` : statusWhere;
  const params: Record<string, unknown> = {};
  if (!['open', 'validated', 'all'].includes(status)) params.status = status;
  if (source === 'web' || source === 'code') params.source = source;
  const rows = db
    .prepare(`SELECT id, rank, score, kind, angle, source_kind, repo, COALESCE(title_fr,title) AS title, COALESCE(thesis_fr,thesis) AS thesis, COALESCE(why_now_fr,why_now) AS why_now, COALESCE(fit_fr,fit) AS fit, sources_json, feature_json, feasibility_json, signal_count, last_signal_at, flagship, seen_before, relevance, status, comment, recommendation, unknowns_count, brief_state, detail, brief_progress, brief_started_at, (brief_md IS NOT NULL) AS has_brief FROM opportunity WHERE ${where} ORDER BY (rank IS NULL), rank, score DESC`)
    .all(params) as Record<string, unknown>[];
  return rows.map((r) => {
    const { feasibility_json, ...rest } = r;
    const bd = breakdown(String(r.feature_json ?? '{}'), Number(r.signal_count ?? 1), r.last_signal_at as string | undefined);
    let fieldCount = 0;
    try { fieldCount = ((JSON.parse(String(feasibility_json || '{}')) as { fieldUnknowns?: string[] }).fieldUnknowns ?? []).length; } catch { /* none */ }
    const blockers = Number(r.unknowns_count ?? 0);
    return {
      ...rest,
      sources: safeArr(r.sources_json),
      breakdown: bd,
      promptQuality: promptQuality((r.recommendation as string) ?? null, blockers, bd.evidenceCoverage),
      fieldCount,
      readiness: readinessOf((r.recommendation as string) ?? null, blockers, fieldCount, !!r.has_brief),
    };
  });
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

export type DecideAction = 'accept' | 'reject' | 'greenlight' | 'close' | 'comment' | 'thumbs_up' | 'thumbs_down';

export function decideOpportunity(db: DB, id: number, action: DecideAction, comment: string | null, at: string): void {
  const map: Record<DecideAction, { status?: string; relevance?: number; verdict: 'accept' | 'reject' | 'comment' | 'thumbs' }> = {
    accept: { status: 'accepted', verdict: 'accept' },
    reject: { status: 'rejected', verdict: 'reject' },
    greenlight: { status: 'greenlit', verdict: 'accept' },
    close: { status: 'done', verdict: 'accept' },
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
  recomputeKindBias(db, at); // learn from this decision, then re-rank so the effect is immediate
  rerankShown(db);
}

export function sieOverview(db: DB, monthStartIso: string): Record<string, unknown> {
  const last = db.prepare("SELECT run_date, status, stage, progress, signals_new, opportunities, briefs, cost_usd, started_at, ended_at FROM sie_run WHERE kind IS NULL OR kind='veille' ORDER BY id DESC LIMIT 1").get() ?? null;
  const intelMonth = (db.prepare("SELECT COALESCE(SUM(cost_usd),0) AS s FROM spend_ledger WHERE scope='intel' AND created_at >= ?").get(monthStartIso) as { s: number }).s;
  const counts = db.prepare("SELECT COUNT(*) AS open FROM opportunity WHERE status IN ('proposed','greenlit','accepted')").get() as { open: number };
  const flagship = db.prepare("SELECT COUNT(*) AS n FROM opportunity WHERE flagship=1 AND status IN ('proposed','greenlit','accepted')").get() as { n: number };
  return { lastRun: last, intelMonthUsd: intelMonth, openOpportunities: counts.open, flagshipOpen: flagship.n, learnedBias: getKindBias(db) };
}

export function logbookFeed(db: DB, limit = 80): Record<string, unknown>[] {
  return db.prepare('SELECT id, kind, area, summary, source_ref, source, dated_on, created_at FROM logbook ORDER BY id DESC LIMIT ?').all(limit) as Record<string, unknown>[];
}

export function listReports(db: DB, limit = 50): Record<string, unknown>[] {
  return db
    .prepare('SELECT id, question, state, progress, detail, cost_usd, started_at, created_at, (body_md IS NOT NULL) AS has_body FROM report ORDER BY id DESC LIMIT ?')
    .all(limit) as Record<string, unknown>[];
}

export function reportDetail(db: DB, id: number): Record<string, unknown> | null {
  const r = db.prepare('SELECT * FROM report WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  return { ...r, sources: safeArr(r.sources_json) };
}

export function addLogbookNote(db: DB, kind: string, summary: string, at: string): void {
  db.prepare("INSERT INTO logbook (kind, summary, source, dated_on, created_at) VALUES (?,?,'owner',?,?)").run(kind, summary, at.slice(0, 10), at);
}

export function recentSenseRuns(db: DB, limit = 20): Record<string, unknown>[] {
  return db.prepare("SELECT id, run_date, status, signals_new, queries_run, hits_fetched, angles_run, opportunities, briefs, cost_usd, started_at, ended_at FROM sie_run WHERE kind IS NULL OR kind='veille' ORDER BY id DESC LIMIT ?").all(limit) as Record<string, unknown>[];
}

// Every currently-running job (veille, code analysis, brief, report) for the global activity dock.
export function activeJobs(db: DB): Record<string, unknown>[] {
  const jobs: Record<string, unknown>[] = [];
  const runs = db.prepare("SELECT id, kind, stage, progress, started_at FROM sie_run WHERE status='running' ORDER BY id DESC").all() as { id: number; kind: string | null; stage: string | null; progress: number | null; started_at: string }[];
  for (const r of runs) jobs.push({ id: r.id, type: r.kind === 'code' ? 'code' : 'veille', label: r.kind === 'code' ? 'Analyse du code' : 'Veille', stage: r.stage || 'démarrage…', progress: r.progress || 0, startedAt: r.started_at });
  const briefs = db.prepare("SELECT id, COALESCE(title_fr, title) AS title, detail, brief_progress, brief_started_at FROM opportunity WHERE brief_state='running'").all() as { id: number; title: string; detail: string | null; brief_progress: number | null; brief_started_at: string | null }[];
  for (const b of briefs) jobs.push({ id: b.id, type: 'brief', label: `Brief : ${b.title || ''}`, stage: b.detail || 'investigation…', progress: b.brief_progress || 0, startedAt: b.brief_started_at });
  const reps = db.prepare("SELECT id, detail, progress, started_at FROM report WHERE state='running'").all() as { id: number; detail: string | null; progress: number | null; started_at: string }[];
  for (const r of reps) jobs.push({ id: r.id, type: 'report', label: 'Compte-rendu', stage: r.detail || 'recherche…', progress: r.progress || 0, startedAt: r.started_at });
  return jobs;
}

// Everything the veille actually SAW: the raw signals it harvested (research reports), so the owner
// gets information even when nothing became an opportunity.
export function signalsFeed(db: DB, limit = 80): Record<string, unknown>[] {
  return db
    .prepare('SELECT id, angle, title, summary, source_url, source_domain, source_type, claimed_date, seen_before, first_seen_at FROM signal ORDER BY id DESC LIMIT ?')
    .all(limit) as Record<string, unknown>[];
}

// Opportunities the engine CONSIDERED but did NOT retain (scored below threshold, or rejected), with
// their score breakdown so the owner sees WHY ("ARK considered, 47/100, parked: low feasibility").
export function notRetained(db: DB, limit = 50): Record<string, unknown>[] {
  const rows = db
    .prepare(`SELECT id, score, kind, angle, source_kind, repo, COALESCE(title_fr,title) AS title, COALESCE(thesis_fr,thesis) AS thesis, status, feature_json, signal_count, last_signal_at, comment FROM opportunity WHERE status IN ('parked','archived','rejected') ORDER BY score DESC LIMIT ?`)
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({ ...r, breakdown: breakdown(String(r.feature_json ?? '{}'), Number(r.signal_count ?? 1), r.last_signal_at as string | undefined) }));
}

function safeArr(s: unknown): unknown[] {
  try {
    const v = JSON.parse(String(s ?? '[]'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
