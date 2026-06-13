import { fail, pass, type Gate, type GateContext, type GateResult } from './index';

function tail(s: string, n = 4000): string {
  return s.length > n ? s.slice(-n) : s;
}

// Full suite must pass twice in a row (mongodb-memory-server flake guard). A flip -> NEEDS_HUMAN.
export const testsGreenGate = {
  name: 'tests-green',
  run(ctx: GateContext): GateResult {
    const runs = [0, 1].map(() =>
      ctx.runner.run('npx', ['jest', '--runInBand', '--ci'], { cwd: ctx.worktreeRoot, timeoutMs: 900_000 }),
    );
    const exits = runs.map((r) => r.exitCode);
    if (exits.every((e) => e === 0)) return pass('tests-green', { runs: exits });
    if (exits.some((e) => e === 0) && exits.some((e) => e !== 0)) {
      return fail('tests-green', { reason: 'flaky: green and red across runs', runs: exits });
    }
    return fail('tests-green', { runs: exits, tail: tail(runs[runs.length - 1].stdout + runs[runs.length - 1].stderr) });
  },
} satisfies Gate;

// TDD gate: the new specs must FAIL before the implementation exists (a spec that passes
// pre-implementation tested nothing).
export const testsRedGate = {
  name: 'tests-red',
  run(ctx: GateContext): GateResult {
    const specs = ctx.specFiles ?? [];
    if (specs.length === 0) return fail('tests-red', { reason: 'no new spec files to run red' });
    const r = ctx.runner.run('npx', ['jest', '--runInBand', '--ci', ...specs], {
      cwd: ctx.worktreeRoot,
      timeoutMs: 900_000,
    });
    if (r.exitCode !== 0) return pass('tests-red', { specs, exitCode: r.exitCode });
    return fail('tests-red', { reason: 'new specs passed before implementation (no-op test?)', specs });
  },
} satisfies Gate;
