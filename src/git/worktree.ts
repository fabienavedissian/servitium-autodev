import * as fs from 'fs';
import * as path from 'path';
import { LocalRunner } from '../sandbox/run';

const git = new LocalRunner();

export function addWorktree(mirrorDir: string, worktreePath: string, branch: string, startRef = 'main'): void {
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  const r = git.run('git', ['worktree', 'add', '-b', branch, worktreePath, startRef], { cwd: mirrorDir });
  if (r.exitCode !== 0) throw new Error(`git worktree add failed: ${r.stderr || r.stdout}`);
}

export function removeWorktree(mirrorDir: string, worktreePath: string): void {
  git.run('git', ['worktree', 'remove', '--force', worktreePath], { cwd: mirrorDir });
}

export function listWorktrees(mirrorDir: string): string[] {
  const r = git.run('git', ['worktree', 'list', '--porcelain'], { cwd: mirrorDir });
  return r.stdout
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length).trim());
}
