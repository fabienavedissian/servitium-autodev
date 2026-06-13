import * as fs from 'fs';
import * as path from 'path';
import { fail, pass, type Gate, type GateContext, type GateResult } from './index';

// Changed-lines coverage: a regression in modified-but-not-retested code passes a whole-repo
// aggregate gate trivially, so the primary gate requires the lines a diff ADDS/MODIFIES to be
// executed by the suite. Built from `git diff -U0 <base>` x istanbul coverage-final.json.

export interface IstanbulEntry {
  path: string;
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
  s: Record<string, number>;
}
export type IstanbulCoverage = Record<string, IstanbulEntry>;

export function parseDiffAddedLines(diff: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  let current: string | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).replace(/^b\//, '').trim();
      current = p === '/dev/null' ? null : p;
      if (current && !out.has(current)) out.set(current, new Set());
    } else if (line.startsWith('@@') && current) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (m) {
        const start = parseInt(m[1], 10);
        const count = m[2] === undefined ? 1 : parseInt(m[2], 10);
        const set = out.get(current);
        if (set) for (let i = 0; i < count; i++) set.add(start + i);
      }
    }
  }
  for (const [k, v] of out) if (v.size === 0) out.delete(k);
  return out;
}

export function uncoveredLines(entry: IstanbulEntry): Set<number> {
  const uncovered = new Set<number>();
  const covered = new Set<number>();
  for (const [id, stmt] of Object.entries(entry.statementMap)) {
    const hits = entry.s[id] ?? 0;
    for (let l = stmt.start.line; l <= stmt.end.line; l++) (hits > 0 ? covered : uncovered).add(l);
  }
  for (const l of covered) uncovered.delete(l);
  return uncovered;
}

function coverageByRelPath(cov: IstanbulCoverage, worktreeRoot: string): Map<string, IstanbulEntry> {
  const map = new Map<string, IstanbulEntry>();
  const root = worktreeRoot.replace(/\\/g, '/').replace(/\/$/, '');
  for (const entry of Object.values(cov)) {
    const p = entry.path.replace(/\\/g, '/');
    const rel = p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p;
    map.set(rel, entry);
  }
  return map;
}

export function computeUncoveredChanged(
  changed: Map<string, Set<number>>,
  cov: IstanbulCoverage,
  worktreeRoot: string,
): { file: string; lines: number[] }[] {
  const covMap = coverageByRelPath(cov, worktreeRoot);
  const result: { file: string; lines: number[] }[] = [];
  for (const [file, lines] of changed) {
    if (!/\.(ts|js)$/.test(file) || file.endsWith('.spec.ts') || file.endsWith('.d.ts')) continue;
    const entry = covMap.get(file);
    if (!entry) {
      result.push({ file, lines: [...lines].sort((a, b) => a - b) });
      continue;
    }
    const unc = uncoveredLines(entry);
    const bad = [...lines].filter((l) => unc.has(l)).sort((a, b) => a - b);
    if (bad.length) result.push({ file, lines: bad });
  }
  return result;
}

export const coverageDiffGate = {
  name: 'coverage-diff' as const,
  run(ctx: GateContext): GateResult {
    const diff = ctx.runner.run('git', ['diff', '-U0', ctx.baseRef], { cwd: ctx.worktreeRoot });
    if (diff.exitCode !== 0) return fail('coverage-diff', { error: diff.stderr || diff.stdout });
    const covPath = path.join(ctx.worktreeRoot, 'coverage', 'coverage-final.json');
    if (!fs.existsSync(covPath)) return fail('coverage-diff', { reason: 'coverage-final.json not found (run jest --coverage first)' });
    const cov = JSON.parse(fs.readFileSync(covPath, 'utf8')) as IstanbulCoverage;
    const changed = parseDiffAddedLines(diff.stdout);
    const uncovered = computeUncoveredChanged(changed, cov, ctx.worktreeRoot);
    if (uncovered.length) return fail('coverage-diff', { uncovered });
    return pass('coverage-diff', { changedFiles: changed.size });
  },
} satisfies Gate;
