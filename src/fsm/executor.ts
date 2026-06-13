import type { State } from './states';
import type { ExecResult, TaskState } from './machine';
import { ROLES, modelForImplement, type RoleName } from '../agents/roles';
import { runRole, type QueryFn } from '../agents/run';
import { systemPromptFor, type TaskContext } from '../agents/prompts';
import { parseRoleOutcome } from './outcomes';
import { runGates } from '../gates/runner';
import { tscGate } from '../gates/tsc';
import { testsGreenGate, testsRedGate } from '../gates/jest';
import { scopeDiffGate } from '../gates/scopeDiff';
import type { GateContext } from '../gates/index';

export interface AgentOptions {
  cwd?: string;
  allowedTools?: string[];
  mcpServers?: Record<string, unknown>;
  hooks?: Record<string, unknown>;
  perRoleBudgetUsd?: number;
}

export interface ExecutorDeps {
  query: QueryFn;
  ctx: TaskContext; // mutated by the spec step for downstream roles
  gateContext: () => GateContext;
  agent?: AgentOptions;
  onCost?: (usd: number, model: string) => void;
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
// via the dashboard in prod). Run live; parseRoleOutcome is unit-tested offline.
export function buildExecutor(deps: ExecutorDeps): (state: State, task: TaskState) => Promise<ExecResult> {
  return async (state: State): Promise<ExecResult> => {
    if (state === 'QUEUED' || state === 'SETUP' || state === 'PR_READY') return { outcome: 'ok' };
    if (state === 'SPEC_APPROVAL') return { outcome: 'approved' };

    const role = STATE_ROLE[state];
    if (!role) return { outcome: 'ok' };

    const modelOverride = role === 'implement' ? modelForImplement(deps.attempt.n, deps.hard ?? false) : undefined;
    const res = await runRole(deps.query, {
      role: ROLES[role],
      modelOverride,
      prompt: `Perform your role for the current task (FSM state ${state}).`,
      systemPrompt: systemPromptFor(role, deps.ctx),
      settingSources: [],
      cwd: deps.agent?.cwd,
      allowedTools: deps.agent?.allowedTools,
      mcpServers: deps.agent?.mcpServers,
      hooks: deps.agent?.hooks,
      maxBudgetUsd: deps.agent?.perRoleBudgetUsd ?? 3,
    });
    const cost = res.totalCostUsd ?? 0;
    deps.onCost?.(cost, modelOverride ?? ROLES[role].model);

    const parsed = parseRoleOutcome(role, res.text);

    if (role === 'spec' && parsed.outcome === 'ok') {
      const ap = parsed.data.allowedPaths;
      if (Array.isArray(ap)) deps.ctx.allowedPaths = ap as string[];
      if (typeof parsed.data.spec === 'string') deps.ctx.spec = parsed.data.spec;
      if (Array.isArray(parsed.data.acceptanceCriteria)) deps.ctx.acceptanceCriteria = parsed.data.acceptanceCriteria as string[];
    }

    // Gate-driven states: the deterministic matrix is authoritative, not the agent's self-report.
    if (state === 'TESTS_FIRST') {
      const s = await runGates([testsRedGate], deps.gateContext());
      return { outcome: s.allPass ? 'red' : 'not-red', costUsd: cost, note: s.failed.join(',') };
    }
    if (state === 'IMPLEMENT') {
      deps.attempt.n += 1;
      const s = await runGates([testsGreenGate, tscGate, scopeDiffGate], deps.gateContext());
      return { outcome: s.allPass ? 'gates-pass' : 'gates-fail', costUsd: cost, note: s.failed.join(',') };
    }

    return { outcome: parsed.outcome, costUsd: cost, note: res.subtype };
  };
}
