import type { DB } from '../db/db';
import type { Config } from '../config';
import type { Ledger } from '../cost/ledger';
import { runRole, type QueryFn } from '../agents/run';
import { parseJsonLoose } from '../util/json';
import { SIE_ROLES } from './roles';
import { reportPrompt } from './prompts';
import { traceFromMsg, composeGrounding } from './pipeline';
import { setActiveDossier } from './dossier';

export interface ReportDeps {
  db: DB;
  query: QueryFn;
  ledger: Ledger;
  cfg: Config;
  onStage?: (s: string, d?: string) => void;
}

// Deep informational research report on an owner question, with the same live-progress treatment as
// a brief (stage/progress/trace written to the row so the dashboard shows it in real time).
export async function runReportById(deps: ReportDeps, id: number): Promise<{ ok: boolean; costUsd: number; note?: string }> {
  setActiveDossier(composeGrounding(deps.db));
  const r = deps.db.prepare('SELECT id, question FROM report WHERE id=?').get(id) as { id: number; question: string } | undefined;
  if (!r) return { ok: false, costUsd: 0, note: 'not found' };
  const cap = deps.ledger.subStatus('intel', { dailyUsd: deps.cfg.SIE_DAILY_CAP_USD, monthlyUsd: deps.cfg.SIE_MONTHLY_CAP_USD });
  if (cap.paused) {
    deps.db.prepare("UPDATE report SET state='failed', detail=?, updated_at=? WHERE id=?").run(cap.reason ?? 'plafond atteint', new Date().toISOString(), id);
    return { ok: false, costUsd: 0, note: cap.reason };
  }

  const startIso = new Date().toISOString();
  const maxTurns = SIE_ROLES.researcher.maxTurns;
  let turns = 0;
  let searches = 0;
  let reads = 0;
  let activity = 'Recherche lancée…';
  const update = (state = 'running'): void => {
    const pct = state === 'done' ? 100 : Math.min(95, Math.round((turns / maxTurns) * 100));
    try {
      deps.db
        .prepare('UPDATE report SET state=?, progress=?, detail=?, started_at=COALESCE(started_at,?), updated_at=? WHERE id=?')
        .run(state, pct, `${activity}  ·  ${searches} recherches, ${reads} lectures`, startIso, new Date().toISOString(), id);
    } catch {
      /* best-effort */
    }
  };
  update();

  const res = await runRole(deps.query, {
    role: { name: 'researcher', model: SIE_ROLES.researcher.model, effort: SIE_ROLES.researcher.effort, maxTurns },
    prompt: 'Research the question and write the report. Output ONLY the specified JSON.',
    systemPrompt: reportPrompt(r.question),
    settingSources: [],
    allowedTools: ['WebSearch', 'WebFetch'],
    maxBudgetUsd: deps.cfg.PER_BRIEF_BUDGET_USD,
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
  const cost = res.totalCostUsd ?? 0;
  deps.ledger.record(SIE_ROLES.researcher.model, { input_tokens: 0, output_tokens: 0 }, { costUsd: cost, scope: 'intel' });

  const parsed = parseJsonLoose<{ report_md?: string; sources?: { label: string; url: string }[] }>(res.text);
  if (!parsed || !parsed.report_md) {
    deps.db.prepare("UPDATE report SET state='failed', detail=?, cost_usd=cost_usd+?, updated_at=? WHERE id=?").run('Recherche sans résultat exploitable - réessaie.', cost, new Date().toISOString(), id);
    return { ok: false, costUsd: cost, note: 'no report' };
  }
  deps.db
    .prepare("UPDATE report SET state='done', progress=100, detail=NULL, started_at=NULL, body_md=?, sources_json=?, cost_usd=cost_usd+?, updated_at=? WHERE id=?")
    .run(parsed.report_md, JSON.stringify(parsed.sources ?? []), cost, new Date().toISOString(), id);
  return { ok: true, costUsd: cost };
}
