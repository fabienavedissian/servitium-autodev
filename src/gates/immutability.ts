import * as fs from 'fs';
import * as path from 'path';
import { hashFile } from '../util/hash';
import { fail, pass, type Gate, type GateContext, type GateResult } from './index';

// Frozen TDD/red-team specs may not be deleted or modified once frozen at the
// TESTS_FIRST -> IMPLEMENT transition. Hash-equality is intentionally strict: the implementer
// must not touch a frozen spec at all (a wrong test forces an explicit human bounce, not an edit).
export const immutabilityGate = {
  name: 'immutability' as const,
  run(ctx: GateContext): GateResult {
    const frozen = ctx.frozenTests ?? {};
    const violations: { file: string; reason: string }[] = [];
    for (const [rel, expected] of Object.entries(frozen)) {
      const abs = path.join(ctx.worktreeRoot, rel);
      if (!fs.existsSync(abs)) {
        violations.push({ file: rel, reason: 'frozen spec deleted' });
        continue;
      }
      if (hashFile(abs) !== expected) violations.push({ file: rel, reason: 'frozen spec modified' });
    }
    if (violations.length) return fail('immutability', { violations });
    return pass('immutability', { frozenCount: Object.keys(frozen).length });
  },
} satisfies Gate;

// Snapshot spec content hashes at the freeze point.
export function freezeTests(worktreeRoot: string, specRelPaths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of specRelPaths) out[rel] = hashFile(path.join(worktreeRoot, rel));
  return out;
}
