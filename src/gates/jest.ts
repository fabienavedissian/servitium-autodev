import * as fs from 'fs';
import * as path from 'path';
import { fail, pass, type Gate, type GateContext, type GateResult } from './index';
import type { SandboxRunner } from '../sandbox/run';

function tail(s: string, n = 4000): string {
  return s.length > n ? s.slice(-n) : s;
}

// Runs jest writing clean JSON to a file (servitium-api prints NestJS logs to stdout, so stdout
// JSON is unparseable). Reads the file; falls back to stdout (for unit tests with a FakeRunner).
export function runJestJson(
  runner: SandboxRunner,
  worktreeRoot: string,
  extraArgs: string[],
  timeoutMs: number,
): { ran: boolean; failures: string[]; exitCode: number } {
  const outFile = path.join(worktreeRoot, '.autodev-jest.json');
  try {
    fs.rmSync(outFile, { force: true });
  } catch {
    /* ignore */
  }
  const r = runner.run(
    'npx',
    ['jest', '--runInBand', '--ci', '--forceExit', '--json', `--outputFile=${outFile}`, ...extraArgs],
    { cwd: worktreeRoot, timeoutMs },
  );
  let content = '';
  try {
    content = fs.readFileSync(outFile, 'utf8');
  } catch {
    /* fall back to stdout */
  }
  const parsed = parseJestJson(content || r.stdout || r.stderr);
  return { ran: parsed.ran, failures: parsed.failures, exitCode: r.exitCode };
}

// Parse `jest --json` stdout into the set of failing test identifiers (file::fullName), plus
// suite-level run failures (compile/exec errors). Robust to surrounding noise.
export function parseJestJson(stdout: string): { ran: boolean; failures: string[] } {
  const s = stdout.trim();
  let data: { testResults?: unknown[]; numTotalTests?: number } | undefined;
  try {
    data = JSON.parse(s);
  } catch {
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i >= 0 && j > i) {
      try {
        data = JSON.parse(s.slice(i, j + 1));
      } catch {
        data = undefined;
      }
    }
  }
  if (!data) return { ran: false, failures: [] };
  const failures: string[] = [];
  for (const suiteRaw of data.testResults ?? []) {
    const suite = suiteRaw as { name?: string; status?: string; assertionResults?: { fullName?: string; title?: string; status?: string }[] };
    const ar = suite.assertionResults ?? [];
    if (ar.length === 0 && suite.status === 'failed') {
      failures.push(`${suite.name ?? '?'}::<suite-failed-to-run>`);
      continue;
    }
    for (const t of ar) if (t.status === 'failed') failures.push(`${suite.name ?? '?'}::${t.fullName ?? t.title ?? '?'}`);
  }
  return { ran: typeof data.numTotalTests === 'number', failures };
}

// Baseline-aware full-suite gate: a real codebase has pre-existing failures, so we require NO NEW
// failure vs the baseline captured on main at SETUP (not "everything green").
export const testsGreenGate = {
  name: 'tests-green',
  run(ctx: GateContext): GateResult {
    const res = runJestJson(ctx.runner, ctx.worktreeRoot, [], 1_200_000);
    if (!res.ran) return fail('tests-green', { reason: 'suite did not run', exitCode: res.exitCode });
    const baseline = new Set(ctx.baselines?.failingTests ?? []);
    const newFailures = res.failures.filter((f) => !baseline.has(f));
    if (newFailures.length > 0) {
      return fail('tests-green', { newFailures: newFailures.slice(0, 30), newCount: newFailures.length, baselineFailures: baseline.size });
    }
    return pass('tests-green', { totalFailures: res.failures.length, baselineFailures: baseline.size });
  },
} satisfies Gate;

// TDD gate: the new specs must FAIL before the implementation exists.
export const testsRedGate = {
  name: 'tests-red',
  run(ctx: GateContext): GateResult {
    const specs = ctx.specFiles ?? [];
    if (specs.length === 0) return fail('tests-red', { reason: 'no new spec files to run red' });
    const r = ctx.runner.run('npx', ['jest', '--runInBand', '--ci', '--forceExit', ...specs], { cwd: ctx.worktreeRoot, timeoutMs: 900_000 });
    if (r.exitCode !== 0) return pass('tests-red', { specs, exitCode: r.exitCode });
    return fail('tests-red', { reason: 'new specs passed before implementation (no-op test?)', specs });
  },
} satisfies Gate;
