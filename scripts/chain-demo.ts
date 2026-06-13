/**
 * Live demo of the chain head: triage (Haiku) -> spec (Sonnet) on a realistic servitium-api task,
 * parsing each agent's structured JSON the way the FSM executor will. No worktree/gates yet.
 */
import { loadSdk } from '../src/sdk/client';
import { runRole } from '../src/agents/run';
import { ROLES } from '../src/agents/roles';
import { systemPromptFor, type TaskContext } from '../src/agents/prompts';
import { parseJsonLoose } from '../src/util/json';

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY (or .env).');
    process.exit(1);
  }
  const sdk = await loadSdk();
  const task: TaskContext = {
    repo: 'servitium-api',
    title: 'Reject non-positive quantities in the shop purchase endpoint',
    body: 'The purchase endpoint must validate that the requested item quantity is a positive integer and return HTTP 400 otherwise.',
    allowedPaths: [],
  };

  let total = 0;
  const triage = await runRole(sdk.query, {
    role: ROLES.triage,
    prompt: 'Triage this task per your instructions.',
    systemPrompt: systemPromptFor('triage', task),
    settingSources: [],
    maxBudgetUsd: 0.25,
  });
  total += triage.totalCostUsd ?? 0;
  const tj = parseJsonLoose<{ actionable: boolean; reason: string }>(triage.text);
  console.log('\n=== CHAIN-HEAD DEMO ===');
  console.log('TRIAGE actionable =', tj?.actionable, '| reason:', tj?.reason);

  if (tj?.actionable) {
    const spec = await runRole(sdk.query, {
      role: ROLES.spec,
      prompt: 'Write the spec, acceptance criteria and a tight allowed_paths list per your instructions.',
      systemPrompt: systemPromptFor('spec', task),
      settingSources: [],
      maxBudgetUsd: 0.5,
    });
    total += spec.totalCostUsd ?? 0;
    const sj = parseJsonLoose<{ spec: string; acceptanceCriteria: string[]; allowedPaths: string[] }>(spec.text);
    console.log('\nSPEC          :', sj?.spec);
    console.log('ACCEPTANCE    :', JSON.stringify(sj?.acceptanceCriteria, null, 0));
    console.log('ALLOWED_PATHS :', JSON.stringify(sj?.allowedPaths));
    console.log('\nparsed-ok     :', !!tj && !!sj);
  }
  console.log('total cost    : $' + total.toFixed(4));
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
