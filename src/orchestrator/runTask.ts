import { buildExecutor, type RunState } from '../fsm/executor';
import { runMachine, type MachineConfig, type TaskState } from '../fsm/machine';
import { buildMcpServer } from '../sdk/mcpTools';
import { buildHooks, type GuardState, type Phase } from '../sdk/hooks';
import type { AgentSdk } from '../sdk/client';
import type { SandboxRunner } from '../sandbox/run';
import type { TaskContext } from '../agents/prompts';

export interface RunTaskDeps {
  sdk: AgentSdk;
  runner: SandboxRunner;
  worktreeRoot: string;
  baseRef: string;
  ctx: TaskContext;
  caps: MachineConfig;
  onCost?: (usd: number, model: string) => void;
  spendPaused?: () => boolean;
}

// Assembles the whole engine for one task: scope-guard hooks + in-process MCP tools + the production
// executor, then drives the FSM. The agent gets read tools + the autodev MCP tools (no raw mutators).
export async function runTask(deps: RunTaskDeps): Promise<TaskState> {
  const attempt = { n: 0 };
  const runState: RunState = { specFiles: [], frozenTests: {} };
  const phase = (): Phase => (runState.specFiles.length === 0 ? 'tests-first' : 'implement');

  const guardState = (): GuardState => ({
    worktreeRoot: deps.worktreeRoot,
    allowedPaths: deps.ctx.allowedPaths,
    paused: deps.spendPaused?.() ?? false,
    phase: phase(),
  });

  const hooks = buildHooks({ state: guardState });
  const mcp = buildMcpServer(deps.sdk, {
    worktreeRoot: deps.worktreeRoot,
    allowedPaths: deps.ctx.allowedPaths,
    runner: deps.runner,
    baseRef: deps.baseRef,
    phase,
  });

  const exec = buildExecutor({
    query: deps.sdk.query,
    ctx: deps.ctx,
    worktreeRoot: deps.worktreeRoot,
    runner: deps.runner,
    baseRef: deps.baseRef,
    runState,
    attempt,
    onCost: deps.onCost,
    agent: {
      allowedTools: ['Read', 'Grep', 'Glob', ...mcp.toolNames],
      mcpServers: { autodev: mcp.server },
      hooks,
    },
  });

  const start: TaskState = { id: 1, state: 'QUEUED', loopCount: 0, opusReentries: 0, spentUsd: 0 };
  return runMachine(start, exec, deps.caps);
}
