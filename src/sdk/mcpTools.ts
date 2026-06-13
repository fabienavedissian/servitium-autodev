import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { AgentSdk } from './client';
import { isWriteAllowed } from '../git/scopeGuard';
import { GATES } from '../gates/registry';
import type { GateContext, GateName } from '../gates/index';
import type { SandboxRunner } from '../sandbox/run';
import type { Phase } from './hooks';

export interface McpDeps {
  worktreeRoot: string;
  allowedPaths: string[];
  runner: SandboxRunner;
  baseRef: string;
  phase: () => Phase;
  spendStatus?: () => { paused: boolean; dailyUsd: number; monthlyUsd: number };
  onLesson?: (l: { category: string; title: string; body: string }) => void;
}

function text(t: string, isError = false): { content: { type: 'text'; text: string }[]; isError: boolean } {
  return { content: [{ type: 'text', text: t }], isError };
}

// In-process, secret-bearing tools the agent CALLS but whose internals it never sees. fsWrite is
// the only mutation path (no raw Edit/Write/Bash). All run host-side; runGate shells via the runner.
export function buildMcpServer(sdk: AgentSdk, deps: McpDeps): { server: unknown; toolNames: string[] } {
  const fsWrite = sdk.tool(
    'fsWrite',
    'Create or overwrite a file inside the task allowed_paths. The ONLY way to mutate files.',
    { path: z.string(), content: z.string() },
    async (args: unknown) => {
      const { path: rel, content } = args as { path: string; content: string };
      if (deps.phase() === 'tests-first' && !/\.spec\.ts$/.test(rel)) {
        return text(`DENIED: TESTS_FIRST allows only *.spec.ts writes (${rel})`, true);
      }
      const d = isWriteAllowed(deps.worktreeRoot, deps.allowedPaths, rel);
      if (!d.allowed) return text(`DENIED: ${d.reason}`, true);
      const abs = path.join(deps.worktreeRoot, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      return text(`wrote ${rel} (${content.length} bytes)`);
    },
  );

  const runGate = sdk.tool(
    'runGate',
    'Run a named gate (tsc, tests-green, tests-red, scope-diff, audit, semgrep, gitleaks, ...).',
    { gate: z.string() },
    async (args: unknown) => {
      const { gate } = args as { gate: string };
      const g = GATES[gate as GateName];
      if (!g) return text(`unknown gate: ${gate}`, true);
      const ctx: GateContext = {
        worktreeRoot: deps.worktreeRoot,
        runner: deps.runner,
        allowedPaths: deps.allowedPaths,
        baseRef: deps.baseRef,
      };
      const res = await g.run(ctx);
      return text(JSON.stringify(res));
    },
  );

  const spendCheck = sdk.tool('spendCheck', 'Return current spend vs caps.', {}, async () => {
    return text(JSON.stringify(deps.spendStatus?.() ?? { paused: false, dailyUsd: 0, monthlyUsd: 0 }));
  });

  const lessonsAppend = sdk.tool(
    'lessonsAppend',
    'Queue a lesson (bug | arch-decision | gotcha) for human approval before it joins the prefix.',
    { category: z.string(), title: z.string(), body: z.string() },
    async (args: unknown) => {
      const l = args as { category: string; title: string; body: string };
      deps.onLesson?.(l);
      return text(`lesson queued: ${l.title}`);
    },
  );

  const server = sdk.createSdkMcpServer({
    name: 'autodev',
    version: '0.1.0',
    tools: [fsWrite, runGate, spendCheck, lessonsAppend],
  });
  const toolNames = ['fsWrite', 'runGate', 'spendCheck', 'lessonsAppend'].map((n) => `mcp__autodev__${n}`);
  return { server, toolNames };
}
