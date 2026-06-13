import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { preToolUseDecision, type GuardState } from '../src/sdk/hooks';

describe('preToolUseDecision (load-bearing scope guard)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'autodev-pre-'));
    fs.mkdirSync(path.join(root, 'src', 'shop'), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const state = (over: Partial<GuardState> = {}): GuardState => ({
    worktreeRoot: root,
    allowedPaths: ['src/shop/**'],
    paused: false,
    phase: 'implement',
    ...over,
  });

  it('denies raw mutators (Bash/Edit/Write)', () => {
    for (const t of ['Bash', 'Edit', 'Write', 'MultiEdit']) {
      expect(preToolUseDecision(t, {}, state()).decision).toBe('deny');
    }
  });

  it('denies any tool when paused', () => {
    expect(preToolUseDecision('Read', {}, state({ paused: true })).decision).toBe('deny');
  });

  it('allows fsWrite inside allowed_paths, denies outside', () => {
    expect(preToolUseDecision('mcp__autodev__fsWrite', { path: 'src/shop/x.ts' }, state()).decision).toBe('allow');
    expect(preToolUseDecision('mcp__autodev__fsWrite', { path: 'src/auth/x.ts' }, state()).decision).toBe('deny');
  });

  it('enforces TESTS_FIRST (only *.spec.ts)', () => {
    expect(
      preToolUseDecision('mcp__autodev__fsWrite', { path: 'src/shop/x.ts' }, state({ phase: 'tests-first' })).decision,
    ).toBe('deny');
    expect(
      preToolUseDecision('mcp__autodev__fsWrite', { path: 'src/shop/x.spec.ts' }, state({ phase: 'tests-first' })).decision,
    ).toBe('allow');
  });

  it('allows read-only tools in normal phases', () => {
    expect(preToolUseDecision('Read', {}, state()).decision).toBe('allow');
    expect(preToolUseDecision('mcp__autodev__runGate', { gate: 'tsc' }, state()).decision).toBe('allow');
  });
});
