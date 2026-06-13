import { auditGate, semgrepGate, gitleaksGate } from '../src/gates/security';
import { scanSecret } from '../src/util/secretScan';
import { FakeRunner, result } from './helpers/fakeRunner';
import type { GateContext } from '../src/gates/index';

const ctx = (runner: FakeRunner, baselines?: GateContext['baselines']): GateContext => ({
  worktreeRoot: '/wt',
  runner,
  allowedPaths: ['src/**'],
  baseRef: 'BASE',
  baselines,
});

describe('audit gate', () => {
  it('passes when no high/critical vulns', () => {
    const r = new FakeRunner(() => result({ exitCode: 0, stdout: JSON.stringify({ vulnerabilities: {} }) }));
    expect(auditGate.run(ctx(r)).status).toBe('pass');
  });
  it('fails on a new high vuln', () => {
    const out = JSON.stringify({ vulnerabilities: { lodash: { severity: 'high' } } });
    const r = new FakeRunner(() => result({ exitCode: 1, stdout: out }));
    expect(auditGate.run(ctx(r)).status).toBe('fail');
  });
  it('ignores a baselined vuln', () => {
    const out = JSON.stringify({ vulnerabilities: { lodash: { severity: 'critical' } } });
    const r = new FakeRunner(() => result({ exitCode: 1, stdout: out }));
    expect(auditGate.run(ctx(r, { auditAdvisories: ['lodash'] })).status).toBe('pass');
  });
});

describe('semgrep gate', () => {
  it('passes with no ERROR findings', () => {
    const r = new FakeRunner(() => result({ stdout: JSON.stringify({ results: [] }) }));
    expect(semgrepGate.run(ctx(r)).status).toBe('pass');
  });
  it('fails on a new ERROR finding', () => {
    const finding = { check_id: 'x', path: 'src/a.ts', start: { line: 3 }, extra: { severity: 'ERROR' } };
    const r = new FakeRunner(() => result({ stdout: JSON.stringify({ results: [finding] }) }));
    expect(semgrepGate.run(ctx(r)).status).toBe('fail');
  });
  it('reports missing binary', () => {
    const r = new FakeRunner(() => result({ exitCode: 127 }));
    expect(semgrepGate.run(ctx(r)).details.reason).toMatch(/not installed/);
  });
});

describe('gitleaks gate', () => {
  it('passes on a clean scan', () => {
    expect(gitleaksGate.run(ctx(new FakeRunner(() => result({ exitCode: 0 })))).status).toBe('pass');
  });
  it('fails when secrets are detected', () => {
    expect(gitleaksGate.run(ctx(new FakeRunner(() => result({ exitCode: 1 })))).status).toBe('fail');
  });
});

describe('scanSecret', () => {
  it('detects an anthropic key and a github token', () => {
    expect(scanSecret('here is sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA more').found).toBe(true);
    expect(scanSecret('token github_pat_AAAAAAAAAAAAAAAAAAAAAAAA').matches).toContain('github-token');
  });
  it('passes clean text', () => {
    expect(scanSecret('a normal PR body with no secrets').found).toBe(false);
  });
});
