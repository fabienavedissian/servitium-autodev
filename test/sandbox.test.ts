import { LocalRunner, buildBwrapArgs, selectRunner } from '../src/sandbox/run';

describe('LocalRunner', () => {
  it('runs a command and captures stdout + exit code', () => {
    const r = new LocalRunner().run(
      process.execPath,
      ['-e', 'process.stdout.write("hi"); process.exit(3)'],
      { cwd: process.cwd() },
    );
    expect(r.stdout).toContain('hi');
    expect(r.exitCode).toBe(3);
    expect(r.timedOut).toBe(false);
  });

  it('reports a non-existent command instead of throwing', () => {
    const r = new LocalRunner().run('definitely-not-a-real-binary-xyz', [], { cwd: process.cwd() });
    expect(r.exitCode).not.toBe(0);
  });
});

describe('selectRunner', () => {
  it('returns the local runner without the sandbox flag', () => {
    expect(selectRunner({}).kind).toBe('local');
  });
});

describe('buildBwrapArgs', () => {
  it('builds a no-external-network, secret-masked, worktree-writable sandbox invocation', () => {
    const a = buildBwrapArgs('/wt/task', ['/cache'], 'npx', ['jest'], '/opt/mongod');
    const s = a.join(' ');
    expect(a).toContain('--unshare-net');
    expect(a).toContain('--cap-add'); // CAP_NET_ADMIN to bring lo up
    expect(s).toContain('--tmpfs /home');
    expect(s).toContain('--tmpfs /root');
    expect(s).toContain('--bind /wt/task /wt/task');
    expect(s).toContain('--ro-bind /cache /cache');
    expect(s).toContain('MONGOMS_SYSTEM_BINARY /opt/mongod');
    expect(a).toContain('/bin/sh'); // loopback-up wrapper
    // the real command + args are the last elements
    expect(a.slice(-2)).toEqual(['npx', 'jest']);
  });

  it('omits the mongod env when no binary is provided', () => {
    expect(buildBwrapArgs('/wt', [], 'tsc', []).join(' ')).not.toContain('MONGOMS_SYSTEM_BINARY');
  });
});
