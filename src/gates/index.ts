import type { SandboxRunner } from '../sandbox/run';

export type GateName =
  | 'tests-red'
  | 'tests-green'
  | 'immutability'
  | 'relevance'
  | 'coverage-diff'
  | 'coverage-aggregate'
  | 'tsc'
  | 'lint'
  | 'audit'
  | 'semgrep'
  | 'gitleaks'
  | 'scope-diff';

export interface GateContext {
  worktreeRoot: string;
  runner: SandboxRunner;
  allowedPaths: string[];
  baseRef: string; // merge-base, e.g. the captured origin/main at SETUP
  specFiles?: string[]; // spec files added/modified this step (tests-red, relevance)
  frozenTests?: Record<string, string>; // path -> content hash, frozen at TESTS_FIRST (immutability)
  baselines?: { tscErrors?: string[]; auditAdvisories?: string[]; semgrepFindings?: string[] };
}

export interface GateResult {
  gate: GateName;
  status: 'pass' | 'fail';
  details: Record<string, unknown>;
}

export interface Gate {
  readonly name: GateName;
  run(ctx: GateContext): Promise<GateResult> | GateResult;
}

export function pass(gate: GateName, details: Record<string, unknown> = {}): GateResult {
  return { gate, status: 'pass', details };
}

export function fail(gate: GateName, details: Record<string, unknown> = {}): GateResult {
  return { gate, status: 'fail', details };
}
