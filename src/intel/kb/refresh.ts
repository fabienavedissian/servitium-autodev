import * as fs from 'fs';
import * as path from 'path';
import type { DB } from '../../db/db';
import type { Config } from '../../config';
import type { Ledger } from '../../cost/ledger';
import { runRole, type QueryFn } from '../../agents/run';
import { LocalRunner } from '../../sandbox/run';
import { SIE_ROLES } from '../roles';
import { SERVITIUM_DOSSIER } from '../dossier';
import { kvSet } from '../learning';

// Phase 1: weekly auto-refresh of the grounding dossier from the REAL project docs + code structure,
// so the engine's "what Servitium is" model stays current without the owner hand-correcting it.
const git = new LocalRunner();
const SCAN_ROOT = process.env.AUTODEV_CODESCAN_DIR ?? '/opt/autodev/codescan';
const CONTEXT_DIR = process.env.AUTODEV_CONTEXT_DIR ?? '/opt/autodev/context';
const REPOS = ['servitium-api', 'servitium-center', 'servitium-portal', 'servitium-ui', 'servitium-electron-gui'];

function ensureRepo(repo: string, cfg: Config): string | null {
  const dir = path.join(SCAN_ROOT, repo);
  if (fs.existsSync(path.join(dir, '.git'))) return dir;
  try {
    fs.mkdirSync(SCAN_ROOT, { recursive: true });
    const url = `https://x-access-token:${cfg.GITHUB_PAT}@github.com/${cfg.GITHUB_ORG}/${repo}.git`;
    const r = git.run('git', ['clone', '--depth', '1', url, dir], { cwd: SCAN_ROOT, timeoutMs: 180_000 });
    return r.exitCode === 0 ? dir : null;
  } catch {
    return null;
  }
}

export interface RefreshDeps {
  db: DB;
  query: QueryFn;
  ledger: Ledger;
  cfg: Config;
  log?: (m: string, d?: unknown) => void;
}

export async function refreshDossier(deps: RefreshDeps): Promise<{ ok: boolean; costUsd: number; note?: string }> {
  const parts: string[] = [];
  try {
    const claude = fs.readFileSync(path.join(CONTEXT_DIR, 'CLAUDE.md'), 'utf8');
    parts.push(`# CLAUDE.md (canonical project doc)\n${claude.slice(0, 9000)}`);
  } catch {
    deps.log?.('CLAUDE.md not on box (scp it to ' + CONTEXT_DIR + '); using READMEs only');
  }
  for (const repo of REPOS) {
    const dir = ensureRepo(repo, deps.cfg);
    if (!dir) continue;
    try {
      parts.push(`# ${repo} README\n${fs.readFileSync(path.join(dir, 'README.md'), 'utf8').slice(0, 3500)}`);
    } catch {
      /* no readme */
    }
    try {
      const dirs = fs.readdirSync(path.join(dir, 'src'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      if (dirs.length) parts.push(`# ${repo} feature directories\n${dirs.join(', ')}`);
    } catch {
      /* no src */
    }
  }
  const sources = parts.join('\n\n');
  if (sources.length < 200) return { ok: false, costUsd: 0, note: 'no sources available' };

  const systemPrompt = [
    `You maintain the grounding dossier for Servitium's intelligence engine. From the REAL project docs and`,
    `code structure below, rewrite a concise, factual "what Servitium is" dossier in ENGLISH, following the SAME`,
    `shape as this reference (sections: what it is, features that ALREADY EXIST so the engine won't re-propose`,
    `them, business model, tech edges, roadmap/direction, conventions, the strategic scoring lens):`,
    ``,
    SERVITIUM_DOSSIER,
    ``,
    `Keep it tight and current. Output ONLY the dossier text, no preamble.`,
    ``,
    `--- PROJECT SOURCES ---`,
    sources.slice(0, 22000),
  ].join('\n');

  const res = await runRole(deps.query, {
    role: { name: 'dossier', model: SIE_ROLES.ideator.model, effort: 'medium', maxTurns: 3 },
    prompt: 'Rewrite the Servitium dossier from the sources. Output ONLY the dossier text.',
    systemPrompt,
    settingSources: [],
    maxBudgetUsd: 0.6,
  });
  const cost = res.totalCostUsd ?? 0;
  deps.ledger.record(SIE_ROLES.ideator.model, { input_tokens: 0, output_tokens: 0 }, { costUsd: cost, scope: 'intel' });
  const text = (res.text ?? '').trim();
  if (text.length > 300) {
    kvSet(deps.db, 'dossier', text, new Date().toISOString());
    deps.log?.(`dossier refreshed (${text.length} chars, $${cost.toFixed(2)})`);
    return { ok: true, costUsd: cost };
  }
  return { ok: false, costUsd: cost, note: 'agent returned too little' };
}
