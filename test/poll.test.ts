import { pollOnce, type PollDeps, type QueuedTask, type TaskSource, type ProcessResult } from '../src/orchestrator/poll';
import { openDb } from '../src/db/db';
import { Ledger, type Caps } from '../src/cost/ledger';
import type { TaskState } from '../src/fsm/machine';

function task(): QueuedTask {
  return { id: 7, repo: 'servitium-api', title: 't', body: '', allowedPaths: ['src/**'] };
}

function fakeSource(over: Partial<TaskSource> & { task?: QueuedTask | null }): TaskSource {
  const calls: Record<string, unknown[]> = { wip: [], ready: [], blocked: [] };
  const src: TaskSource = {
    next: async () => over.task ?? null,
    markWip: async (t) => void calls.wip.push(t),
    markReady: async (t, pr) => void calls.ready.push([t, pr]),
    markBlocked: async (t, r) => void calls.blocked.push([t, r]),
    ...over,
  };
  (src as unknown as { calls: typeof calls }).calls = calls;
  return src;
}

function ledgerWith(spentUsd: number): Ledger {
  const db = openDb(':memory:');
  const l = new Ledger(db);
  if (spentUsd > 0) l.record('claude-opus-4-8', { input_tokens: 0, output_tokens: 0 }, { costUsd: spentUsd, at: new Date().toISOString() });
  return l;
}

const caps: Caps = { dailyUsd: 10, monthlyUsd: 100 };

const final = (state: TaskState['state']): TaskState => ({ id: 7, state, loopCount: 0, opusReentries: 0, spentUsd: 2 });

describe('pollOnce', () => {
  it('returns paused when the spend cap is reached', async () => {
    const deps: PollDeps = {
      ledger: ledgerWith(200),
      caps,
      source: fakeSource({ task: task() }),
      process: async (): Promise<ProcessResult> => ({ final: final('DONE') }),
    };
    expect(await pollOnce(deps)).toBe('paused');
  });

  it('returns idle when no task is queued', async () => {
    const deps: PollDeps = { ledger: ledgerWith(0), caps, source: fakeSource({ task: null }), process: async () => ({ final: final('DONE') }) };
    expect(await pollOnce(deps)).toBe('idle');
  });

  it('marks ready on PR_READY with a created PR', async () => {
    const source = fakeSource({ task: task() });
    const deps: PollDeps = {
      ledger: ledgerWith(0),
      caps,
      source,
      process: async () => ({ final: final('PR_READY'), prCreated: { number: 42, url: 'u' } }),
    };
    expect(await pollOnce(deps)).toBe('processed');
    expect((source as unknown as { calls: { ready: unknown[]; blocked: unknown[] } }).calls.ready.length).toBe(1);
    expect((source as unknown as { calls: { blocked: unknown[] } }).calls.blocked.length).toBe(0);
  });

  it('marks blocked on NEEDS_HUMAN', async () => {
    const source = fakeSource({ task: task() });
    const deps: PollDeps = { ledger: ledgerWith(0), caps, source, process: async () => ({ final: final('NEEDS_HUMAN') }) };
    expect(await pollOnce(deps)).toBe('processed');
    expect((source as unknown as { calls: { blocked: unknown[] } }).calls.blocked.length).toBe(1);
  });
});
