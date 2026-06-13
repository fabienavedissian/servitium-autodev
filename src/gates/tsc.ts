import { fail, pass, type Gate, type GateContext, type GateResult } from './index';

const TS_ERROR = /error TS\d+:/;

// Runs the repo's OWN tsconfig (servitium-api is NOT strict, so a forced --strict would flag
// thousands of pre-existing errors). Passes when the diff introduces no NEW type error vs the
// merge-base baseline.
export const tscGate = {
  name: 'tsc',
  run(ctx: GateContext): GateResult {
    const r = ctx.runner.run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], {
      cwd: ctx.worktreeRoot,
      timeoutMs: 300_000,
    });
    const errors = `${r.stdout}\n${r.stderr}`
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => TS_ERROR.test(l));
    const baseline = new Set(ctx.baselines?.tscErrors ?? []);
    const newErrors = errors.filter((e) => !baseline.has(e));
    if (newErrors.length > 0) {
      return fail('tsc', { newErrors: newErrors.slice(0, 50), newCount: newErrors.length, baselineCount: baseline.size });
    }
    return pass('tsc', { totalErrors: errors.length, baselineCount: baseline.size });
  },
} satisfies Gate;
