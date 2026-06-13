import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { scopeDiffGate } from '../src/gates/scopeDiff';
import { LocalRunner } from '../src/sandbox/run';
import type { GateContext } from '../src/gates/index';

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

describe('scope-diff gate', () => {
  let repo: string;
  let base: string;

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'autodev-sd-'));
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 't@t.t']);
    git(repo, ['config', 'user.name', 't']);
    fs.mkdirSync(path.join(repo, 'src', 'shop'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'shop', 'cart.ts'), 'export const a = 1;\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'base']);
    base = git(repo, ['rev-parse', 'HEAD']);
  });

  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  const ctx = (allowed: string[]): GateContext => ({
    worktreeRoot: repo,
    runner: new LocalRunner(),
    allowedPaths: allowed,
    baseRef: base,
  });

  it('passes when a tracked change stays inside allowed_paths', async () => {
    fs.writeFileSync(path.join(repo, 'src', 'shop', 'cart.ts'), 'export const a = 2;\n');
    const res = await scopeDiffGate.run(ctx(['src/shop/**']));
    expect(res.status).toBe('pass');
  });

  it('fails when an untracked file strays outside allowed_paths', async () => {
    fs.mkdirSync(path.join(repo, 'src', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'auth', 'login.ts'), 'export const x = 1;\n');
    const res = await scopeDiffGate.run(ctx(['src/shop/**']));
    expect(res.status).toBe('fail');
    expect((res.details.offending as string[]).join(',')).toContain('src/auth/login.ts');
  });
});
