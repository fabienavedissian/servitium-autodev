import { runGates } from '../src/gates/runner';
import { pass, fail, type Gate, type GateContext } from '../src/gates/index';
import { LocalRunner } from '../src/sandbox/run';

const ctx: GateContext = { worktreeRoot: '/wt', runner: new LocalRunner(), allowedPaths: ['src/**'], baseRef: 'BASE' };

describe('runGates', () => {
  it('passes only when every gate passes', async () => {
    const gates: Gate[] = [
      { name: 'tsc', run: () => pass('tsc') },
      { name: 'lint', run: () => pass('lint') },
    ];
    const s = await runGates(gates, ctx);
    expect(s.allPass).toBe(true);
    expect(s.failed).toEqual([]);
  });

  it('collects every failure and does not stop early', async () => {
    const gates: Gate[] = [
      { name: 'tsc', run: () => fail('tsc') },
      { name: 'lint', run: () => pass('lint') },
      { name: 'audit', run: () => fail('audit') },
    ];
    const s = await runGates(gates, ctx);
    expect(s.allPass).toBe(false);
    expect(s.failed.sort()).toEqual(['audit', 'tsc']);
    expect(s.results.length).toBe(3);
  });

  it('treats a throwing gate as a failure', async () => {
    const gates: Gate[] = [
      {
        name: 'relevance',
        run: () => {
          throw new Error('boom');
        },
      },
    ];
    const s = await runGates(gates, ctx);
    expect(s.allPass).toBe(false);
    expect(s.results[0].details.error).toMatch(/boom/);
  });
});
