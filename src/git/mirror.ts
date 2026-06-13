import * as fs from 'fs';
import * as path from 'path';
import { LocalRunner } from '../sandbox/run';

// Host-side trusted git operations (NOT the untrusted gate sandbox). A bare mirror clone is
// fetched once and refreshed per task; worktrees branch off it (see worktree.ts).
const git = new LocalRunner();

export function ensureMirror(source: string, mirrorDir: string): void {
  const exists = fs.existsSync(path.join(mirrorDir, 'HEAD')) || fs.existsSync(path.join(mirrorDir, 'config'));
  if (exists) {
    updateMirror(mirrorDir);
    return;
  }
  fs.mkdirSync(path.dirname(mirrorDir), { recursive: true });
  const r = git.run('git', ['clone', '--mirror', source, mirrorDir], { cwd: process.cwd() });
  if (r.exitCode !== 0) throw new Error(`git clone --mirror failed: ${r.stderr || r.stdout}`);
}

export function updateMirror(mirrorDir: string): void {
  const r = git.run('git', ['remote', 'update', '--prune'], { cwd: mirrorDir });
  if (r.exitCode !== 0) throw new Error(`git remote update failed: ${r.stderr || r.stdout}`);
}
