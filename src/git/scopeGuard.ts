import * as fs from 'fs';
import * as path from 'path';

// TCB (trusted computing base). Security-critical: keep it dependency-free and auditable.
// This file is hard-excluded from any agent-writable allowed_paths (plan s11) and changes
// only via a human-authored PR.

export interface ScopeDecision {
  allowed: boolean;
  reason: string;
}

const MAX_ALLOWED_GLOBS = 20;

// Reject an allowlist too broad to be a meaningful scope guard. allowed_paths is also
// human-confirmed at SPEC_APPROVAL; this is the code-side backstop.
export function validateAllowedPaths(globs: string[]): ScopeDecision {
  if (globs.length === 0) return { allowed: false, reason: 'empty allowlist' };
  if (globs.length > MAX_ALLOWED_GLOBS) {
    return { allowed: false, reason: `too many globs (${globs.length} > ${MAX_ALLOWED_GLOBS})` };
  }
  const tooBroad = new Set(['', '*', '**', '**/*', '/', '.', './', './**', '**/**']);
  for (const g of globs) {
    const n = g.trim();
    if (tooBroad.has(n)) return { allowed: false, reason: `glob too broad: "${g}"` };
    if (path.isAbsolute(n)) return { allowed: false, reason: `glob must be worktree-relative: "${g}"` };
    if (n.includes('..')) return { allowed: false, reason: `glob must not contain "..": "${g}"` };
    const concrete = n.split('/').filter((s) => s && s !== '**' && s !== '*');
    if (concrete.length === 0) return { allowed: false, reason: `glob has no concrete segment: "${g}"` };
  }
  return { allowed: true, reason: 'ok' };
}

// Restricted glob -> anchored RegExp over POSIX-relative paths. ** matches across
// segments, * within a segment. Glob is the SECONDARY check; realpath containment is primary.
export function globToRegExp(glob: string): RegExp {
  const norm = glob.replace(/\\/g, '/');
  let re = '^';
  let i = 0;
  while (i < norm.length) {
    const c = norm[i];
    if (c === '*' && norm[i + 1] === '*') {
      re += '.*';
      i += 2;
      if (norm[i] === '/') i++;
    } else if (c === '*') {
      re += '[^/]*';
      i++;
    } else if ('+?.()|[]{}^$\\/'.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp(re + '$');
}

// Decide whether a write to targetPath (relative to or absolute within worktreeRoot) is allowed.
// Defeats ".." and symlink escapes via realpath containment, then matches allowed globs.
export function isWriteAllowed(worktreeRoot: string, allowedGlobs: string[], targetPath: string): ScopeDecision {
  const root = realpathSafe(worktreeRoot);
  if (!root) return { allowed: false, reason: 'worktree root does not resolve' };

  const abs = path.resolve(worktreeRoot, targetPath);

  if (isSymlink(abs)) return { allowed: false, reason: 'target is a symlink' };

  const realParent = realpathSafe(path.dirname(abs));
  if (!realParent) return { allowed: false, reason: 'parent directory does not resolve' };

  const realAbs = path.join(realParent, path.basename(abs));
  if (!isInside(root, realAbs)) return { allowed: false, reason: 'path escapes the worktree' };

  const rel = path.relative(root, realAbs).split(path.sep).join('/');
  for (const g of allowedGlobs) {
    if (globToRegExp(g).test(rel)) return { allowed: true, reason: `matched "${g}"` };
  }
  return { allowed: false, reason: 'not in allowed_paths' };
}

function isInside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function realpathSafe(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
