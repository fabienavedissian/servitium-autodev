import { runRole, type QueryFn } from '../src/agents/run';
import { ROLES } from '../src/agents/roles';

async function* gen(msgs: Record<string, unknown>[]): AsyncGenerator<Record<string, unknown>> {
  for (const m of msgs) yield m;
}

describe('runRole', () => {
  it('builds isolated options and extracts the result message', async () => {
    let captured: { prompt: string; options?: Record<string, unknown> } | null = null;
    const query: QueryFn = (args) => {
      captured = args;
      return gen([
        { type: 'assistant' },
        { type: 'result', subtype: 'success', result: 'OK', usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.001 },
      ]);
    };
    const res = await runRole(query, { role: ROLES.spec, prompt: 'hi', systemPrompt: 'sys' });
    expect(res.subtype).toBe('success');
    expect(res.text).toBe('OK');
    expect(res.usage?.input_tokens).toBe(10);
    expect(res.totalCostUsd).toBe(0.001);
    const opts = captured!.options!;
    expect(opts.model).toBe(ROLES.spec.model);
    expect(opts.effort).toBe('medium');
    expect(opts.permissionMode).toBe('dontAsk');
    expect(opts.settingSources).toEqual([]);
  });

  it('returns no_result when the stream has no result message', async () => {
    const query: QueryFn = () => gen([{ type: 'assistant' }]);
    const res = await runRole(query, { role: ROLES.triage, prompt: 'x', systemPrompt: 's' });
    expect(res.subtype).toBe('no_result');
  });

  it('applies a model override (implement escalation)', async () => {
    let captured: { options?: Record<string, unknown> } | null = null;
    const query: QueryFn = (args) => {
      captured = args;
      return gen([{ type: 'result', subtype: 'success', result: '', usage: null }]);
    };
    await runRole(query, { role: ROLES.implement, prompt: 'x', systemPrompt: 's', modelOverride: 'claude-opus-4-8' });
    expect(captured!.options!.model).toBe('claude-opus-4-8');
  });
});
