import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { ensureMirror } from '../src/git/mirror';
import { addWorktree, listWorktrees, removeWorktree } from '../src/git/worktree';

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

describe('mirror + worktree', () => {
  let base: string;
  let source: string;
  let mirror: string;
  let wt: string;

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'autodev-wt-'));
    source = path.join(base, 'source');
    mirror = path.join(base, 'mirror.git');
    wt = path.join(base, 'work', 'task1');
    fs.mkdirSync(source, { recursive: true });
    git(source, ['init', '-q', '-b', 'main']);
    git(source, ['config', 'user.email', 't@t.t']);
    git(source, ['config', 'user.name', 't']);
    fs.writeFileSync(path.join(source, 'hello.txt'), 'hi\n');
    git(source, ['add', '-A']);
    git(source, ['commit', '-q', '-m', 'init']);
  });

  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

  it('clones a mirror and adds a worktree on a new branch', () => {
    ensureMirror(source, mirror);
    expect(fs.existsSync(path.join(mirror, 'HEAD'))).toBe(true);
    addWorktree(mirror, wt, 'autodev/1', 'main');
    expect(fs.existsSync(path.join(wt, 'hello.txt'))).toBe(true);
    expect(listWorktrees(mirror).some((w) => path.resolve(w) === path.resolve(wt))).toBe(true);
    removeWorktree(mirror, wt);
  });

  it('ensureMirror is idempotent on an existing mirror', () => {
    expect(() => ensureMirror(source, mirror)).not.toThrow();
  });
});
