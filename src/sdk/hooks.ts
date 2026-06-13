import { isWriteAllowed } from '../git/scopeGuard';

export type Phase = 'tests-first' | 'implement' | 'readonly';

export interface GuardState {
  worktreeRoot: string;
  allowedPaths: string[];
  paused: boolean;
  phase: Phase;
}

const RAW_MUTATORS = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const FSWRITE = 'mcp__autodev__fsWrite';

// Load-bearing, pure, unit-tested. Agents get NO raw mutators; all writes go through fsWrite,
// which this gate also scope-checks. Excluded from agent-writable allowed_paths (TCB).
export function preToolUseDecision(
  toolName: string,
  toolInput: unknown,
  state: GuardState,
): { decision: 'allow' | 'deny'; reason: string } {
  if (RAW_MUTATORS.includes(toolName)) {
    return { decision: 'deny', reason: `raw ${toolName} is not allowed; use ${FSWRITE}` };
  }
  if (state.paused) {
    return { decision: 'deny', reason: 'spend cap reached; queue paused' };
  }
  if (toolName === FSWRITE) {
    const path = (toolInput as { path?: unknown } | null)?.path;
    if (typeof path !== 'string') return { decision: 'deny', reason: 'fsWrite requires a string path' };
    if (state.phase === 'tests-first' && !/\.spec\.ts$/.test(path)) {
      return { decision: 'deny', reason: 'TESTS_FIRST: only *.spec.ts writes are allowed' };
    }
    const d = isWriteAllowed(state.worktreeRoot, state.allowedPaths, path);
    if (!d.allowed) return { decision: 'deny', reason: `scope: ${d.reason}` };
  }
  return { decision: 'allow', reason: 'ok' };
}

export interface HookDeps {
  state: () => GuardState;
  onAudit?: (entry: { toolName: string; toolInput: unknown }) => void;
}

// Builds the SDK `hooks` option. PreToolUse can hard-deny (verified on 0.3.177). PostToolUse only
// records the audit trail. Typed loosely against the SDK's gnarly hook union.
export function buildHooks(deps: HookDeps): Record<string, unknown[]> {
  const preToolUse = {
    hooks: [
      async (input: unknown) => {
        const i = input as { tool_name: string; tool_input: unknown };
        const { decision, reason } = preToolUseDecision(i.tool_name, i.tool_input, deps.state());
        if (decision === 'deny') {
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: reason,
            },
          };
        }
        return {};
      },
    ],
  };
  const postToolUse = {
    hooks: [
      async (input: unknown) => {
        const i = input as { tool_name: string; tool_input: unknown };
        deps.onAudit?.({ toolName: i.tool_name, toolInput: i.tool_input });
        return {};
      },
    ],
  };
  return { PreToolUse: [preToolUse], PostToolUse: [postToolUse] };
}
