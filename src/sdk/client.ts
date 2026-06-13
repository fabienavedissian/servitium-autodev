import { importEsm } from '../esm';

// Minimal typed view of the ESM-only @anthropic-ai/claude-agent-sdk surface AutoDev uses.
// Verified against the pinned 0.3.177 via scripts/sdk-smoketest.ts.
export interface AgentSdk {
  query: (args: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<Record<string, unknown>>;
  tool: (name: string, description: string, schema: unknown, handler: (args: unknown) => Promise<unknown>) => unknown;
  createSdkMcpServer: (opts: { name: string; version?: string; tools: unknown[] }) => unknown;
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY: string;
}

let cached: AgentSdk | null = null;

export async function loadSdk(): Promise<AgentSdk> {
  if (!cached) cached = await importEsm<AgentSdk>('@anthropic-ai/claude-agent-sdk');
  return cached;
}
