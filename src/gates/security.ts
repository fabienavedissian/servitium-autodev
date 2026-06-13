import { fail, pass, type Gate, type GateContext, type GateResult } from './index';

// npm audit: fail only on a high/critical advisory NOT already present at the merge-base.
export const auditGate = {
  name: 'audit' as const,
  run(ctx: GateContext): GateResult {
    const r = ctx.runner.run('npm', ['audit', '--json'], { cwd: ctx.worktreeRoot, timeoutMs: 300_000 });
    // npm audit exits non-zero when vulnerabilities exist; that is data, not a gate error.
    let data: any;
    try {
      data = JSON.parse(r.stdout);
    } catch {
      return fail('audit', { reason: 'unparseable npm audit output', tail: r.stderr.slice(-500) });
    }
    const vulns = data.vulnerabilities ?? {};
    const baseline = new Set(ctx.baselines?.auditAdvisories ?? []);
    const highCrit = Object.entries(vulns)
      .filter(([, v]: [string, any]) => v.severity === 'high' || v.severity === 'critical')
      .map(([name]) => name);
    const introduced = highCrit.filter((n) => !baseline.has(n));
    if (introduced.length) return fail('audit', { introduced });
    return pass('audit', { highCritical: highCrit.length, baseline: baseline.size });
  },
} satisfies Gate;

// semgrep: fail on a new ERROR-severity finding vs baseline. Not-installed -> fail (wired on Box B).
export const semgrepGate = {
  name: 'semgrep' as const,
  run(ctx: GateContext): GateResult {
    const r = ctx.runner.run(
      'semgrep',
      ['--json', '--quiet', '--config', 'p/typescript', '--config', 'p/owasp-top-ten'],
      { cwd: ctx.worktreeRoot, timeoutMs: 600_000 },
    );
    if (r.exitCode === 127) return fail('semgrep', { reason: 'semgrep not installed (wire on Box B)' });
    let data: any;
    try {
      data = JSON.parse(r.stdout);
    } catch {
      return fail('semgrep', { reason: 'unparseable semgrep output', tail: r.stderr.slice(-500) });
    }
    const baseline = new Set(ctx.baselines?.semgrepFindings ?? []);
    const sig = (f: any): string => `${f.check_id}:${f.path}:${f.start?.line}`;
    const errs = (data.results ?? []).filter((f: any) => String(f.extra?.severity ?? '').toUpperCase() === 'ERROR');
    const introduced = errs.map(sig).filter((s: string) => !baseline.has(s));
    if (introduced.length) return fail('semgrep', { introduced });
    return pass('semgrep', { errorFindings: errs.length });
  },
} satisfies Gate;

// gitleaks: full-worktree secret scan. exit 0 = clean, 1 = leaks, 127 = not installed.
export const gitleaksGate = {
  name: 'gitleaks' as const,
  run(ctx: GateContext): GateResult {
    const r = ctx.runner.run('gitleaks', ['detect', '--no-banner', '--redact', '--exit-code', '1'], {
      cwd: ctx.worktreeRoot,
      timeoutMs: 300_000,
    });
    if (r.exitCode === 127) return fail('gitleaks', { reason: 'gitleaks not installed (wire on Box B)' });
    if (r.exitCode === 0) return pass('gitleaks', {});
    if (r.exitCode === 1) return fail('gitleaks', { reason: 'secrets detected', tail: `${r.stdout}${r.stderr}`.slice(-800) });
    return fail('gitleaks', { reason: 'gitleaks error', exitCode: r.exitCode });
  },
} satisfies Gate;
