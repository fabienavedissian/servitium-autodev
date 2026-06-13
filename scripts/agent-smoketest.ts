/**
 * Live agent-runner smoke-test: one cheap Haiku round-trip through runRole, printing the
 * extracted text/usage/cost. Run: npm run build && node --env-file-if-exists=.env dist/scripts/agent-smoketest.js
 */
import { loadSdk } from '../src/sdk/client';
import { runRole } from '../src/agents/run';
import { ROLES } from '../src/agents/roles';
import { costUsd } from '../src/cost/prices';

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY (or .env) to run the live agent smoke-test.');
    process.exit(1);
  }
  const sdk = await loadSdk();
  const res = await runRole(sdk.query, {
    role: ROLES.triage,
    prompt: 'Output ONLY this JSON and nothing else: {"actionable": true, "reason": "smoke"}',
    systemPrompt: 'You are a terse triage agent. Output only what the user asks, no preamble.',
    settingSources: [],
    maxBudgetUsd: 0.25,
  });
  console.log('\n=== AutoDev agent-runner smoke-test ===');
  console.log('subtype        :', res.subtype);
  console.log('text           :', res.text.slice(0, 200));
  console.log('usage          :', JSON.stringify(res.usage));
  console.log('total_cost_usd :', res.totalCostUsd);
  if (res.usage) console.log('ledger cost    : $' + costUsd(ROLES.triage.model, res.usage).toFixed(6));
  console.log('');
  process.exit(res.subtype === 'success' ? 0 : 2);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
