import { spawnSync } from 'child_process';
import * as fs from 'fs';

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

// Linux no-network, non-root sandbox (bubblewrap). The whole filesystem is read-only; /home and
// /root are masked with empty tmpfs (so the orchestrator's .env / ~/.ssh / prod creds are ABSENT),
// the worktree is re-exposed writable on top, the network is unshared, and npm scripts are ignored.
// Even hostile test code (jest.config.js, a malicious spec) has no secrets to read and nowhere to
// exfiltrate to. extraRoBinds adds read-only paths (e.g. a shared mongod download cache).
export class BubblewrapRunner implements SandboxRunner {
  readonly kind = 'bubblewrap';
  private readonly local = new LocalRunner();

  constructor(private readonly extraRoBinds: string[] = []) {}

  run(command: string, args: string[], opts: RunOptions): CommandResult {
    const mongod = process.env.AUTODEV_MONGOD ?? '/opt/autodev/mongo-cache/mongod';
    const mongodBin = (() => {
      try {
        return fs.existsSync(mongod) ? mongod : undefined;
      } catch {
        return undefined;
      }
    })();
    const bwrapArgs = buildBwrapArgs(opts.cwd, this.extraRoBinds, command, args, mongodBin);
    const env = { ...(opts.env ?? process.env), npm_config_ignore_scripts: 'true' };
    return this.local.run('bwrap', bwrapArgs, { cwd: opts.cwd, timeoutMs: opts.timeoutMs, env });
  }
}

// Pure bwrap argument builder (unit-tested). No EXTERNAL network (--unshare-net) but a working
// loopback (brought up via a root-in-userns + CAP_NET_ADMIN wrapper) so mongodb-memory-server can
// bind 127.0.0.1; read-only root; /home + /root masked with empty tmpfs (secrets absent); worktree
// re-exposed writable; npm scripts ignored; a pre-downloaded mongod fed via MONGOMS_SYSTEM_BINARY.
export function buildBwrapArgs(
  worktree: string,
  extraRoBinds: string[],
  command: string,
  args: string[],
  mongodBinary?: string,
): string[] {
  const a = [
    '--unshare-user', '--uid', '0', '--gid', '0',
    '--unshare-net', '--unshare-ipc', '--unshare-uts',
    '--cap-add', 'CAP_NET_ADMIN',
    '--die-with-parent', '--new-session',
    '--ro-bind', '/', '/',
    '--tmpfs', '/home',
    '--tmpfs', '/root',
    '--tmpfs', '/tmp',
    '--proc', '/proc',
    '--dev', '/dev',
    '--bind', worktree, worktree,
  ];
  for (const b of extraRoBinds) a.push('--ro-bind', b, b);
  a.push('--chdir', worktree, '--setenv', 'HOME', worktree, '--setenv', 'npm_config_ignore_scripts', 'true');
  if (mongodBinary) a.push('--setenv', 'MONGOMS_SYSTEM_BINARY', mongodBinary, '--setenv', 'MONGOMS_DISABLE_POSTINSTALL', '1');
  // Bring loopback up, then exec the real command (so 127.0.0.1 works for mongod) without external net.
  a.push('--', '/bin/sh', '-c', 'ip link set lo up 2>/dev/null || true; exec "$0" "$@"', command, ...args);
  return a;
}

// Use the real sandbox on Linux when bubblewrap is available; LocalRunner elsewhere (harness dev).
export function selectRunner(env: NodeJS.ProcessEnv = process.env, extraRoBinds: string[] = []): SandboxRunner {
  if (process.platform === 'linux' && env.AUTODEV_SANDBOX !== 'off') return new BubblewrapRunner(extraRoBinds);
  return new LocalRunner();
}
