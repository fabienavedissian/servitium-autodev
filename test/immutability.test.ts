import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { immutabilityGate, freezeTests } from '../src/gates/immutability';
import { LocalRunner } from '../src/sandbox/run';
import type { GateContext } from '../src/gates/index';

describe('immutability gate', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'autodev-imm-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.spec.ts'), "it('x', () => expect(1).toBe(1));\n");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const ctx = (frozen: Record<string, string>): GateContext => ({
    worktreeRoot: root,
    runner: new LocalRunner(),
    allowedPaths: ['src/**'],
    baseRef: 'BASE',
    frozenTests: frozen,
  });

  it('passes when frozen specs are unchanged', () => {
    const frozen = freezeTests(root, ['src/a.spec.ts']);
    expect(immutabilityGate.run(ctx(frozen)).status).toBe('pass');
  });

  it('fails when a frozen spec is modified', () => {
    const frozen = freezeTests(root, ['src/a.spec.ts']);
    fs.writeFileSync(path.join(root, 'src', 'a.spec.ts'), "it('x', () => expect(1).toBe(2));\n");
    const res = immutabilityGate.run(ctx(frozen));
    expect(res.status).toBe('fail');
    expect((res.details.violations as { reason: string }[])[0].reason).toMatch(/modified/);
  });

  it('fails when a frozen spec is deleted', () => {
    const frozen = freezeTests(root, ['src/a.spec.ts']);
    fs.rmSync(path.join(root, 'src', 'a.spec.ts'));
    expect(immutabilityGate.run(ctx(frozen)).status).toBe('fail');
  });
});
