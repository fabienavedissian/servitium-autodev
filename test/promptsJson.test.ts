import { parseJsonLoose } from '../src/util/json';
import { systemPromptFor } from '../src/agents/prompts';
import type { RoleName } from '../src/agents/roles';

describe('parseJsonLoose', () => {
  it('parses plain JSON', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses fenced JSON', () => {
    expect(parseJsonLoose('```json\n{"actionable": true}\n```')).toEqual({ actionable: true });
  });
  it('parses JSON wrapped in prose', () => {
    expect(parseJsonLoose('Here you go: {"decision":"approve"} done')).toEqual({ decision: 'approve' });
  });
  it('returns null on garbage', () => {
    expect(parseJsonLoose('not json at all')).toBeNull();
  });
});

describe('systemPromptFor', () => {
  const ctx = { repo: 'servitium-api', title: 'x', body: '', allowedPaths: ['src/shop/**'] };
  const roles: RoleName[] = ['triage', 'spec', 'tdd', 'implement', 'review', 'challenger', 'redteam', 'security', 'final', 'validator'];

  it('produces a non-empty, convention-bearing prompt for every role', () => {
    for (const r of roles) {
      const p = systemPromptFor(r, ctx);
      expect(p.length).toBeGreaterThan(80);
      expect(p).toContain('allowed_paths');
      expect(p).toContain('fsWrite');
    }
  });
});
