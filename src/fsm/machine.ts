import { isTerminal, nextState, type Outcome, type State } from './states';

export interface TaskState {
  id: number;
  state: State;
  loopCount: number;
  opusReentries: number;
  spentUsd: number;
}

export interface ExecResult {
  outcome: Outcome;
  costUsd?: number;
  note?: string;
}

export type Executor = (state: State, task: TaskState) => Promise<ExecResult>;

export interface MachineConfig {
  maxLoops: number;
  maxTaskBudgetUsd: number;
}

// Drives the pure transition table with an injectable executor (real roles/gates in prod, scripted
// in tests). Enforces the per-task loop cap and budget as hard backstops -> NEEDS_HUMAN, never an
// infinite or unbounded-cost run. The Opus-heavy stages are only re-entered on a genuine bounce.
export async function runMachine(
  task: TaskState,
  exec: Executor,
  cfg: MachineConfig,
  onStep?: (task: TaskState, prev: State, result: ExecResult) => void,
): Promise<TaskState> {
  const s: TaskState = { ...task };
  let guard = 0;
  while (!isTerminal(s.state)) {
    if (++guard > 1000) {
      s.state = 'FAILED';
      break;
    }
    if (s.spentUsd > cfg.maxTaskBudgetUsd) {
      s.state = 'NEEDS_HUMAN';
      break;
    }
    const prev = s.state;
    const result = await exec(prev, s);
    s.spentUsd += result.costUsd ?? 0;

    let next = nextState(prev, result.outcome);
    // Count a retry/bounce into IMPLEMENT (but not the first entry from TESTS_FIRST).
    if (next === 'IMPLEMENT' && prev !== 'TESTS_FIRST') {
      s.loopCount += 1;
      if (s.loopCount > cfg.maxLoops) next = 'NEEDS_HUMAN';
    }
    s.state = next;
    onStep?.(s, prev, result);
  }
  return s;
}
