import * as path from 'path';
import { fail, pass, type Gate, type GateContext, type GateResult } from './index';

// Proves the green depends on the implementation: in a throwaway worktree, revert ONLY the
// production diff (keep the frozen/new specs) and confirm those specs FAIL again. A test that
// still passes with the impl reverted never exercised the change. Token-free, deterministic.
export const relevanceGate = {
  name: 'relevance' as const,
  run(ctx: GateContext): GateResult {
    const specs = ctx.specFiles ?? [];
    if (specs.length === 0) return fail('relevance', { reason: 'no specs to verify' });

    const diff = ctx.runner.run('git', ['diff', '--name-only', ctx.baseRef], { cwd: ctx.worktreeRoot });
    if (diff.exitCode !== 0) return fail('relevance', { error: diff.stderr || diff.stdout });
    const changed = diff.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    const prod = changed.filter((f) => !specs.includes(f) && !f.endsWith('.spec.ts'));
    if (prod.length === 0) return fail('relevance', { reason: 'no production change to revert' });

    const tmp = path.join(ctx.worktreeRoot, '..', `.relevance-${path.basename(ctx.worktreeRoot)}`);
    const add = ctx.runner.run('git', ['worktree', 'add', '--detach', tmp, 'HEAD'], { cwd: ctx.worktreeRoot });
    if (add.exitCode !== 0) return fail('relevance', { reason: 'worktree add failed', err: add.stderr });
    try {
      const revert = ctx.runner.run('git', ['checkout', ctx.baseRef, '--', ...prod], { cwd: tmp });
      if (revert.exitCode !== 0) return fail('relevance', { reason: 'revert failed', err: revert.stderr });
      const rerun = ctx.runner.run('npx', ['jest', '--runInBand', '--ci', ...specs], { cwd: tmp, timeoutMs: 900_000 });
      if (rerun.exitCode !== 0) return pass('relevance', { revertedProd: prod.length });
      return fail('relevance', {
        reason: 'specs still pass with the implementation reverted (they do not exercise the change)',
      });
    } finally {
      ctx.runner.run('git', ['worktree', 'remove', '--force', tmp], { cwd: ctx.worktreeRoot });
    }
  },
} satisfies Gate;
