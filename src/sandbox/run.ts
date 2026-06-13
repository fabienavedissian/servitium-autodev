import { spawnSync } from 'child_process';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface SandboxRunner {
  readonly kind: string;
  run(command: string, args: string[], opts: RunOptions): CommandResult;
}

// Dev/local runner: NO isolation. Used on non-Linux to build and test the gate harness.
// NEVER use this to run untrusted gate code (jest/npm/tsc on a task branch) on the box.
export class LocalRunner implements SandboxRunner {
  readonly kind = 'local';

  run(command: string, args: string[], opts: RunOptions): CommandResult {
    const r = spawnSync(command, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 600_000,
      env: opts.env ?? process.env,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    const timedOut = !!r.error && /ETIMEDOUT|timed out/i.test(String(r.error));
    if (r.error && !timedOut) {
      return { exitCode: 127, stdout: r.stdout ?? '', stderr: String(r.error), timedOut: false };
    }
    return {
      exitCode: r.status ?? (r.signal ? 1 : 0),
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? '',
      timedOut,
    };
  }
}

// Linux no-network, non-root sandbox (bubblewrap). Wired when the box is available (plan O6).
// The intended invocation bind-mounts ONLY the worktree, unshares the network, drops to a
// non-root user, and runs npm with ignore-scripts. Throws until implemented on the box so a
// misconfigured run can never silently execute untrusted code unsandboxed.
export class BubblewrapRunner implements SandboxRunner {
  readonly kind = 'bubblewrap';

  run(): CommandResult {
    throw new Error(
      'BubblewrapRunner is not wired yet (needs the Linux box, plan O6). Use LocalRunner for harness dev only.',
    );
  }
}

export function selectRunner(env: NodeJS.ProcessEnv = process.env): SandboxRunner {
  if (process.platform === 'linux' && env.AUTODEV_SANDBOX === 'bwrap') return new BubblewrapRunner();
  return new LocalRunner();
}
