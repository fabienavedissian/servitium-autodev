/**
 * M0b SDK smoke-test. Verifies the @anthropic-ai/claude-agent-sdk surface AutoDev
 * depends on, against the pinned version, BEFORE the agent chain is built.
 *
 * (A) Binding confirmations run with no key (module loads + exports exist).
 * (live) A minimal round-trip + usage capture run only if ANTHROPIC_API_KEY is set.
 *
 * Run: npm run smoketest   (loads .env if present)
 */
import { importEsm } from '../src/esm';
import { costUsd, type Usage } from '../src/cost/prices';

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

async function main(): Promise<void> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string): void => {
    checks.push({ name, ok, detail });
  };

  let sdk: Record<string, unknown>;
  try {
    sdk = await importEsm<Record<string, unknown>>('@anthropic-ai/claude-agent-sdk');
    add('module loads (ESM via dynamic import)', true, `exports: ${Object.keys(sdk).sort().join(', ')}`);
  } catch (e) {
    add('module loads (ESM via dynamic import)', false, String(e));
    finish(checks, true);
    return;
  }

  // (A) Binding confirmations: the symbols AutoDev wires against must exist.
  add('query is a function', typeof sdk.query === 'function', `typeof query = ${typeof sdk.query}`);
  add('tool is a function', typeof sdk.tool === 'function', `typeof tool = ${typeof sdk.tool}`);
  add(
    'createSdkMcpServer is a function',
    typeof sdk.createSdkMcpServer === 'function',
    `typeof createSdkMcpServer = ${typeof sdk.createSdkMcpServer}`,
  );

  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  add('ANTHROPIC_API_KEY present', hasKey, hasKey ? 'yes' : 'set it (or .env) to run live checks');

  if (hasKey && typeof sdk.query === 'function') {
    const query = sdk.query as QueryFn;
    // Baseline: default options. The SDK injects the full Claude Code preset system
    // prompt (~24k tokens), which dominates fresh-session cost.
    const baseline = await liveRoundTrip(query, 'baseline (default systemPrompt)', { model: 'claude-haiku-4-5', maxTurns: 1 }, add);
    // Cost lever: custom systemPrompt string replaces the preset; settingSources:[] skips
    // project settings. Expect cache_creation tokens to collapse.
    const minimal = await liveRoundTrip(
      query,
      'minimal (custom systemPrompt + settingSources:[])',
      { model: 'claude-haiku-4-5', maxTurns: 1, systemPrompt: 'You are terse.', settingSources: [] },
      add,
    );
    if (baseline && minimal) {
      // Honest prompt-size metric: total input context (cache warmth confounds cache_creation alone).
      const ctx = (u: Usage): number =>
        u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      const saved = ctx(baseline) - ctx(minimal);
      add(
        'cost lever: minimal prompt shrinks input context',
        ctx(minimal) < ctx(baseline),
        `total input context ${ctx(baseline)} -> ${ctx(minimal)} (saved ${saved} tokens, ${((saved / ctx(baseline)) * 100).toFixed(0)}%). Bigger cuts need per-role tool restriction (M1/M4).`,
      );
    }
  }

  // Hard-fail only if the load-bearing surface is missing; live failures are warnings here.
  const hardFail = checks.some((c) => !c.ok && /module loads|query is a function/.test(c.name));
  finish(checks, hardFail);
}

type QueryFn = (args: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<Record<string, unknown>>;

async function liveRoundTrip(
  query: QueryFn,
  label: string,
  options: Record<string, unknown>,
  add: (n: string, ok: boolean, d?: string) => void,
): Promise<Usage | null> {
  try {
    let lastResult: Record<string, unknown> | null = null;
    for await (const msg of query({ prompt: 'Reply with exactly: SMOKE_OK', options })) {
      if (msg && msg.type === 'result') lastResult = msg;
    }
    const usage = (lastResult?.usage ?? null) as Usage | null;
    const model = String(options.model ?? 'claude-haiku-4-5');
    const cost = usage ? costUsd(model, usage) : NaN;
    add(
      `live round-trip: ${label}`,
      !!lastResult && !!usage,
      usage ? `cost $${cost.toFixed(6)}  cache_creation=${usage.cache_creation_input_tokens ?? 0}  cache_read=${usage.cache_read_input_tokens ?? 0}  out=${usage.output_tokens}` : 'no usage',
    );
    return usage;
  } catch (e) {
    add(`live round-trip: ${label}`, false, String(e));
    return null;
  }
}

function finish(checks: Check[], hardFail: boolean): void {
  console.log('\n=== AutoDev SDK smoke-test (@anthropic-ai/claude-agent-sdk) ===');
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  -- ${c.detail}` : ''}`);
  console.log('');
  process.exit(hardFail ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
