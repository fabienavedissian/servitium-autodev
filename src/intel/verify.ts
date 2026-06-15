import * as fs from 'fs';
import * as path from 'path';
import type { DB } from '../db/db';
import type { Config } from '../config';
import type { Ledger } from '../cost/ledger';
import { runRole, type QueryFn } from '../agents/run';
import { LocalRunner } from '../sandbox/run';
import { parseJsonLoose } from '../util/json';
import { SIE_ROLES } from './roles';
import { verifyIntegrationPrompt, translateFeasibilityPrompt } from './prompts';
import { setActiveDossier } from './dossier';
import { composeGrounding, traceFromMsg } from './pipeline';

const git = new LocalRunner();
const VERIFY_ROOT = path.join(process.env.AUTODEV_CODESCAN_DIR ?? '/opt/autodev/codescan', 'verify');

export interface VerifyDeps {
  db: DB;
  query: QueryFn;
  ledger: Ledger;
  cfg: Config;
  log?: (m: string, d?: unknown) => void;
}

interface VerifyResult {
  integrationScore: number;
  isComplete: boolean;
  verdict: string;
  done: string[];
  missing: string[];
  followupPrompt: string;
}

const APP_TO_REPO: Record<string, string> = {
  'servitium-api': 'servitium-api', api: 'servitium-api',
  center: 'servitium-center', 'servitium-center': 'servitium-center',
  portal: 'servitium-portal', 'servitium-portal': 'servitium-portal',
  ui: 'servitium-ui', 'servitium-ui': 'servitium-ui',
  'electron-gui': 'servitium-electron-gui', 'servitium-electron-gui': 'servitium-electron-gui', agent: 'servitium-electron-gui',
  discord: 'servitium-discord', 'servitium-discord': 'servitium-discord',
  autodev: 'servitium-autodev', 'servitium-autodev': 'servitium-autodev',
};

// Clone one repo into a per-opportunity parent dir (one subdir per repo) so a multi-repo feature
// can be audited across all of them at once. The agent runs with cwd = the parent.
function cloneInto(parent: string, repo: string, cfg: Config, branch?: string): boolean {
  const dir = path.join(parent, repo);
  const url = `https://x-access-token:${cfg.GITHUB_PAT}@github.com/${cfg.GITHUB_ORG}/${repo}.git`;
  try {
    const args = branch ? ['clone', '--depth', '1', '--branch', branch, url, dir] : ['clone', '--depth', '1', url, dir];
    const r = git.run('git', args, { cwd: parent, timeoutMs: 180_000 });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

function renderIntegrationMd(title: string, score: number, complete: boolean, verdict: string, done: string[], missing: string[], cloned: string[] = [], failedClone: string[] = []): string {
  const reposLine = cloned.length
    ? `Repos audités : ${cloned.join(', ')}${failedClone.length ? ` · Non clonés (branche absente ?) : ${failedClone.join(', ')}` : ''}`
    : '';
  return [
    `# Vérification d'intégration — ${title}`,
    `**Complétude : ${score}/100**${complete ? ' · Prêt à clôturer' : ' · Il reste des points à finir'}`,
    ...(reposLine ? [reposLine] : []),
    ``,
    `## Verdict`,
    verdict || '(n/a)',
    ``,
    `## Fait (vérifié dans le code)`,
    done.length ? done.map((x) => `- ${x}`).join('\n') : '- (rien de confirmé)',
    ``,
    `## Reste à faire`,
    missing.length ? missing.map((x) => `- ${x}`).join('\n') : "- (rien — c'est complet)",
  ].join('\n');
}

// Audit the SHIPPED code against the brief's acceptance criteria. Cumulative across re-verify passes
// (each pass re-confirms prior "done" + checks whether prior "missing" got fixed).
export async function runVerifyIntegration(deps: VerifyDeps, id: number): Promise<{ ok: boolean; score: number; complete: boolean }> {
  const r = deps.db
    .prepare('SELECT id, COALESCE(title_fr,title) AS title_fr, title, feasibility_json, repo, integration_json, integration_branch, integration_repo, integration_repos FROM opportunity WHERE id=?')
    .get(id) as
    | { id: number; title_fr: string; title: string; feasibility_json: string | null; repo: string | null; integration_json: string | null; integration_branch: string | null; integration_repo: string | null; integration_repos: string | null }
    | undefined;
  if (!r) return { ok: false, score: 0, complete: false };
  const at = new Date().toISOString();
  setActiveDossier(composeGrounding(deps.db));

  let brief = { acceptanceCriteria: [] as string[], approachSteps: [] as string[], concreteFindings: [] as string[], targetApp: '' };
  try {
    const f = JSON.parse(r.feasibility_json || '{}') as Partial<typeof brief>;
    brief = { acceptanceCriteria: f.acceptanceCriteria ?? [], approachSteps: f.approachSteps ?? [], concreteFindings: f.concreteFindings ?? [], targetApp: f.targetApp ?? '' };
  } catch {
    /* no brief json */
  }
  // Owner-picked repos (dashboard checkboxes) win: the same feature branch can span several repos,
  // so audit them all at once. Fall back to the single pick / opportunity guess.
  let repos: string[] = [];
  try {
    const arr = JSON.parse(r.integration_repos || '[]');
    if (Array.isArray(arr)) repos = arr.filter((x): x is string => typeof x === 'string' && !!x);
  } catch {
    /* no repos json */
  }
  if (!repos.length) repos = [r.integration_repo || r.repo || APP_TO_REPO[brief.targetApp] || 'servitium-api'];
  repos = Array.from(new Set(repos));
  const repoLabel = repos.join(', ');

  const startIso = at;
  let turns = 0;
  let reads = 0;
  const maxTurns = SIE_ROLES.verifier.maxTurns;
  const update = (state: string, detail: string, pct: number): void => {
    try {
      deps.db
        .prepare('UPDATE opportunity SET integration_state=?, integration_progress=?, integration_detail=?, integration_started_at=COALESCE(integration_started_at,?), updated_at=? WHERE id=?')
        .run(state, pct, detail, startIso, new Date().toISOString(), id);
    } catch {
      /* best-effort */
    }
  };

  update('verifying', `Clonage de ${repoLabel}…`, 4);
  const parent = path.join(VERIFY_ROOT, String(id));
  try {
    fs.rmSync(parent, { recursive: true, force: true });
    fs.mkdirSync(parent, { recursive: true });
  } catch {
    /* best-effort */
  }
  const cloned: string[] = [];
  const failedClone: string[] = [];
  for (const rp of repos) {
    if (cloneInto(parent, rp, deps.cfg, r.integration_branch || undefined)) cloned.push(rp);
    else failedClone.push(rp);
  }
  if (!cloned.length) {
    const where = r.integration_branch ? `${repoLabel} (branche ${r.integration_branch})` : repoLabel;
    update('failed', `Impossible de cloner ${where}. Vérifie les repos et la branche choisis, et que c'est bien poussé sur GitHub.`, 0);
    return { ok: false, score: 0, complete: false };
  }
  const dir = parent;

  let prior: { done: string[]; missing: string[] } | undefined;
  try {
    const p = JSON.parse(r.integration_json || '') as { done?: string[]; missing?: string[] };
    prior = { done: p.done ?? [], missing: p.missing ?? [] };
  } catch {
    /* first pass */
  }

  update('verifying', `Audit du code de ${cloned.join(', ')}…`, 12);
  const cfgRole = { name: 'verifier', ...SIE_ROLES.verifier };
  const res = await runRole(deps.query, {
    role: cfgRole,
    prompt: 'Audit the implemented code against the acceptance criteria. Output ONLY the specified JSON.',
    systemPrompt: verifyIntegrationPrompt({ title: r.title, targetApp: brief.targetApp || cloned[0] }, brief, prior, cloned),
    settingSources: [],
    cwd: dir,
    allowedTools: ['Read', 'Grep', 'Glob'],
    maxBudgetUsd: deps.cfg.PER_BRIEF_BUDGET_USD,
    onMessage: (msg) => {
      if (msg.type === 'assistant') turns += 1;
      const t = traceFromMsg(msg);
      if (t && t.startsWith('Lecture')) reads += 1;
      update('verifying', `Audit du code · ${reads} fichiers lus`, Math.min(92, 12 + Math.round((turns / maxTurns) * 80)));
    },
  });
  const cost = res.totalCostUsd ?? 0;
  deps.ledger.record(cfgRole.model, { input_tokens: 0, output_tokens: 0 }, { costUsd: cost, scope: 'intel' });

  const v = parseJsonLoose<VerifyResult>(res.text);
  if (!v || typeof v.integrationScore !== 'number') {
    update('failed', 'Audit sans résultat exploitable — réessaie.', 0);
    deps.db.prepare('UPDATE opportunity SET spent_usd=spent_usd+? WHERE id=?').run(cost, id);
    return { ok: false, score: 0, complete: false };
  }

  const allDone = Array.from(new Set([...(prior?.done ?? []), ...(v.done ?? [])]));
  const merged = { ...v, done: allDone };

  const trCfg = { name: 'translate', ...SIE_ROLES.translate };
  const tr = await runRole(deps.query, {
    role: trCfg,
    prompt: 'Translate. Output ONLY JSON with the same keys.',
    systemPrompt: translateFeasibilityPrompt({ verdict: v.verdict, done: merged.done, missing: v.missing }),
    settingSources: [],
  });
  const trCost = tr.totalCostUsd ?? 0;
  deps.ledger.record(trCfg.model, { input_tokens: 0, output_tokens: 0 }, { costUsd: trCost, scope: 'intel' });
  const fr = parseJsonLoose<{ verdict?: string; done?: string[]; missing?: string[] }>(tr.text) ?? {};

  const md = renderIntegrationMd(r.title_fr || r.title, v.integrationScore, !!v.isComplete, fr.verdict ?? v.verdict, fr.done ?? merged.done, fr.missing ?? (v.missing ?? []), cloned, failedClone);
  const state = v.isComplete ? 'complete' : 'gaps';
  deps.db
    .prepare("UPDATE opportunity SET integration_state=?, integration_score=?, integration_md=?, integration_prompt=?, integration_json=?, integration_progress=100, integration_detail=NULL, integration_started_at=NULL, spent_usd=spent_usd+?, updated_at=? WHERE id=?")
    .run(state, v.integrationScore, md, v.followupPrompt || null, JSON.stringify(merged), cost + trCost, at, id);
  return { ok: true, score: v.integrationScore, complete: !!v.isComplete };
}
