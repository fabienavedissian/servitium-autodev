import { testsGreenGate, testsRedGate } from '../src/gates/jest';
import { FakeRunner, result } from './helpers/fakeRunner';
import type { GateContext } from '../src/gates/index';

const ctx = (runner: FakeRunner, specFiles?: string[]): GateContext => ({
  worktreeRoot: '/wt',
  runner,
  allowedPaths: ['src/**'],
  baseRef: 'BASE',
  specFiles,
});

describe('tests-green gate', () => {
  it('passes when the suite is green twice', () => {
    const r = new FakeRunner(() => result({ exitCode: 0 }));
    expect(testsGreenGate.run(ctx(r)).status).toBe('pass');
    expect(r.calls.length).toBe(2);
  });

  it('fails when the suite is red', () => {
    const r = new FakeRunner(() => result({ exitCode: 1, stdout: '1 failing' }));
    expect(testsGreenGate.run(ctx(r)).status).toBe('fail');
  });

  it('flags flaky (green then red)', () => {
    let n = 0;
    const r = new FakeRunner(() => result({ exitCode: n++ === 0 ? 0 : 1 }));
    const res = testsGreenGate.run(ctx(r));
    expect(res.status).toBe('fail');
    expect(res.details.reason).toMatch(/flaky/);
  });
});

describe('tests-red gate', () => {
  it('passes when the new specs fail (red)', () => {
    const r = new FakeRunner(() => result({ exitCode: 1 }));
    expect(testsRedGate.run(ctx(r, ['src/a.spec.ts'])).status).toBe('pass');
  });

  it('fails when a new spec passes before implementation', () => {
    const r = new FakeRunner(() => result({ exitCode: 0 }));
    expect(testsRedGate.run(ctx(r, ['src/a.spec.ts'])).status).toBe('fail');
  });

  it('fails when there are no new specs at all', () => {
    const r = new FakeRunner(() => result({ exitCode: 1 }));
    expect(testsRedGate.run(ctx(r, [])).status).toBe('fail');
  });
});
