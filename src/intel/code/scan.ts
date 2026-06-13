import * as fs from 'fs';
import * as path from 'path';
import type { DB } from '../../db/db';
import type { Config } from '../../config';
import type { Ledger } from '../../cost/ledger';
import { runRole, type QueryFn } from '../../agents/run';
import { LocalRunner } from '../../sandbox/run';
import { parseJsonLoose } from '../../util/json';
import { SIE_ROLES } from '../roles';
import { scoreOpportunity, DEFAULT_WEIGHTS, type Features } from '../score/rubric';
import * as repos from '../repos';
import { codeAuditPrompt, scorerPrompt, translateOppsPrompt } from '../prompts';
import { appendLogbook } from '../pipeline';

export interface CodeScanDeps {
  db: DB;
  query: QueryFn;
  ledger: Ledger;
  cfg: Config;
  log?: (m: string, d?: unknown) => void;
  onStage?: (stage: string, detail: string) => void;
  now?: Date;
}

interface CodeOpp {
  kind?: string;
  title: string;
  thesis?: string;
  whyNow?: string;
  fit?: string;
  dedupKey?: string;
  evidence?: string[];
  severity?: string;
}

const git = new LocalRunner();
const SCAN_ROOT = process.env.AUTODEV_CODESCAN_DIR ?? '/opt/autodev/codescan';

// Rotating repo list: one repo per daily code scan -> full coverage over a cycle, bounded cost.
export const CODE_REPOS = ['servitium-api', 'servitium-center', 'servitium-portal', 'servitium-ui', 'servitium-electron-gui'];

export function repoForDay(now: Date, repos = CODE_REPOS): string {
  const dayIndex = Math.floor(now.getTime() / 86_400_000);
  return repos[dayIndex % repos.length];
}

async function runSie(deps: CodeScanDeps, rs: { spentUsd: number }, role: 'scorer' | 'translate' | 'ideator', systemPrompt: string, opts: { allowedTools?: string[]; maxBudgetUsd?: number } = {}): Promise<string> {
  const cfgRole = { name: role, ...SIE_ROLES[role] };
  const res = await runRole(deps.query, { role: cfgRole, prompt: 'Perform your role. Output ONLY the specified JSON.', systemPrompt, settingSources: [], allowedTools: opts.allowedTools, maxBudgetUsd: opts.maxBudgetUsd ?? 1.5 });
  const cost = res.totalCostUsd ?? 0;
  deps.ledger.record(cfgRole.model, { input_tokens: 0, output_tokens: 0 }, { costUsd: cost, scope: 'intel' });
  rs.spentUsd += cost;
  return res.text;
}

// Clone (shallow) or refresh the repo into the scan dir, host-side.
function syncRepo(repo: string, cfg: Config): string | null {
  const dir = path.join(SCAN_ROOT, repo);
  const url = `https://x-access-token:${cfg.GITHUB_PAT}@github.com/${cfg.GITHUB_ORG}/${repo}.git`;
  try {
    if (fs.existsSync(path.join(dir, '.git'))) {
      git.run('git', ['pull', '--depth', '1', '--no-tags'], { cwd: dir, timeoutMs: 120_000 });
    } else {
      fs.mkdirSync(SCAN_ROOT, { recursive: true });
      const r = git.run('git', ['clone', '--depth', '1', url, dir], { cwd: SCAN_ROOT, timeoutMs: 180_000 });
      if (r.exitCode !== 0) return null;
    }
    return dir;
  } catch {
    return null;
  }
}

// Token-free library-upgrade signals: npm outdated against the registry (no node_modules needed).
function outdatedDeps(dir: string): { name: string; current?: string; latest: string; type?: string }[] {
  if (!fs.existsSync(path.join(dir, 'package.json'))) return [];
  const r = git.run('npm', ['outdated', '--json'], { cwd: dir, timeoutMs: 120_000 });
  const parsed = parseJsonLoose<Record<string, { current?: string; latest?: string; wanted?: string; type?: string }>>(r.stdout) ?? {};
  const out: { name: string; current?: string; latest: string; type?: string }[] = [];
  for (const [name, info] of Object.entries(parsed)) {
    if (info.latest && info.current !== info.latest) out.push({ name, current: info.current, latest: info.latest, type: info.type });
  }
  return out.slice(0, 40);
}

// Top-level source areas to rotate through (so a scan is bounded, not the whole repo at once).
function sourceAreas(dir: string): string[] {
  const src = path.join(dir, 'src');
  const base = fs.existsSync(src) ? src : dir;
  try {
    const entries = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && !['node_modules', '.git', 'dist', 'release', 'target', 'assets'].includes(e.name));
    const rel = entries.map((e) => path.relative(dir, path.join(base, e.name)).split(path.sep).join('/'));
    return rel.length ? rel : ['src'];
  } catch {
    return ['src'];
  }
}

function sampleFiles(dir: string, area: string, limit = 60): string {
  const root = path.join(dir, area);
  const out: string[] = [];
  const walk = (d: string): void => {
    if (out.length >= limit) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) break;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', '.git', 'dist'].includes(e.name)) walk(p);
      } else if (/\.(ts|js|html|scss|css|rs)$/.test(e.name) && !/\.spec\.|\.test\./.test(e.name)) {
        out.push(path.relative(dir, p).split(path.sep).join('/'));
      }
    }
  };
  walk(root);
  return out.join('\n');
}

// One code-analysis pass over ONE repo (rotating), a few areas, plus npm-outdated lib upgrades.
export async function runCodeScan(deps: CodeScanDeps, repoArg?: string): Promise<{ repo: string; opportunities: number; costUsd: number; note?: string }> {
  const now = deps.now ?? new Date();
  const at = now.toISOString();
  const repo = repoArg ?? repoForDay(now);
  const rs = { spentUsd: 0 };
  const stage = (s: string, d = '') => deps.onStage?.(s, d);

  const cap = deps.ledger.subStatus('intel', { dailyUsd: deps.cfg.SIE_DAILY_CAP_USD, monthlyUsd: deps.cfg.SIE_MONTHLY_CAP_USD }, now);
  if (cap.paused) return { repo, opportunities: 0, costUsd: 0, note: cap.reason };

  stage('CLONE', repo);
  const dir = syncRepo(repo, deps.cfg);
  if (!dir) return { repo, opportunities: 0, costUsd: 0, note: 'clone failed' };

  const candidates: CodeOpp[] = [];

  // Library upgrades (token-free) -> one opportunity bundling the notable majors.
  stage('DEPS', repo);
  const outdated = outdatedDeps(dir);
  const majors = outdated.filter((d) => (d.current ?? '0').split('.')[0] !== d.latest.split('.')[0]);
  if (majors.length) {
    candidates.push({
      kind: 'lib-upgrade',
      title: `Mettre a jour ${majors.length} librairies majeures de ${repo}`,
      thesis: `${majors.slice(0, 8).map((d) => `${d.name} ${d.current}->${d.latest}`).join(', ')}${majors.length > 8 ? ', ...' : ''}`,
      whyNow: 'Des versions majeures sont disponibles (securite, perf, support).',
      fit: `Maintenance ${repo}.`,
      dedupKey: `code:${repo}:lib-upgrades`,
      evidence: ['package.json'],
      severity: 'medium',
    });
  }

  // Rotating area analysis (2 areas/scan to stay cheap).
  const areas = sourceAreas(dir);
  const dayIndex = Math.floor(now.getTime() / 86_400_000);
  const pick = areas.length <= 2 ? areas : [areas[dayIndex % areas.length], areas[(dayIndex + 1) % areas.length]];
  for (const area of [...new Set(pick)]) {
    if (rs.spentUsd >= deps.cfg.SIE_RUN_BUDGET_USD) break;
    stage('AUDIT', `${repo}/${area}`);
    const files = sampleFiles(dir, area);
    if (!files) continue;
    const text = await runSieAudit(deps, rs, dir, codeAuditPrompt(repo, area, files));
    const found = parseJsonLoose<{ opportunities?: CodeOpp[] }>(text)?.opportunities ?? [];
    candidates.push(...found);
  }

  if (!candidates.length) return { repo, opportunities: 0, costUsd: rs.spentUsd, note: 'no findings' };

  // Score + upsert (code opportunities), then translate display fields.
  const translatable: { id: number; title: string; thesis: string; whyNow: string; fit: string }[] = [];
  for (const c of candidates) {
    if (rs.spentUsd >= deps.cfg.SIE_RUN_BUDGET_USD) break;
    let features: Partial<Features> = {};
    let evidenceCount: Record<string, number> = {};
    if (c.kind === 'lib-upgrade') {
      // Deterministic baseline score for the lib bundle (no LLM scoring needed).
      features = { strategic_fit: 0.6, demand_evidence: 0.6, feasibility: 0.85, effort_inv: 0.7, revenue_proximity: 0.2, moat_or_diff: 0.2, reversibility: 0.8, freshness: 0.7 };
      evidenceCount = Object.fromEntries(Object.keys(features).map((k) => [k, 1]));
    } else {
      stage('SCORE', c.title);
      const sres = await runSie(deps, rs, 'scorer', scorerPrompt({ title: c.title, thesis: c.thesis ?? '', whyNow: c.whyNow ?? '', fit: c.fit ?? '' }, (c.evidence ?? []).join(' ') || '(code)'));
      const parsed = parseJsonLoose<{ features?: Partial<Features>; evidenceCount?: Record<string, number> }>(sres) ?? {};
      features = parsed.features ?? {};
      evidenceCount = parsed.evidenceCount ?? {};
    }
    const score = scoreOpportunity({ features, evidenceCount, signalCount: (c.evidence ?? []).length || 1, daysSinceLastSignal: 0 }).score;
    const sources = (c.evidence ?? []).map((e) => ({ label: e, url: `https://github.com/${deps.cfg.GITHUB_ORG}/${repo}/blob/main/${e.split(':')[0]}` }));
    const oid = repos.upsertOpportunity(
      deps.db,
      { kind: c.kind ?? 'refactor', angle: 'code', sourceKind: 'code', repo, dedupKey: c.dedupKey || `code:${repo}:${slug(c.title)}`, title: c.title, thesis: c.thesis, whyNow: c.whyNow, fit: c.fit, featureJson: JSON.stringify({ features, evidenceCount }), sourcesJson: JSON.stringify(sources), signalCount: (c.evidence ?? []).length || 1, lastSignalAt: at },
      score,
      DEFAULT_WEIGHTS.version,
      at,
    );
    translatable.push({ id: oid, title: c.title, thesis: c.thesis ?? '', whyNow: c.whyNow ?? '', fit: c.fit ?? '' });
  }
  repos.rerankShown(deps.db);

  if (translatable.length) {
    stage('TRANSLATE', `${translatable.length}`);
    const tr = await runSie(deps, rs, 'translate', translateOppsPrompt(translatable));
    const parsed = parseJsonLoose<{ items?: { id: number; title?: string; thesis?: string; whyNow?: string; fit?: string }[] }>(tr)?.items ?? [];
    const upd = deps.db.prepare('UPDATE opportunity SET title_fr=?, thesis_fr=?, why_now_fr=?, fit_fr=?, updated_at=? WHERE id=?');
    const tx = deps.db.transaction(() => { for (const x of parsed) upd.run(x.title ?? null, x.thesis ?? null, x.whyNow ?? null, x.fit ?? null, at, x.id); });
    tx();
  }

  appendLogbook(deps.db, 'veille', `analyse code de ${repo}: ${translatable.length} opportunites ($${rs.spentUsd.toFixed(2)})`, at);
  return { repo, opportunities: translatable.length, costUsd: rs.spentUsd };
}

// The audit agent gets the repo as cwd + read-only tools to inspect the real code.
async function runSieAudit(deps: CodeScanDeps, rs: { spentUsd: number }, cwd: string, systemPrompt: string): Promise<string> {
  const cfgRole = { name: 'auditor', model: SIE_ROLES.ideator.model, effort: SIE_ROLES.ideator.effort, maxTurns: 14 };
  const res = await runRole(deps.query, { role: cfgRole, prompt: 'Audit the code. Output ONLY the specified JSON.', systemPrompt, settingSources: [], cwd, allowedTools: ['Read', 'Grep', 'Glob'], maxBudgetUsd: 0.8 });
  const cost = res.totalCostUsd ?? 0;
  deps.ledger.record(cfgRole.model, { input_tokens: 0, output_tokens: 0 }, { costUsd: cost, scope: 'intel' });
  rs.spentUsd += cost;
  return res.text;
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
