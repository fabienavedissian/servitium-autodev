import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ensureMirror } from '../git/mirror';
import { addWorktree, removeWorktree } from '../git/worktree';
import { LocalRunner, selectRunner } from '../sandbox/run';
import { runTask } from './runTask';
import { runJestJson } from '../gates/jest';
import { composePrTitle, composePrBody } from '../github/pr';
import type { AgentSdk } from '../sdk/client';
import type { Ledger } from '../cost/ledger';
import type { GithubClient } from '../github/client';
import type { QueuedTask, ProcessResult } from './poll';
import type { MachineConfig, TaskState } from '../fsm/machine';
import type { TaskContext } from '../agents/prompts';
import type { GateContext } from '../gates/index';
import type { SandboxRunner } from '../sandbox/run';

// Provide the non-repo monorepo-root shared/ folder next to the worktree (servitium-api imports it
// via ../../../../shared). Captures the pristine baseline (pre-existing jest failures + tsc errors)
// so the gates require NO NEW failures rather than a fully-green messy real codebase.
function linkShared(worktree: string): void {
  const src = process.env.AUTODEV_SHARED_DIR ?? '/opt/autodev/shared';
  const link = path.join(path.dirname(worktree), 'shared');
  try {
    if (fs.existsSync(src) && !fs.existsSync(link)) fs.symlinkSync(src, link, 'dir');
  } catch {
    /* best-effort */
  }
}

// Reuse node_modules across missions, keyed by package-lock hash. Hardlink-restore (cp -al) is
// near-instant and cheap on disk; node_modules is read-only during a run so the shared inodes are
// safe. Falls back to a fresh `npm install` on any miss/failure. Same-fs requirement: cache lives
// next to the worktree under /opt/autodev.
function installDeps(
  host: SandboxRunner,
  worktree: string,
  repo: string,
  log?: (m: string, d?: unknown) => void,
): { exitCode: number; stderr: string; cached: boolean } {
  const cacheRoot = process.env.AUTODEV_NPM_CACHE ?? '/opt/autodev/npmcache';
  const dest = path.join(worktree, 'node_modules');
  let hash = '';
  try {
    hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(worktree, 'package-lock.json'))).digest('hex').slice(0, 16);
  } catch {
    /* no lockfile -> no cache key */
  }
  const warm = hash ? path.join(cacheRoot, `${repo}-${hash}`) : '';

  if (warm && fs.existsSync(warm) && !fs.existsSync(dest)) {
    const cp = host.run('cp', ['-al', warm, dest], { cwd: worktree, timeoutMs: 180_000 });
    if (cp.exitCode === 0 && fs.existsSync(dest)) {
      log?.(`#deps: restored node_modules from cache (${repo}-${hash})`);
      return { exitCode: 0, stderr: '', cached: true };
    }
    try {
      fs.rmSync(dest, { recursive: true, force: true });
    } catch {
      /* fall through to fresh install */
    }
  }

  const npm = host.run('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'], { cwd: worktree, timeoutMs: 900_000 });
  if (npm.exitCode === 0 && warm && !fs.existsSync(warm)) {
    try {
      fs.mkdirSync(path.dirname(warm), { recursive: true });
      host.run('cp', ['-al', dest, warm], { cwd: worktree, timeoutMs: 180_000 });
    } catch {
      /* best-effort cache fill */
    }
  }
  return { exitCode: npm.exitCode, stderr: npm.stderr, cached: false };
}

function captureBaselines(
  host: SandboxRunner,
  worktree: string,
  cacheDir: string,
  sha: string,
  log?: (m: string, d?: unknown) => void,
): GateContext['baselines'] {
  const cacheFile = path.join(cacheDir, `baseline-${sha}.json`);
  if (fs.existsSync(cacheFile)) {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as GateContext['baselines'];
    } catch {
      /* recompute */
    }
  }
  log?.(`capturing baselines (jest + tsc) for ${sha.slice(0, 7)} — one-time, several minutes`);
  // Baseline MUST run in the same (sandboxed) environment as the tests-green gate, else env
  // differences (network, mongod, speed) produce false "new failures".
  const failingTests = runJestJson(selectRunner(), worktree, [], 900_000).failures;
  const t = host.run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], { cwd: worktree, timeoutMs: 600_000 });
  const tscErrors = `${t.stdout}\n${t.stderr}`.split('\n').map((l) => l.trim()).filter((l) => /error TS\d+:/.test(l));
  const baselines = { failingTests, tscErrors };
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(baselines));
  } catch {
    /* best-effort cache */
  }
  log?.(`baseline: ${failingTests.length} pre-existing test failures, ${tscErrors.length} tsc errors`);
  return baselines;
}

export interface ProcessorDeps {
  sdk: AgentSdk;
  ledger: Ledger;
  caps: MachineConfig;
  workRoot: string;
  mirrorRoot: string;
  repoUrl: (repo: string) => string; // PAT https URL to mirror + push
  github?: GithubClient;
  gitIdentity?: { name: string; email: string };
  onStep?: (taskId: number, rec: import('../fsm/executor').StepRecord) => void;
  onState?: (taskId: number, state: string, prev: string, spentUsd: number) => void;
  onProgress?: (taskId: number, phase: string, detail: string) => void;
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

    deps.onState?.(task.id, 'SETUP', 'QUEUED', 0);
    deps.onProgress?.(task.id, 'SETUP', 'Preparing workspace (git worktree)');
    ensureMirror(deps.repoUrl(task.repo), mirror);
    removeWorktree(mirror, worktree);
    addWorktree(mirror, worktree, branch, 'main');
    linkShared(worktree);
    try {
      const id = deps.gitIdentity ?? { name: 'AutoDev', email: 'autodev@servitium.org' };
      host.run('git', ['config', 'user.name', id.name], { cwd: worktree });
      host.run('git', ['config', 'user.email', id.email], { cwd: worktree });

      deps.onProgress?.(task.id, 'SETUP', 'Installing dependencies (npm)');
      deps.log?.(`#${task.id}: install deps`);
      const npm = installDeps(host, worktree, task.repo, deps.log);
      if (npm.exitCode !== 0) {
        deps.log?.(`#${task.id}: npm install failed`, npm.stderr.slice(-300));
        return { final: failed(task.id) };
      }
      // npm may rewrite the lockfile (box npm version != the one that generated it); restore it so the
      // env churn never pollutes the change diff / scope-diff gate.
      host.run('git', ['checkout', '--', 'package-lock.json'], { cwd: worktree });

      deps.onProgress?.(task.id, 'SETUP', npm.cached ? 'Capturing the test baseline' : 'Capturing the test baseline (one-time, ~1 min)');
      const baseSha = host.run('git', ['rev-parse', 'HEAD'], { cwd: worktree }).stdout.trim() || 'head';
      const baselines = captureBaselines(host, worktree, deps.mirrorRoot, baseSha, deps.log);
      deps.onStep?.(task.id, {
        phase: 'SETUP',
        status: 'ok',
        outcome: 'ok',
        costUsd: 0,
        text: JSON.stringify({
          prepared: 'mirror + worktree + npm install + baseline captured',
          base: baseSha.slice(0, 10),
          preexistingTestFailures: baselines?.failingTests?.length ?? 0,
          preexistingTscErrors: baselines?.tscErrors?.length ?? 0,
        }),
      });

      const ctx: TaskContext = { repo: task.repo, title: task.title, body: task.body, allowedPaths: task.allowedPaths };
      const final = await runTask({
        sdk: deps.sdk,
        runner: selectRunner(),
        worktreeRoot: worktree,
        baseRef: 'main',
        ctx,
        caps: deps.caps,
        baselines,
        onCost: (usd, model) => deps.ledger.record(model, { input_tokens: 0, output_tokens: 0 }, { costUsd: usd, taskId: task.id }),
        onStep: (rec) => deps.onStep?.(task.id, rec),
        onState: (state, prev, spentUsd) => deps.onState?.(task.id, state, prev, spentUsd),
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
