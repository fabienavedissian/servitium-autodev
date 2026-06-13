import { tscGate } from '../src/gates/tsc';
import { FakeRunner, result } from './helpers/fakeRunner';
import type { GateContext } from '../src/gates/index';

const baseCtx = (runner: FakeRunner, baselineErrors: string[] = []): GateContext => ({
  worktreeRoot: '/wt',
  runner,
  allowedPaths: ['src/**'],
  baseRef: 'BASE',
  baselines: { tscErrors: baselineErrors },
});

describe('tsc gate', () => {
  it('passes when tsc is clean', () => {
    const r = new FakeRunner(() => result({ exitCode: 0, stdout: '' }));
    expect((tscGate.run(baseCtx(r)) as { status: string }).status).toBe('pass');
  });

  it('fails on a NEW type error', () => {
    const r = new FakeRunner(() => result({ exitCode: 2, stdout: "src/a.ts(3,5): error TS2322: Type 'x'." }));
    const res = tscGate.run(baseCtx(r));
    expect(res.status).toBe('fail');
    expect((res.details.newCount as number)).toBe(1);
  });

  it('ignores a pre-existing error that is in the baseline', () => {
    const line = "src/old.ts(1,1): error TS2304: Cannot find name 'foo'.";
    const r = new FakeRunner(() => result({ exitCode: 2, stdout: line }));
    expect(tscGate.run(baseCtx(r, [line])).status).toBe('pass');
  });
});
