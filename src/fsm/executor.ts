import type { Outcome, State } from './states';
import type { ExecResult, TaskState } from './machine';

// Rich per-step record for the dashboard: what each agent did, decided, the gates, the diff, cost.
export interface StepRecord {
  phase: State;
  role?: RoleName;
  model?: string;
  status: 'ok' | 'bounced' | 'error';
  outcome: Outcome;
  text?: string; // the agent's full output (analysis / review feedback / decision)
  costUsd: number;
  gates?: { gate: string; status: string; details?: unknown }[];
  diff?: string;
  note?: string;
}
import { ROLES, modelForImplement, rigorPlan, isSensitive, type RoleName } from '../agents/roles';
import { runRole, type QueryFn } from '../agents/run';
import { systemPromptFor, type TaskContext } from '../agents/prompts';
import { parseRoleOutcome } from './outcomes';
import { runGates } from '../gates/runner';
import { tscGate } from '../gates/tsc';
import { testsGreenGate, testsRedGate } from '../gates/jest';
import { scopeDiffGate } from '../gates/scopeDiff';
import { reconcileAllowedPaths, validateAllowedPaths } from '../git/scopeGuard';
import type { GateContext } from '../gates/index';
import type { SandboxRunner } from '../sandbox/run';

export interface AgentOptions {
  allowedTools?: string[];
  mcpServers?: Record<string, unknown>;
  hooks?: Record<string, unknown>;
  perRoleBudgetUsd?: number;
}

// Mutable per-task state the executor fills as roles run (tdd -> specFiles, then frozen).
export interface RunState {
  specFiles: string[];
  frozenTests: Record<string, string>;
  lastImplFailure?: string; // signature of the previous IMPLEMENT gate failure (no-progress guard)
}

export interface ExecutorDeps {
  query: QueryFn;
  ctx: TaskContext; // allowedPaths/spec/acceptance filled by the spec step
  worktreeRoot: string;
  runner: SandboxRunner;
  baseRef: string;
  runState: RunState;
  baselines?: GateContext['baselines'];
  agent?: AgentOptions;
  onCost?: (usd: number, model: string) => void;
  onStep?: (rec: StepRecord) => void;
  attempt: { n: number };
  hard?: boolean;
}

const STATE_ROLE: Partial<Record<State, RoleName>> = {
  PRE_GATE: 'triage',
  SPEC: 'spec',
  TESTS_FIRST: 'tdd',
  IMPLEMENT: 'implement',
  CODE_REVIEW: 'review',
  CHALLENGE: 'challenger',
  RED_TEAM: 'redteam',
  SECURITY: 'security',
  FINAL_REVIEW: 'final',
  VALIDATE: 'validator',
};

// Production executor: glues roles (runRole) + the deterministic gate matrix into the FSM.
// Non-agent states resolve immediately; SPEC_APPROVAL auto-approves in local mode (a human gates it
// via the dashboard in prod). parseRoleOutcome is unit-tested; the assembly is integration-tested.
export function buildExecutor(deps: ExecutorDeps): (state: State, task: TaskState) => Promise<ExecResult> {
  const gateCtx = (): GateContext => ({
    worktreeRoot: deps.worktreeRoot,
    runner: deps.runner,
    allowedPaths: deps.ctx.allowedPaths,
    baseRef: deps.baseRef,
    specFiles: deps.runState.specFiles,
    frozenTests: deps.runState.frozenTests,
    baselines: deps.baselines,
  });

  return async (state: State): Promise<ExecResult> => {
    if (state === 'QUEUED' || state === 'SETUP' || state === 'PR_READY') return { outcome: 'ok' };
    if (state === 'SPEC_APPROVAL') return { outcome: 'approved' };

    const role = STATE_ROLE[state];
    if (!role) return { outcome: 'ok' };

    // Proportional rigor: lean tier (non-sensitive, not complex) skips the 2nd Opus pass and runs the
    // challenger on Sonnet. Undefined sensitivity fails safe to full rigor.
    const plan = rigorPlan(deps.ctx.tier, deps.ctx.sensitive ?? true);
    if (state === 'RED_TEAM' && !plan.runRedTeam) {
      deps.onStep?.({ phase: state, role, model: '-', status: 'ok', outcome: 'clean', costUsd: 0, note: 'skipped (lean rigor: not complex / not sensitive)' });
      return { outcome: 'clean', costUsd: 0 };
    }

    let effRole = ROLES[role];
    let modelOverride: string | undefined;
    if (role === 'implement') modelOverride = modelForImplement(deps.attempt.n, deps.hard ?? false);
    else if (role === 'challenger') {
      modelOverride = plan.challengerModel;
      effRole = { ...effRole, effort: plan.challengerEffort };
    } else if (role === 'redteam') modelOverride = plan.redteamModel;

    const res = await runRole(deps.query, {
      role: effRole,
      modelOverride,
      prompt: `Perform your role for the current task (FSM state ${state}).`,
      systemPrompt: systemPromptFor(role, deps.ctx),
      settingSources: [],
      cwd: deps.worktreeRoot,
      allowedTools: deps.agent?.allowedTools,
      mcpServers: deps.agent?.mcpServers,
      hooks: deps.agent?.hooks,
      maxBudgetUsd: deps.agent?.perRoleBudgetUsd ?? 3,
    });
    const cost = res.totalCostUsd ?? 0;
    const usedModel = modelOverride ?? effRole.model;
    deps.onCost?.(cost, usedModel);

    const parsed = parseRoleOutcome(role, res.text);

    if (role === 'triage') {
      const t = String((parsed.data as { tier?: unknown }).tier ?? 'standard');
      deps.ctx.tier = (['trivial', 'standard', 'complex'].includes(t) ? t : 'standard') as TaskContext['tier'];
      const llmSensitive = (parsed.data as { sensitive?: unknown }).sensitive === true;
      // Code backstop: force full rigor on security-relevant work even if the LLM under-rated it.
      deps.ctx.sensitive = llmSensitive || isSensitive(deps.ctx.title, deps.ctx.allowedPaths);
    }

    let specNote: string | undefined;
    if (role === 'spec' && parsed.outcome === 'ok') {
      const ap = parsed.data.allowedPaths;
      if (Array.isArray(ap)) {
        const rec = reconcileAllowedPaths(deps.worktreeRoot, ap as string[]);
        const v = validateAllowedPaths(rec.globs);
        if (v.allowed) {
          deps.ctx.allowedPaths = rec.globs;
          if (rec.corrections.length) specNote = `allowed_paths reconciled: ${rec.corrections.join('; ')}`;
        } else {
          // Spec proposed an unusable (too broad / empty) scope: keep the initial derived scope.
          specNote = `spec allowed_paths rejected (${v.reason}); kept initial scope [${deps.ctx.allowedPaths.join(', ')}]`;
        }
      }
      if (typeof parsed.data.spec === 'string') deps.ctx.spec = parsed.data.spec;
      if (Array.isArray(parsed.data.acceptanceCriteria)) deps.ctx.acceptanceCriteria = parsed.data.acceptanceCriteria as string[];
    }
    if (role === 'tdd' && Array.isArray(parsed.data.specFiles)) {
      deps.runState.specFiles = parsed.data.specFiles as string[];
    }

    const base = { phase: state, role, model: usedModel, text: res.text, costUsd: cost };
    const gateInfo = (g: { results: { gate: string; status: string; details: unknown }[] }) =>
      g.results.map((r) => ({ gate: r.gate, status: r.status, details: r.details }));
    const captureDiff = (): string | undefined => {
      try {
        return deps.runner.run('git', ['diff', deps.baseRef], { cwd: deps.worktreeRoot }).stdout.slice(0, 60_000);
      } catch {
        return undefined;
      }
    };

    // Gate-driven states: the deterministic matrix is authoritative, not the agent's self-report.
    if (state === 'TESTS_FIRST') {
      const s = await runGates([testsRedGate], gateCtx());
      const outcome: Outcome = s.allPass ? 'red' : 'not-red';
      deps.onStep?.({ ...base, status: s.allPass ? 'ok' : 'error', outcome, gates: gateInfo(s), note: s.failed.join(',') });
      return { outcome, costUsd: cost, note: s.failed.join(',') };
    }
    if (state === 'IMPLEMENT') {
      deps.attempt.n += 1;
      const s = await runGates([testsGreenGate, tscGate, scopeDiffGate], gateCtx());
      // No-progress guard: if an attempt fails with the exact same gate signature as the previous
      // one, retrying is futile -> park for a human instead of burning maxLoops x implement cost.
      const sig = JSON.stringify(s.results.filter((r) => r.status !== 'pass').map((r) => [r.gate, r.details]));
      const stuck = !s.allPass && deps.runState.lastImplFailure === sig;
      deps.runState.lastImplFailure = s.allPass ? undefined : sig;
      const outcome: Outcome = s.allPass ? 'gates-pass' : stuck ? 'gates-stuck' : 'gates-fail';
      const note = stuck ? `no progress vs previous attempt: ${s.failed.join(',')}` : s.failed.join(',');
      deps.onStep?.({ ...base, status: s.allPass ? 'ok' : 'bounced', outcome, gates: gateInfo(s), diff: captureDiff(), note });
      return { outcome, costUsd: cost, note };
    }

    const bounced = parsed.outcome === 'bounce' || parsed.outcome === 'repro';
    deps.onStep?.({ ...base, status: bounced ? 'bounced' : 'ok', outcome: parsed.outcome, note: specNote ?? res.subtype });
    return { outcome: parsed.outcome, costUsd: cost, note: specNote ?? res.subtype };
  };
}
