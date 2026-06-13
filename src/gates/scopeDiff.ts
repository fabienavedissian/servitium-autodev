import * as fs from 'fs';
import * as path from 'path';
import { LocalRunner } from '../sandbox/run';
import { globToRegExp } from '../git/scopeGuard';
import { fail, pass, type Gate, type GateContext, type GateResult } from './index';

// Post-hoc backstop to the PreToolUse scope guard: every changed or added path (tracked AND
// untracked) must sit inside allowed_paths, and no new symlink may be introduced (mode 120000).
const git = new LocalRunner();

export const scopeDiffGate = {
  name: 'scope-diff',
  run(ctx: GateContext): GateResult {
    const raw = git.run('git', ['diff', '--raw', ctx.baseRef], { cwd: ctx.worktreeRoot });
    if (raw.exitCode !== 0) return fail('scope-diff', { error: raw.stderr || raw.stdout });
    const others = git.run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: ctx.worktreeRoot });

    const matchers = ctx.allowedPaths.map(globToRegExp);
    const inScope = (p: string): boolean => matchers.some((m) => m.test(p));
    const offending: string[] = [];
    const symlinks: string[] = [];

    for (const line of raw.stdout.split('\n')) {
      if (!line.startsWith(':')) continue;
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const dstMode = line.slice(1, tab).split(/\s+/)[1];
      const p = line.slice(tab + 1).trim();
      if (dstMode === '120000') symlinks.push(p);
      if (!inScope(p)) offending.push(p);
    }
    for (const p of others.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (isSymlink(path.join(ctx.worktreeRoot, p))) symlinks.push(p);
      if (!inScope(p)) offending.push(p);
    }

    if (symlinks.length) return fail('scope-diff', { reason: 'new/changed symlink', symlinks });
    if (offending.length) return fail('scope-diff', { reason: 'outside allowed_paths', offending });
    return pass('scope-diff', { offending: 0 });
  },
} satisfies Gate;

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
