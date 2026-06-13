import { nextState, isTerminal } from '../src/fsm/states';
import { runMachine, type Executor, type TaskState } from '../src/fsm/machine';

describe('nextState', () => {
  it('walks the happy path to DONE', () => {
    expect(nextState('QUEUED', 'actionable')).toBe('PRE_GATE');
    expect(nextState('PRE_GATE', 'actionable')).toBe('SPEC');
    expect(nextState('SPEC', 'ok')).toBe('SPEC_APPROVAL');
    expect(nextState('SPEC_APPROVAL', 'approved')).toBe('SETUP');
    expect(nextState('SETUP', 'ok')).toBe('TESTS_FIRST');
    expect(nextState('TESTS_FIRST', 'red')).toBe('IMPLEMENT');
    expect(nextState('IMPLEMENT', 'gates-pass')).toBe('CODE_REVIEW');
    expect(nextState('CODE_REVIEW', 'approve')).toBe('CHALLENGE');
    expect(nextState('CHALLENGE', 'clean')).toBe('RED_TEAM');
    expect(nextState('RED_TEAM', 'clean')).toBe('SECURITY');
    expect(nextState('SECURITY', 'clean')).toBe('FINAL_REVIEW');
    expect(nextState('FINAL_REVIEW', 'clean')).toBe('VALIDATE');
    expect(nextState('VALIDATE', 'pass')).toBe('PR_READY');
    expect(nextState('PR_READY', 'ok')).toBe('DONE');
  });

  it('routes bounces and rejects', () => {
    expect(nextState('CODE_REVIEW', 'bounce')).toBe('IMPLEMENT');
    expect(nextState('RED_TEAM', 'repro')).toBe('IMPLEMENT');
    expect(nextState('PRE_GATE', 'reject')).toBe('REJECTED');
    expect(nextState('TESTS_FIRST', 'not-red')).toBe('NEEDS_HUMAN');
    expect(isTerminal('DONE')).toBe(true);
    expect(isTerminal('IMPLEMENT')).toBe(false);
  });
});

const start = (): TaskState => ({ id: 1, state: 'QUEUED', loopCount: 0, opusReentries: 0, spentUsd: 0 });
const cfg = { maxLoops: 4, maxTaskBudgetUsd: 10 };

// Scripts each state's outcome so the driver is tested deterministically with no API cost.
function executor(script: Partial<Record<string, string[]>>): Executor {
  const counters: Record<string, number> = {};
  return async (state) => {
    const seq = script[state] ?? [];
    const i = counters[state] ?? 0;
    counters[state] = i + 1;
    const outcome = (seq[i] ?? seq[seq.length - 1] ?? defaultOutcome(state)) as never;
    return { outcome, costUsd: 0.01 };
  };
}

function defaultOutcome(state: string): string {
  const map: Record<string, string> = {
    QUEUED: 'actionable', PRE_GATE: 'actionable', SPEC: 'ok', SPEC_APPROVAL: 'approved', SETUP: 'ok',
    TESTS_FIRST: 'red', IMPLEMENT: 'gates-pass', CODE_REVIEW: 'approve', CHALLENGE: 'clean',
    RED_TEAM: 'clean', SECURITY: 'clean', FINAL_REVIEW: 'clean', VALIDATE: 'pass', PR_READY: 'ok',
  };
  return map[state] ?? 'ok';
}

describe('runMachine', () => {
  it('reaches DONE on the happy path', async () => {
    const end = await runMachine(start(), executor({}), cfg);
    expect(end.state).toBe('DONE');
    expect(end.loopCount).toBe(0);
  });

  it('counts a code-review bounce as a loop and still finishes', async () => {
    const end = await runMachine(start(), executor({ CODE_REVIEW: ['bounce', 'approve'] }), cfg);
    expect(end.state).toBe('DONE');
    expect(end.loopCount).toBe(1);
  });

  it('parks in NEEDS_HUMAN when the loop cap is exceeded', async () => {
    const end = await runMachine(start(), executor({ IMPLEMENT: ['gates-fail'] }), cfg);
    expect(end.state).toBe('NEEDS_HUMAN');
    expect(end.loopCount).toBe(5);
  });

  it('parks in NEEDS_HUMAN when the task budget is exceeded', async () => {
    const exec: Executor = async () => ({ outcome: 'gates-fail', costUsd: 20 });
    const end = await runMachine({ ...start(), state: 'IMPLEMENT' }, exec, cfg);
    expect(end.state).toBe('NEEDS_HUMAN');
  });
});
