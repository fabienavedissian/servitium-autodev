import { testsGreenGate, testsRedGate, parseJestJson } from '../src/gates/jest';
import { FakeRunner, result } from './helpers/fakeRunner';
import type { GateContext } from '../src/gates/index';

interface Suite {
  name: string;
  status?: string;
  assertionResults: { fullName: string; status: string }[];
}
const jestJson = (suites: Suite[]): string =>
  JSON.stringify({ numTotalTests: suites.reduce((a, s) => a + s.assertionResults.length, 0), testResults: suites });

const ctx = (runner: FakeRunner, baselineFailing: string[] = [], specFiles?: string[]): GateContext => ({
  worktreeRoot: '/wt',
  runner,
  allowedPaths: ['src/**'],
  baseRef: 'BASE',
  specFiles,
  baselines: { failingTests: baselineFailing },
});

describe('parseJestJson', () => {
  it('extracts failing test ids', () => {
    const json = jestJson([{ name: '/wt/a.spec.ts', assertionResults: [{ fullName: 'A works', status: 'passed' }, { fullName: 'A breaks', status: 'failed' }] }]);
    expect(parseJestJson(json).failures).toEqual(['/wt/a.spec.ts::A breaks']);
  });
  it('captures suite-level run failures', () => {
    const json = jestJson([{ name: '/wt/b.spec.ts', status: 'failed', assertionResults: [] }]);
    expect(parseJestJson(json).failures).toEqual(['/wt/b.spec.ts::<suite-failed-to-run>']);
  });
});

describe('tests-green (baseline-aware)', () => {
  it('passes when there are no failures', () => {
    const json = jestJson([{ name: '/wt/a.spec.ts', assertionResults: [{ fullName: 'ok', status: 'passed' }] }]);
    expect(testsGreenGate.run(ctx(new FakeRunner(() => result({ stdout: json })))).status).toBe('pass');
  });
  it('fails on a NEW failure', () => {
    const json = jestJson([{ name: '/wt/a.spec.ts', assertionResults: [{ fullName: 'boom', status: 'failed' }] }]);
    expect(testsGreenGate.run(ctx(new FakeRunner(() => result({ stdout: json, exitCode: 1 })))).status).toBe('fail');
  });
  it('passes when the only failure is pre-existing in the baseline', () => {
    const json = jestJson([{ name: '/wt/a.spec.ts', assertionResults: [{ fullName: 'boom', status: 'failed' }] }]);
    expect(testsGreenGate.run(ctx(new FakeRunner(() => result({ stdout: json, exitCode: 1 })), ['/wt/a.spec.ts::boom'])).status).toBe('pass');
  });
  it('fails when the suite did not run', () => {
    expect(testsGreenGate.run(ctx(new FakeRunner(() => result({ stdout: 'garbage', exitCode: 1 })))).status).toBe('fail');
  });
});

describe('tests-red', () => {
  it('passes when the new specs fail (red)', () => {
    expect(testsRedGate.run(ctx(new FakeRunner(() => result({ exitCode: 1 })), [], ['src/a.spec.ts'])).status).toBe('pass');
  });
  it('fails when a new spec passes before implementation', () => {
    expect(testsRedGate.run(ctx(new FakeRunner(() => result({ exitCode: 0 })), [], ['src/a.spec.ts'])).status).toBe('fail');
  });
  it('fails when there are no new specs', () => {
    expect(testsRedGate.run(ctx(new FakeRunner(() => result({ exitCode: 1 })), [], [])).status).toBe('fail');
  });
});
