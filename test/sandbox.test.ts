import { LocalRunner, BubblewrapRunner, selectRunner } from '../src/sandbox/run';

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

describe('BubblewrapRunner', () => {
  it('refuses to run until wired on the box', () => {
    expect(() => new BubblewrapRunner().run()).toThrow(/not wired/i);
  });
});
