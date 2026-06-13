// Verifies the Agent SDK can actually web-search (the load-bearing assumption of the veille).
import { loadConfig } from '../src/config';
import { loadSdk } from '../src/sdk/client';

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY required');
  const sdk = await loadSdk();
  let result: Record<string, unknown> | null = null;
  let turns = 0;
  for await (const m of sdk.query({
    prompt: 'Search the web for the current latest Node.js LTS major version. Output ONLY JSON: {"version":string,"source":string}.',
    options: { model: 'claude-haiku-4-5', allowedTools: ['WebSearch'], maxTurns: 5, settingSources: [], permissionMode: 'dontAsk' },
  })) {
    if (m.type === 'assistant') turns += 1;
    if (m.type === 'result') result = m;
  }
  console.log('turns:', turns);
  console.log('subtype:', result?.subtype, 'cost:', result?.total_cost_usd);
  console.log('text:', typeof result?.result === 'string' ? result.result : JSON.stringify(result));
  process.exit(0);
}
main().catch((e: unknown) => {
  console.error('smoke failed:', e);
  process.exit(1);
});
