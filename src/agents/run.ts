import type { Usage } from '../cost/prices';
import type { EffortLevel } from './roles';

export type QueryFn = (args: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<Record<string, unknown>>;

// Structural: any role-like config (AutoDev RoleConfig or SIE_ROLES entry). runRole only reads model/effort/maxTurns.
export interface RunRoleInput {
  role: { name?: string; model: string; effort: EffortLevel; maxTurns: number };
  prompt: string;
  systemPrompt: string | string[];
  cwd?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, unknown>;
  hooks?: Record<string, unknown>;
  maxBudgetUsd?: number;
  settingSources?: string[];
  modelOverride?: string; // e.g. implement escalation to Opus
}

export interface RunRoleResult {
  text: string;
  subtype: string; // 'success' | 'error_max_turns' | 'error_max_budget_usd' | ...
  usage: Usage | null;
  totalCostUsd: number | null;
  raw: Record<string, unknown> | null;
}

// One agent role = one query(). Read-only roles get no mutating tools; the FSM decides tool policy.
// settingSources default [] keeps the session isolated (no project/user settings leak in).
export async function runRole(query: QueryFn, input: RunRoleInput): Promise<RunRoleResult> {
  const options: Record<string, unknown> = {
    model: input.modelOverride ?? input.role.model,
    effort: input.role.effort,
    maxTurns: input.role.maxTurns,
    systemPrompt: input.systemPrompt,
    settingSources: input.settingSources ?? [],
    permissionMode: 'dontAsk',
  };
  if (input.cwd) options.cwd = input.cwd;
  if (input.allowedTools) options.allowedTools = input.allowedTools;
  if (input.disallowedTools) options.disallowedTools = input.disallowedTools;
  if (input.mcpServers) options.mcpServers = input.mcpServers;
  if (input.hooks) options.hooks = input.hooks;
  if (input.maxBudgetUsd !== undefined) options.maxBudgetUsd = input.maxBudgetUsd;

  let result: Record<string, unknown> | null = null;
  try {
    for await (const msg of query({ prompt: input.prompt, options })) {
      if (msg && msg.type === 'result') result = msg;
    }
  } catch (e) {
    // maxTurns / API errors surface as a thrown result; degrade gracefully so the FSM bounces.
    return { text: '', subtype: 'error', usage: null, totalCostUsd: null, raw: { error: String(e).slice(0, 500) } };
  }
  if (!result) return { text: '', subtype: 'no_result', usage: null, totalCostUsd: null, raw: null };

  return {
    text: typeof result.result === 'string' ? result.result : '',
    subtype: typeof result.subtype === 'string' ? result.subtype : 'unknown',
    usage: (result.usage as Usage | undefined) ?? null,
    totalCostUsd: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null,
    raw: result,
  };
}
