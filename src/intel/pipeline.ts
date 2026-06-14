import type { DB } from '../db/db';
import type { Config } from '../config';
import type { Ledger } from '../cost/ledger';
import { runRole, type QueryFn } from '../agents/run';
import { parseJsonLoose } from '../util/json';
import { SIE_ROLES, type SieRoleName } from './roles';
import { anglesForDay, type SenseAngle } from './sensing/angles';
import { fetchBatch } from './sensing/fetch';
import { dedupSignals, signalDedupKey, domainOf } from './sensing/dedup';
import { scoreOpportunity, tierForScore, DEFAULT_WEIGHTS } from './score/rubric';
import * as repos from './repos';
import { harvestPrompt, extractPrompt, ideatePrompt, scorerPrompt, feasibilityPrompt, translateOppsPrompt, translateFeasibilityPrompt } from './prompts';
import { renderBriefMd, renderMaxPrompt, renderDeeperPrompt, type Feasibility } from './brief/maxPromptTemplate';
import { setActiveDossier, SERVITIUM_DOSSIER } from './dossier';
import { kvGet } from './learning';

// Base dossier (auto-refreshed) + the owner's authoritative strategic corrections (never overwritten
// by the refresh). Both feed every agent prompt.
export function composeGrounding(db: import('../db/db').DB): string {
  const base = kvGet(db, 'dossier');
  const oc = kvGet(db, 'owner_context');
  return `${base && base.length > 100 ? base : SERVITIUM_DOSSIER}${oc ? `\n\nOWNER STRATEGIC CORRECTIONS (authoritative - always respect over anything above):\n${oc}` : ''}`;
}

export interface VeilleDeps {
  db: DB;
  query: QueryFn;
  ledger: Ledger;
  cfg: Config;
  log?: (m: string, d?: unknown) => void;
  onStage?: (stage: string, detail: string) => void;
  now?: Date;
}

export interface VeilleSummary {
  runId: number | null;
  status: string;
  signalsNew: number;
  opportunities: number;
  briefs: number;
  costUsd: number;
  note?: string;
}

interface RunState {
  spentUsd: number;
}

// Fill {{slots}} from a tiny grounding map (Phase 0: static; Phase 1 reads the KB).
const SLOTS: Record<string, string> = {
  games: 'Conan Exiles, Soulmask',
  competitors: 'game server management panel, BattleMetrics, gamepanel',
  candidateGames: 'Rust, Palworld, Enshrouded, V Rising, ARK',
  year: '2026',
};
const fillQuery = (t: string): string => t.replace(/\{\{(\w+)\}\}/g, (_, k) => SLOTS[k] ?? '');

// Extract a one-line live trace from a streamed agent message (a web search / page read).
export function traceFromMsg(msg: Record<string, unknown>): string | null {
  if (msg.type !== 'assistant') return null;
  const m = (msg.message ?? msg) as { content?: unknown };
  const content = Array.isArray(m.content) ? (m.content as { type?: string; name?: string; input?: Record<string, unknown> }[]) : [];
  for (const block of content) {
    if (block.type === 'tool_use') {
      const q = String(block.input?.query ?? block.input?.url ?? '').slice(0, 80);
      if (block.name === 'WebSearch') return `Recherche : ${q}`;
      if (block.name === 'WebFetch') return `Lecture : ${q}`;
      return `Outil : ${block.name ?? '?'}`;
    }
  }
  return null;
}

async function runSie(
  deps: VeilleDeps,
  rs: RunState,
  role: SieRoleName,
  systemPrompt: string,
  opts: { allowedTools?: string[]; maxBudgetUsd?: number; onMessage?: (m: Record<string, unknown>) => void } = {},
): Promise<{ text: string; costUsd: number; subtype: string }> {
  const cfgRole = { name: role, ...SIE_ROLES[role] };
  const res = await runRole(deps.query, {
    role: cfgRole,
    prompt: `Perform your role. Output ONLY the specified JSON.`,
    systemPrompt,
    settingSources: [],
    allowedTools: opts.allowedTools,
    maxBudgetUsd: opts.maxBudgetUsd ?? 1.5,
    onMessage: opts.onMessage,
  });
  const cost = res.totalCostUsd ?? 0;
  deps.ledger.record(cfgRole.model, { input_tokens: 0, output_tokens: 0 }, { costUsd: cost, scope: 'intel' });
  rs.spentUsd += cost;
  return { text: res.text, costUsd: cost, subtype: res.subtype };
}

// The daily veille. Deterministic stage order; LLM only fills a step; code computes scores/ranks.
export async function runVeille(deps: VeilleDeps): Promise<VeilleSummary> {
  const now = deps.now ?? new Date();
  const at = now.toISOString();
  const runDate = at.slice(0, 10);
  const rs: RunState = { spentUsd: 0 };
  const log = deps.log ?? (() => {});
  let pgDone = 0;
  let pgTotal = 1;
  const stageProgress = (s: string): number => {
    if (s === 'PLAN') return 2;
    if (s === 'HARVEST' || s === 'FETCH' || s === 'EXTRACT') return Math.min(70, 5 + Math.round((pgDone / pgTotal) * 62));
    return { IDEATE: 75, SCORE: 85, TRANSLATE: 92, BRIEF: 96, PUBLISH: 99 }[s] ?? 50;
  };
  const stage = (s: string, d = '') => {
    deps.onStage?.(s, d);
    try {
      if (runId) deps.db.prepare('UPDATE sie_run SET stage=?, progress=? WHERE id=?').run(d ? `${s} — ${d}` : s, stageProgress(s), runId);
    } catch {
      /* best-effort */
    }
  };
  setActiveDossier(composeGrounding(deps.db)); // auto-refreshed context + owner strategic corrections

  // Intel monthly/daily sub-cap kill-switch (the ~50 EUR guarantee).
  const cap = deps.ledger.subStatus('intel', { dailyUsd: deps.cfg.SIE_DAILY_CAP_USD, monthlyUsd: deps.cfg.SIE_MONTHLY_CAP_USD }, now);
  if (cap.paused) return { runId: null, status: 'skipped-capped', signalsNew: 0, opportunities: 0, briefs: 0, costUsd: 0, note: cap.reason };

  const runId = repos.startRun(deps.db, runDate, at);
  if (runId === null) return { runId: null, status: 'already-ran-today', signalsNew: 0, opportunities: 0, briefs: 0, costUsd: 0 };

  const overRunBudget = () => rs.spentUsd >= deps.cfg.SIE_RUN_BUDGET_USD;
  let signalIds: { id: number; angle: string; title: string; summary: string }[] = [];
  let queriesRun = 0;
  let hitsFetched = 0;

  try {
    // PLAN (code) -------------------------------------------------------------
    const angles = anglesForDay(now.getUTCDay());
    // The owner's wants/notes become TOP-priority searches, so the veille actually investigates them
    // (DayZ, Oxide, ...) instead of only feeding them to ideation.
    const wantQueries = (deps.db.prepare("SELECT summary FROM logbook WHERE source='owner' AND kind IN ('want','note') ORDER BY id DESC LIMIT 5").all() as { summary: string }[]).map((r) => r.summary);
    if (wantQueries.length) {
      angles.unshift({ key: 'owner', label: 'Priorités du propriétaire', weight: 12, cadence: 'daily', queryTemplates: wantQueries, freshnessDays: 30 });
    }
    pgTotal = angles.length || 1;
    stage('PLAN', `${angles.length} angles aujourd'hui`);
    const known = repos.knownSignalKeys(deps.db, daysAgoIso(now, 30));

    // HARVEST + FETCH + EXTRACT + DEDUP, per angle ----------------------------
    for (const angle of angles) {
      if (overRunBudget()) {
        log('budget abort before harvest', { angle: angle.key, spent: rs.spentUsd });
        break;
      }
      const queries = angle.queryTemplates.map(fillQuery);
      queriesRun += queries.length;
      stage('HARVEST', angle.label);
      const h = await runSie(deps, rs, 'harvest', harvestPrompt(angle.key, angle.label, queries), { allowedTools: ['WebSearch'] });
      const hits = (parseJsonLoose<{ hits?: { title: string; url: string; snippet?: string }[] }>(h.text)?.hits ?? []).slice(0, 12);
      if (hits.length === 0) continue;

      stage('FETCH', `${hits.length} pages — ${angle.label}`);
      const pages = await fetchBatch(hits.map((x) => x.url));
      const fetched = pages.filter((p) => p.ok && p.text.length > 200);
      hitsFetched += fetched.length;

      // EXTRACT (only pages we actually fetched; fall back to the search snippet otherwise)
      let extracted: { index: number; title: string; summary: string; sourceType?: string; claimedDate?: string; relevant?: boolean }[] = [];
      if (fetched.length) {
        stage('EXTRACT', angle.label);
        const e = await runSie(deps, rs, 'extract', extractPrompt(angle.key, fetched.map((p) => ({ url: p.url, text: p.text }))));
        extracted = parseJsonLoose<{ signals?: typeof extracted }>(e.text)?.signals ?? [];
      }

      // Merge extracted onto their source hit (by fetched-page index), keep relevant only.
      const candidates = extracted
        .filter((x) => x.relevant !== false)
        .map((x) => {
          const page = fetched[x.index];
          const hit = page ? hits.find((hh) => hh.url === page.url) : undefined;
          const url = page?.url ?? hit?.url;
          return { angle: angle.key, title: x.title || hit?.title || '(untitled)', summary: x.summary, sourceType: x.sourceType, claimedDate: x.claimedDate, url };
        });

      const { fresh, seen } = dedupSignals(candidates, known);
      for (const s of seen) repos.bumpSeenSignal(deps.db, s.dedupKey, at);
      for (const s of fresh) {
        known.add(s.dedupKey);
        const id = repos.insertSignal(
          deps.db,
          { runId, angle: s.angle, title: s.title, summary: s.summary, dedupKey: s.dedupKey, url: s.url, domain: s.url ? domainOf(s.url) : undefined, sourceType: s.sourceType, claimedDate: s.claimedDate, seenBefore: false },
          at,
        );
        signalIds.push({ id, angle: s.angle, title: s.title, summary: s.summary ?? '' });
      }
      pgDone += 1;
    }

    // IDEATE (Sonnet, 1 call) -------------------------------------------------
    let opportunities = 0;
    let briefs = 0;
    // ALL accumulated research feeds ideation EVERY run, not just today's fresh signals - so the
    // engine connects dots across days and nothing in the Veille is ever ignored.
    const recentSignals = (deps.db.prepare("SELECT id, angle, title, summary FROM signal WHERE status != 'archived' AND last_seen_at >= ? ORDER BY id DESC LIMIT 90").all(daysAgoIso(now, 45)) as { id: number; angle: string; title: string; summary: string }[]).map((r) => ({ id: r.id, angle: r.angle, title: r.title, summary: r.summary ?? '' }));
    const seenSig = new Set(signalIds.map((s) => s.id));
    const ideaSignals = [...signalIds, ...recentSignals.filter((r) => !seenSig.has(r.id))].slice(0, 90);
    if (ideaSignals.length && !overRunBudget()) {
      stage('IDEATE', `${signalIds.length} nouveaux + ${ideaSignals.length - signalIds.length} accumulés`);
      const openTitles = (deps.db.prepare(`SELECT title FROM opportunity WHERE status IN ('proposed','greenlit','accepted')`).all() as { title: string }[]).map((r) => r.title);
      // Owner corrections: rejected opportunities (with their reason) + "already exists" logbook notes.
      // These teach the engine what NOT to re-propose - the lightweight learning loop.
      const rejected = (deps.db.prepare("SELECT COALESCE(title_fr,title) AS t, comment FROM opportunity WHERE status='rejected' ORDER BY (decided_at IS NULL), decided_at DESC LIMIT 30").all() as { t: string; comment: string | null }[]).map((r) => (r.comment ? `${r.t} (raison: ${r.comment})` : r.t));
      const ownerExists = (deps.db.prepare("SELECT summary FROM logbook WHERE source='owner' AND kind IN ('can','did') ORDER BY id DESC LIMIT 20").all() as { summary: string }[]).map((r) => r.summary);
      const ownerWants = (deps.db.prepare("SELECT summary FROM logbook WHERE source='owner' AND kind IN ('want','note') ORDER BY id DESC LIMIT 20").all() as { summary: string }[]).map((r) => r.summary);
      const i = await runSie(deps, rs, 'ideator', ideatePrompt(ideaSignals, openTitles, [...rejected, ...ownerExists], ownerWants));
      const cand = parseJsonLoose<{ opportunities?: IdeaOpp[] }>(i.text)?.opportunities ?? [];

      // SCORE each (Sonnet) -> code computes score -> upsert + tier --------------
      const translatable: { id: number; title: string; thesis: string; whyNow: string; fit: string }[] = [];
      for (const c of cand) {
        if (overRunBudget()) break;
        const evList = (c.evidence ?? []).map((id) => `[signal:${id}]`).join(' ') || '(none cited)';
        stage('SCORE', c.title);
        const sres = await runSie(deps, rs, 'scorer', scorerPrompt({ title: c.title, thesis: c.thesis ?? '', whyNow: c.whyNow ?? '', fit: c.fit ?? '' }, evList));
        const parsed = parseJsonLoose<{ features?: Record<string, number>; justifications?: Record<string, string>; evidenceCount?: Record<string, number> }>(sres.text) ?? {};
        const featureJson = JSON.stringify({ features: parsed.features ?? {}, evidenceCount: parsed.evidenceCount ?? {}, justifications: parsed.justifications ?? {} });
        const scoreRes = scoreOpportunity({ features: parsed.features ?? {}, evidenceCount: parsed.evidenceCount ?? {}, signalCount: (c.evidence ?? []).length || 1, daysSinceLastSignal: 0 });
        const oid = repos.upsertOpportunity(
          deps.db,
          { kind: c.kind ?? 'feature', angle: ideaSignals.find((s) => (c.evidence ?? []).includes(s.id))?.angle ?? 'product', dedupKey: c.dedupKey || `idea:${slug(c.title)}`, title: c.title, thesis: c.thesis, whyNow: c.whyNow, fit: c.fit, featureJson, sourcesJson: JSON.stringify(c.sources ?? []), signalCount: (c.evidence ?? []).length || 1, lastSignalAt: at },
          scoreRes.score,
          DEFAULT_WEIGHTS.version,
          at,
        );
        translatable.push({ id: oid, title: c.title, thesis: c.thesis ?? '', whyNow: c.whyNow ?? '', fit: c.fit ?? '' });
        opportunities += 1;
      }
      repos.rerankShown(deps.db);

      // TRANSLATE owner-facing fields EN -> FR for display (the veille stayed English) ---
      if (translatable.length) {
        stage('TRANSLATE', `${translatable.length} opportunities`);
        await translateOpps(deps, rs, translatable, at);
      }

      // BRIEF top flagship (Opus, gated) ---------------------------------------
      briefs = await briefTopFlagships(deps, rs, at);
    }

    const status = overRunBudget() ? 'partial-budget' : 'done';
    appendLogbook(deps.db, 'veille', `veille : ${signalIds.length} signaux, ${opportunities} opportunités, ${briefs} briefs ($${rs.spentUsd.toFixed(2)})`, at);
    repos.finishRun(deps.db, runId, status, { cost_usd: rs.spentUsd, opportunities, briefs, signals_new: signalIds.length, angles_run: angles.length, queries_run: queriesRun, hits_fetched: hitsFetched }, at);
    return { runId, status, signalsNew: signalIds.length, opportunities, briefs, costUsd: rs.spentUsd };
  } catch (e) {
    repos.finishRun(deps.db, runId, 'error', { cost_usd: rs.spentUsd, signals_new: signalIds.length }, new Date().toISOString(), String(e).slice(0, 300));
    return { runId, status: 'error', signalsNew: signalIds.length, opportunities: 0, briefs: 0, costUsd: rs.spentUsd, note: String(e).slice(0, 300) };
  }
}

interface IdeaOpp {
  kind?: string;
  title: string;
  thesis?: string;
  whyNow?: string;
  fit?: string;
  dedupKey?: string;
  evidence?: number[];
  sources?: { label: string; url: string }[];
}

interface BriefRow {
  id: number;
  title: string;
  thesis: string;
  why_now: string;
  fit: string;
  title_fr?: string;
  why_now_fr?: string;
  sources_json: string;
  feasibility_json?: string;
  brief_steer?: string;
  score: number;
}

// Translate owner-facing opportunity fields EN -> FR (display only) and store in the _fr columns.
async function translateOpps(deps: VeilleDeps, rs: RunState, items: { id: number; title: string; thesis: string; whyNow: string; fit: string }[], at: string): Promise<void> {
  const t = await runSie(deps, rs, 'translate', translateOppsPrompt(items));
  const parsed = parseJsonLoose<{ items?: { id: number; title?: string; thesis?: string; whyNow?: string; fit?: string }[] }>(t.text)?.items ?? [];
  const upd = deps.db.prepare('UPDATE opportunity SET title_fr=?, thesis_fr=?, why_now_fr=?, fit_fr=?, updated_at=? WHERE id=?');
  const tx = deps.db.transaction(() => {
    for (const x of parsed) upd.run(x.title ?? null, x.thesis ?? null, x.whyNow ?? null, x.fit ?? null, at, x.id);
  });
  tx();
}

// The deep concrete investigation for ONE opportunity: a single gated Opus feasibility pass (English,
// for quality) -> English Max prompt + a French-translated concrete brief for the owner to read.
async function briefRow(deps: VeilleDeps, rs: RunState, r: BriefRow, at: string): Promise<boolean> {
  const sources = (() => {
    try {
      return JSON.parse(r.sources_json || '[]') as { label: string; url: string }[];
    } catch {
      return [];
    }
  })();
  deps.onStage?.('BRIEF', r.title);
  const startIso = new Date().toISOString();
  const maxTurns = SIE_ROLES.feasibility.maxTurns;
  const maxPasses = deps.cfg.SIE_BRIEF_MAX_PASSES;
  const totalBudget = deps.cfg.SIE_BRIEF_TOTAL_BUDGET_USD;
  let pass = 0;
  let turns = 0;
  let searches = 0;
  let reads = 0;
  let briefSpent = 0;
  let activity = 'Investigation profonde lancée…';
  const update = (state = 'running'): void => {
    const within = Math.min(1, turns / maxTurns);
    const pct = state === 'done' ? 100 : Math.min(96, Math.round(((Math.max(0, pass - 1) + within) / maxPasses) * 100));
    try {
      deps.db
        .prepare('UPDATE opportunity SET brief_state=?, brief_progress=?, detail=?, brief_started_at=COALESCE(brief_started_at,?), updated_at=? WHERE id=?')
        .run(state, pct, `Passe ${pass}/${maxPasses} · ${activity}  ·  ${searches} recherches, ${reads} lectures`, startIso, new Date().toISOString(), r.id);
    } catch {
      /* trace best-effort */
    }
  };
  // Cumulative accumulation of concrete findings across every auto-loop pass.
  const accFindings: string[] = [];
  const seenFinding = new Set<string>();
  const addFindings = (xs?: string[]): void => { for (const x of xs ?? []) { const k = (x ?? '').trim(); if (k && !seenFinding.has(k)) { seenFinding.add(k); accFindings.push(k); } } };
  let openUnknowns: string[] = (() => {
    try {
      const p = JSON.parse(r.feasibility_json || '') as { concreteFindings?: string[]; unknowns?: string[] };
      addFindings(p.concreteFindings);
      return p.unknowns ?? [];
    } catch {
      return [];
    }
  })();
  // AUTO-LOOP: keep investigating (each pass builds on prior findings + targets open BLOCKING unknowns)
  // until zero blockers remain (READY), or no progress, or passes/budget exhausted. No manual re-clicking.
  let f: Feasibility | undefined;
  let prevBlockers = Number.POSITIVE_INFINITY;
  while (pass < maxPasses && briefSpent < totalBudget) {
    pass += 1;
    turns = 0; searches = 0; reads = 0;
    activity = pass === 1 ? 'Investigation profonde…' : 'Approfondissement automatique…';
    update();
    const perPass = Math.min(deps.cfg.PER_BRIEF_BUDGET_USD, totalBudget - briefSpent);
    const fres = await runSie(deps, rs, 'feasibility', feasibilityPrompt({ title: r.title, thesis: r.thesis ?? '', whyNow: r.why_now ?? '', fit: r.fit ?? '' }, sources.map((s) => s.url).join(' '), { findings: accFindings, unknowns: openUnknowns }, r.brief_steer), {
      allowedTools: ['WebSearch', 'WebFetch'],
      maxBudgetUsd: perPass,
      onMessage: (msg) => {
        if (msg.type === 'assistant') turns += 1;
        const t = traceFromMsg(msg);
        if (t) {
          if (t.startsWith('Recherche')) searches += 1;
          else if (t.startsWith('Lecture')) reads += 1;
          activity = t;
        }
        update();
      },
    });
    briefSpent += fres.costUsd;
    const parsed = parseJsonLoose<Feasibility>(fres.text);
    if (!parsed || !parsed.recommendation) {
      if (!f) { activity = 'Investigation sans résultat exploitable - réessaie.'; update('failed'); return false; }
      break; // a later pass produced nothing usable -> keep the last good pass
    }
    addFindings(parsed.concreteFindings);
    f = { ...parsed, concreteFindings: accFindings.slice() };
    const blockers = (parsed.unknowns ?? []).length;
    if (blockers === 0) break;            // READY: nothing left to resolve from research
    if (blockers >= prevBlockers) break;  // no progress this pass -> stop pushing
    prevBlockers = blockers;
    openUnknowns = parsed.unknowns ?? [];
  }
  if (!f || !f.recommendation) {
    activity = 'Investigation sans résultat exploitable - réessaie.';
    update('failed');
    return false;
  }
  activity = 'Rédaction et traduction du brief…';
  turns = maxTurns; pass = maxPasses;
  update();
  const oppEn = { title: r.title, thesis: r.thesis, whyNow: r.why_now, fit: r.fit, sources };
  const maxPrompt = renderMaxPrompt(oppEn, f, r.score); // English (for the coding session)
  const deeperPrompt = renderDeeperPrompt(oppEn, f);
  // French brief for the owner to read.
  const tr = await runSie(deps, rs, 'translate', translateFeasibilityPrompt({ verdict: f.verdict, concreteFindings: f.concreteFindings, unknowns: f.unknowns, fieldUnknowns: f.fieldUnknowns, approachSteps: f.approachSteps, dataModel: f.dataModel, outOfScope: f.outOfScope, acceptanceCriteria: f.acceptanceCriteria }));
  const fFr: Feasibility = { ...f, ...(parseJsonLoose<Partial<Feasibility>>(tr.text) ?? {}) };
  const oppFr = { title: r.title_fr || r.title, thesis: r.thesis, whyNow: r.why_now_fr || r.why_now, fit: r.fit, sources };
  const briefMd = renderBriefMd(oppFr, fFr, r.score);
  deps.db
    .prepare("UPDATE opportunity SET brief_md=?, max_prompt=?, deeper_prompt=?, feasibility_json=?, recommendation=?, unknowns_count=?, brief_state='done', brief_progress=100, detail=NULL, brief_started_at=NULL, brief_steer=NULL, spent_usd=spent_usd+?, updated_at=? WHERE id=?")
    .run(briefMd, maxPrompt, deeperPrompt, JSON.stringify(f), f.recommendation, (f.unknowns ?? []).length, briefSpent, at, r.id);
  return true;
}

// Generate the deep concrete brief for up to SIE_BRIEF_TOP_N flagship opportunities that lack one.
async function briefTopFlagships(deps: VeilleDeps, rs: RunState, at: string): Promise<number> {
  const topN = deps.cfg.SIE_BRIEF_TOP_N;
  if (topN <= 0) return 0;
  const rows = deps.db
    .prepare(`SELECT id, title, thesis, why_now, fit, title_fr, why_now_fr, sources_json, score FROM opportunity WHERE flagship=1 AND brief_md IS NULL AND status='proposed' ORDER BY score DESC LIMIT ?`)
    .all(topN) as BriefRow[];
  let n = 0;
  for (const r of rows) {
    const cap = deps.ledger.subStatus('intel', { dailyUsd: deps.cfg.SIE_DAILY_CAP_USD, monthlyUsd: deps.cfg.SIE_MONTHLY_CAP_USD }, deps.now ?? new Date());
    if (cap.paused || rs.spentUsd >= deps.cfg.SIE_RUN_BUDGET_USD) break;
    if (await briefRow(deps, rs, r, at)) n += 1;
  }
  return n;
}

// On-demand deep investigation for a single opportunity (the dashboard "Generate brief" / greenlight
// trigger). Honors the intel sub-cap. Returns the spend or null if it couldn't run.
export async function briefOpportunityById(deps: VeilleDeps, id: number): Promise<{ ok: boolean; costUsd: number; note?: string }> {
  const now = deps.now ?? new Date();
  const cap = deps.ledger.subStatus('intel', { dailyUsd: deps.cfg.SIE_DAILY_CAP_USD, monthlyUsd: deps.cfg.SIE_MONTHLY_CAP_USD }, now);
  if (cap.paused) {
    deps.db.prepare("UPDATE opportunity SET brief_state='failed', detail=? WHERE id=?").run(cap.reason ?? 'plafond atteint', id);
    return { ok: false, costUsd: 0, note: cap.reason };
  }
  const r = deps.db.prepare('SELECT id, title, thesis, why_now, fit, title_fr, why_now_fr, sources_json, feasibility_json, brief_steer, score FROM opportunity WHERE id=?').get(id) as BriefRow | undefined;
  if (!r) return { ok: false, costUsd: 0, note: 'not found' };
  const rs: RunState = { spentUsd: 0 };
  const at = now.toISOString();
  const ok = await briefRow(deps, rs, r, at);
  if (ok) appendLogbook(deps.db, 'did', `brief approfondi généré pour « ${r.title} » ($${rs.spentUsd.toFixed(2)})`, at, `opportunity:${id}`);
  return { ok, costUsd: rs.spentUsd, note: ok ? undefined : 'feasibility produced no usable JSON' };
}

export function appendLogbook(db: DB, kind: string, summary: string, at: string, sourceRef?: string, source: 'system' | 'owner' = 'system'): void {
  db.prepare(`INSERT INTO logbook (kind, summary, source_ref, source, dated_on, created_at) VALUES (?,?,?,?,?,?)`).run(kind, summary, sourceRef ?? null, source, at.slice(0, 10), at);
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
