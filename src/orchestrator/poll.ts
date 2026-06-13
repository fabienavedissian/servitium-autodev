import type { Ledger, Caps } from '../cost/ledger';
import type { TaskState } from '../fsm/machine';

export interface QueuedTask {
  id: number;
  repo: string;
  title: string;
  body: string;
  allowedPaths: string[];
}

export interface TaskSource {
  next(): Promise<QueuedTask | null>;
  markWip(task: QueuedTask): Promise<void>;
  markReady(task: QueuedTask, pr: { number: number; url: string }): Promise<void>;
  markBlocked(task: QueuedTask, reason: string): Promise<void>;
}

export interface ProcessResult {
  final: TaskState;
  prCreated?: { number: number; url: string };
}

export interface PollDeps {
  ledger: Ledger;
  caps: Caps;
  source: TaskSource;
  // Heavy IO (mirror/worktree/npm ci + runTask + draft PR) lives here; injected so the loop is testable.
  process: (task: QueuedTask) => Promise<ProcessResult>;
  log?: (msg: string, data?: unknown) => void;
}

export type PollResult = 'paused' | 'idle' | 'processed';

// One scheduler tick at concurrency 1: respect the spend kill-switch, take the next task, drive it,
// and reflect the outcome on the queue. A draft PR is only ever the OUTPUT; nothing auto-merges.
export async function pollOnce(deps: PollDeps): Promise<PollResult> {
  const status = deps.ledger.status(deps.caps);
  if (status.paused) {
    deps.log?.('spend cap reached; queue paused', status);
    return 'paused';
  }

  const task = await deps.source.next();
  if (!task) return 'idle';

  deps.log?.(`processing #${task.id}: ${task.title}`);
  await deps.source.markWip(task);

  const { final, prCreated } = await deps.process(task);

  if ((final.state === 'PR_READY' || final.state === 'DONE') && prCreated) {
    await deps.source.markReady(task, prCreated);
    deps.log?.(`#${task.id} -> draft PR #${prCreated.number}`, { spentUsd: final.spentUsd });
  } else {
    await deps.source.markBlocked(task, final.state);
    deps.log?.(`#${task.id} -> blocked (${final.state})`, { spentUsd: final.spentUsd });
  }
  return 'processed';
}
