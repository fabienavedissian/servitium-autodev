import { runTask } from '../src/orchestrator/runTask';
import type { AgentSdk } from '../src/sdk/client';
import { FakeRunner, result } from './helpers/fakeRunner';
import type { TaskContext } from '../src/agents/prompts';

async function* gen(msgs: Record<string, unknown>[]): AsyncGenerator<Record<string, unknown>> {
  for (const m of msgs) yield m;
}

// Role-aware fake: returns the JSON each role is expected to emit, keyed off its system prompt.
function roleJson(sp: string): string {
  if (sp.includes('TRIAGE')) return '{"actionable":true,"reason":"ok"}';
  if (sp.includes('SPEC agent')) return '{"spec":"s","acceptanceCriteria":["a"],"allowedPaths":["src/**"]}';
  if (sp.includes('TDD agent')) return '{"specFiles":["src/x.spec.ts"],"summary":"s"}';
  if (sp.includes('IMPLEMENTER')) return '{"summary":"impl","done":true}';
  if (sp.includes('CODE REVIEWER')) return '{"decision":"approve","notes":""}';
  if (sp.includes('CHALLENGER')) return '{"decision":"clean","findings":[]}';
  if (sp.includes('RED TEAM')) return '{"decision":"clean"}';
  if (sp.includes('SECURITY')) return '{"decision":"clean","criticals":[]}';
  if (sp.includes('FINAL REVIEWER')) return '{"decision":"clean","notes":""}';
  if (sp.includes('VALIDATOR')) return '{"decision":"pass","prTitle":"t","prSummary":"s"}';
  return '{}';
}

function fakeSdk(): AgentSdk {
  return {
    query: (args) => {
      const sp = String((args.options as { systemPrompt?: unknown } | undefined)?.systemPrompt ?? '');
      return gen([{ type: 'result', subtype: 'success', result: roleJson(sp), usage: null, total_cost_usd: 0.01 }]);
    },
    tool: () => ({}),
    createSdkMcpServer: () => ({}),
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY: '',
  };
}

// tests-red (jest WITH a spec arg) fails (red=good); tests-green (no spec arg) passes; tsc clean;
// git diff empty (in scope).
function gateRunner(): FakeRunner {
  return new FakeRunner((command, args) => {
    if (command === 'npx' && args[0] === 'jest') {
      const hasSpec = args.some((a) => a.endsWith('.spec.ts'));
      return result({ exitCode: hasSpec ? 1 : 0 });
    }
    if (command === 'npx' && args[0] === 'tsc') return result({ exitCode: 0 });
    if (command === 'git' && args[0] === 'diff') return result({ stdout: '' });
    if (command === 'git' && args[0] === 'ls-files') return result({ stdout: '' });
    return result({});
  });
}

describe('runTask assembly (offline integration)', () => {
  it('drives the full chain to DONE with green gates', async () => {
    const ctx: TaskContext = { repo: 'servitium-api', title: 't', body: '', allowedPaths: ['src/**'] };
    let spent = 0;
    const end = await runTask({
      sdk: fakeSdk(),
      runner: gateRunner(),
      worktreeRoot: '/wt',
      baseRef: 'BASE',
      ctx,
      caps: { maxLoops: 4, maxTaskBudgetUsd: 50 },
      onCost: (usd) => {
        spent += usd;
      },
    });
    expect(end.state).toBe('DONE');
    expect(spent).toBeGreaterThan(0);
  });

  it('parks in NEEDS_HUMAN when implement gates never pass', async () => {
    const failingGates = new FakeRunner((command, args) => {
      if (command === 'npx' && args[0] === 'jest') {
        const hasSpec = args.some((a) => a.endsWith('.spec.ts'));
        return result({ exitCode: hasSpec ? 1 : 1 }); // full suite stays red -> implement never passes
      }
      return result({ exitCode: 0, stdout: '' });
    });
    const ctx: TaskContext = { repo: 'servitium-api', title: 't', body: '', allowedPaths: ['src/**'] };
    const end = await runTask({
      sdk: fakeSdk(),
      runner: failingGates,
      worktreeRoot: '/wt',
      baseRef: 'BASE',
      ctx,
      caps: { maxLoops: 3, maxTaskBudgetUsd: 50 },
    });
    expect(end.state).toBe('NEEDS_HUMAN');
  });
});
