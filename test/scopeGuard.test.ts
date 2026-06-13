import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validateAllowedPaths, globToRegExp, isWriteAllowed, reconcileAllowedPaths } from '../src/git/scopeGuard';

describe('validateAllowedPaths', () => {
  it('accepts a normal feature glob', () => {
    expect(validateAllowedPaths(['src/shop/**', 'src/shop/**/*.spec.ts']).allowed).toBe(true);
  });
  it('rejects an empty allowlist', () => {
    expect(validateAllowedPaths([]).allowed).toBe(false);
  });
  it('rejects too-broad globs', () => {
    for (const g of ['**', '*', '**/*', '/', '.', './**', '**/**']) {
      expect(validateAllowedPaths([g]).allowed).toBe(false);
    }
  });
  it('rejects absolute paths and ".."', () => {
    expect(validateAllowedPaths(['/etc/passwd']).allowed).toBe(false);
    expect(validateAllowedPaths(['src/../..']).allowed).toBe(false);
  });
});

describe('globToRegExp', () => {
  it('matches files under a ** subtree only', () => {
    const re = globToRegExp('src/shop/**');
    expect(re.test('src/shop/cart.ts')).toBe(true);
    expect(re.test('src/shop/a/b/c.ts')).toBe(true);
    expect(re.test('src/auth/login.ts')).toBe(false);
    expect(re.test('src/shop.ts')).toBe(false);
  });
  it('matches a spec pattern', () => {
    const re = globToRegExp('src/**/*.spec.ts');
    expect(re.test('src/shop/cart.spec.ts')).toBe(true);
    expect(re.test('src/shop/cart.ts')).toBe(false);
  });
  it('does not let a single * cross a path segment', () => {
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
  });
});

describe('isWriteAllowed', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'autodev-scope-'));
    fs.mkdirSync(path.join(root, 'src', 'shop'), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('allows a write inside an allowed subtree', () => {
    expect(isWriteAllowed(root, ['src/shop/**'], 'src/shop/new.ts').allowed).toBe(true);
  });

  it('allows creating a file in a NEW (not-yet-existing) subdirectory inside allowed_paths', () => {
    expect(isWriteAllowed(root, ['src/shop/**'], 'src/shop/newdir/deep/new.spec.ts').allowed).toBe(true);
  });
  it('denies a write outside allowed_paths', () => {
    expect(isWriteAllowed(root, ['src/shop/**'], 'src/auth/login.ts').allowed).toBe(false);
  });
  it('denies a ".." escape', () => {
    expect(isWriteAllowed(root, ['src/shop/**'], '../../etc/passwd').allowed).toBe(false);
  });
  it('denies a symlink target (when symlink creation is permitted)', () => {
    const link = path.join(root, 'src', 'shop', 'link.ts');
    try {
      fs.symlinkSync(path.join(os.tmpdir(), 'autodev-target'), link);
    } catch {
      return; // Windows without Developer Mode cannot create symlinks; skip.
    }
    expect(isWriteAllowed(root, ['src/shop/**'], 'src/shop/link.ts').allowed).toBe(false);
  });
});

describe('reconcileAllowedPaths', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'autodev-recon-'));
    fs.mkdirSync(path.join(root, 'src', 'infrastructure', 'payments'), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('widens a typo dir glob to the nearest existing ancestor', () => {
    const r = reconcileAllowedPaths(root, ['src/infrastructure/payment/**']);
    expect(r.globs).toEqual(['src/infrastructure/**']);
    expect(r.corrections).toHaveLength(1);
  });
  it('keeps a glob whose concrete dir prefix exists', () => {
    const r = reconcileAllowedPaths(root, ['src/infrastructure/payments/**']);
    expect(r.globs).toEqual(['src/infrastructure/payments/**']);
    expect(r.corrections).toEqual([]);
  });
  it('keeps a wildcard-segment spec glob whose concrete prefix exists', () => {
    const r = reconcileAllowedPaths(root, ['src/infrastructure/**/*.spec.ts']);
    expect(r.globs).toEqual(['src/infrastructure/**/*.spec.ts']);
  });
  it('keeps a new-file glob whose parent dir exists', () => {
    const r = reconcileAllowedPaths(root, ['src/infrastructure/payments/paypal.service.ts']);
    expect(r.globs).toEqual(['src/infrastructure/payments/paypal.service.ts']);
  });
  it('dedups after widening two typos to the same ancestor', () => {
    const r = reconcileAllowedPaths(root, ['src/infrastructure/payment/**', 'src/infrastructure/paypal/**']);
    expect(r.globs).toEqual(['src/infrastructure/**']);
  });
  it('drops a glob with no existing part', () => {
    const r = reconcileAllowedPaths(root, ['nope/totally/missing/**']);
    expect(r.globs).toEqual([]);
    expect(r.corrections[0]).toMatch(/dropped/);
  });
});
