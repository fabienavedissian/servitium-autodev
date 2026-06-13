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
  it('builds a no-network, secret-masked, worktree-writable sandbox invocation', () => {
    const a = buildBwrapArgs('/wt/task', ['/cache/mongod'], 'npx', ['jest']);
    expect(a).toContain('--unshare-net');
    expect(a).toContain('--tmpfs'); // /home and /root masked
    expect(a.join(' ')).toContain('--tmpfs /home');
    expect(a.join(' ')).toContain('--tmpfs /root');
    expect(a.join(' ')).toContain('--bind /wt/task /wt/task');
    expect(a.join(' ')).toContain('--ro-bind /cache/mongod /cache/mongod');
    // the actual command comes after the -- separator
    const sep = a.indexOf('--', 1);
    expect(a.slice(sep + 1)).toEqual(['npx', 'jest']);
  });
});
