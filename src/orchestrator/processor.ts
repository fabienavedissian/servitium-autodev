import * as path from 'path';
import { ensureMirror } from '../git/mirror';
import { addWorktree, removeWorktree } from '../git/worktree';
import { LocalRunner, selectRunner } from '../sandbox/run';
import { runTask } from './runTask';
import { composePrTitle, composePrBody } from '../github/pr';
import type { AgentSdk } from '../sdk/client';
import type { Ledger } from '../cost/ledger';
import type { GithubClient } from '../github/client';
import type { QueuedTask, ProcessResult } from './poll';
import type { MachineConfig, TaskState } from '../fsm/machine';
import type { TaskContext } from '../agents/prompts';

export interface ProcessorDeps {
  sdk: AgentSdk;
  ledger: Ledger;
  caps: MachineConfig;
  workRoot: string;
  mirrorRoot: string;
  repoUrl: (repo: string) => string; // PAT https URL to mirror + push
  github?: GithubClient;
  gitIdentity?: { name: string; email: string };
  log?: (m: string, d?: unknown) => void;
}

// The concrete heavy-IO `process()` for the poll loop. Host-side (trusted): mirror -> worktree ->
// npm ci. Then runTask drives the agent chain with the bubblewrap gate sandbox (selectRunner). On
// PR_READY it commits + pushes the branch and opens a DRAFT PR (never merges). Worktree torn down
// in finally. Runs live; validated on the box (npm ci + a real chain run), not in offline tests.
export function buildProcessor(deps: ProcessorDeps): (task: QueuedTask) => Promise<ProcessResult> {
  const host = new LocalRunner();
  const failed = (id: number): TaskState => ({ id, state: 'FAILED', loopCount: 0, opusReentries: 0, spentUsd: 0 });

  return async (task) => {
    const mirror = path.join(deps.mirrorRoot, `${task.repo}.git`);
    const branch = `autodev/${task.id}`;
    const worktree = path.join(deps.workRoot, String(task.id), task.repo);

    ensureMirror(deps.repoUrl(task.repo), mirror);
    removeWorktree(mirror, worktree);
    addWorktree(mirror, worktree, branch, 'main');
    try {
      const id = deps.gitIdentity ?? { name: 'AutoDev', email: 'autodev@servitium.org' };
      host.run('git', ['config', 'user.name', id.name], { cwd: worktree });
      host.run('git', ['config', 'user.email', id.email], { cwd: worktree });

      deps.log?.(`#${task.id}: npm install --legacy-peer-deps`);
      // servitium-api has peer-dep conflicts that require --legacy-peer-deps (matches the repo's setup).
      const npm = host.run('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'], { cwd: worktree, timeoutMs: 900_000 });
      if (npm.exitCode !== 0) {
        deps.log?.(`#${task.id}: npm install failed`, npm.stderr.slice(-300));
        return { final: failed(task.id) };
      }

      const ctx: TaskContext = { repo: task.repo, title: task.title, body: task.body, allowedPaths: task.allowedPaths };
      const final = await runTask({
        sdk: deps.sdk,
        runner: selectRunner(),
        worktreeRoot: worktree,
        baseRef: 'main',
        ctx,
        caps: deps.caps,
        onCost: (usd, model) => deps.ledger.record(model, { input_tokens: 0, output_tokens: 0 }, { costUsd: usd, taskId: task.id }),
      });

      let prCreated: { number: number; url: string } | undefined;
      if (final.state === 'PR_READY') {
        host.run('git', ['add', '-A'], { cwd: worktree });
        host.run('git', ['commit', '-m', `autodev: ${task.title} (#${task.id})`], { cwd: worktree });
        const push = host.run('git', ['push', 'origin', branch], { cwd: worktree });
        if (push.exitCode !== 0) {
          deps.log?.(`#${task.id}: push failed`, push.stderr.slice(-300));
        } else if (deps.github) {
          const meta = { issueNumber: task.id, title: task.title, branch, gateMatrix: [], costUsd: final.spentUsd };
          const { body, secretLeak } = composePrBody({ ...meta, spec: ctx.spec, acceptanceCriteria: ctx.acceptanceCriteria });
          if (secretLeak) deps.log?.(`#${task.id}: PR body tripped the secret scanner; not opening PR`);
          else prCreated = await deps.github.createDraftPr(task.repo, branch, 'main', composePrTitle(meta), body);
        }
      }
      return { final, prCreated };
    } finally {
      removeWorktree(mirror, worktree);
    }
  };
}
