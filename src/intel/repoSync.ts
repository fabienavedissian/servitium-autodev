import * as fs from 'fs';
import * as path from 'path';
import type { Config } from '../config';
import { LocalRunner } from '../sandbox/run';

// Clones-or-pulls the Servitium repos host-side so the brief/feasibility agent can READ the real code
// (confirm exact class/method/identifier names) instead of only trusting the injected file map.
// Shared by the brief lane and (conceptually) the code-scan lane; imports nothing from pipeline/scan
// so there is no circular dependency.

const git = new LocalRunner();

export const CODESCAN_ROOT = process.env.AUTODEV_CODESCAN_DIR ?? '/opt/autodev/codescan';

export const SERVITIUM_REPOS = [
  'servitium-api',
  'servitium-center',
  'servitium-portal',
  'servitium-ui',
  'servitium-electron-gui',
  'servitium-discord',
  'servitium-autodev',
];

// Clone (shallow) or `git pull` one repo into the scan dir. Returns its dir, or null on failure.
export function syncRepo(repo: string, cfg: Config): string | null {
  const dir = path.join(CODESCAN_ROOT, repo);
  const url = `https://x-access-token:${cfg.GITHUB_PAT}@github.com/${cfg.GITHUB_ORG}/${repo}.git`;
  try {
    if (fs.existsSync(path.join(dir, '.git'))) {
      git.run('git', ['pull', '--depth', '1', '--no-tags'], { cwd: dir, timeoutMs: 120_000 });
    } else {
      fs.mkdirSync(CODESCAN_ROOT, { recursive: true });
      const r = git.run('git', ['clone', '--depth', '1', url, dir], { cwd: CODESCAN_ROOT, timeoutMs: 240_000 });
      if (r.exitCode !== 0) return null;
    }
    return dir;
  } catch {
    return null;
  }
}

// Pull/clone every requested repo; returns the list that synced OK. Best-effort: a repo that fails to
// sync is simply skipped (the agent still has the injected file map for it).
export function syncRepos(repos: string[], cfg: Config): string[] {
  const ok: string[] = [];
  for (const r of repos) {
    if (syncRepo(r, cfg)) ok.push(r);
  }
  return ok;
}
