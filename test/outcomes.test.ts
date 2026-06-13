import { parseRoleOutcome } from '../src/fsm/outcomes';

describe('parseRoleOutcome', () => {
  it('maps triage', () => {
    expect(parseRoleOutcome('triage', '{"actionable":true}').outcome).toBe('actionable');
    expect(parseRoleOutcome('triage', '{"actionable":false}').outcome).toBe('reject');
  });

  it('maps spec on a non-empty allowed_paths', () => {
    expect(parseRoleOutcome('spec', '{"allowedPaths":["src/shop/**"],"spec":"x"}').outcome).toBe('ok');
    expect(parseRoleOutcome('spec', '{"allowedPaths":[]}').outcome).toBe('error');
  });

  it('maps review/challenger/security/final decisions', () => {
    expect(parseRoleOutcome('review', '{"decision":"approve"}').outcome).toBe('approve');
    expect(parseRoleOutcome('review', '{"decision":"bounce"}').outcome).toBe('bounce');
    expect(parseRoleOutcome('challenger', '{"decision":"clean"}').outcome).toBe('clean');
    expect(parseRoleOutcome('security', '{"decision":"bounce"}').outcome).toBe('bounce');
    expect(parseRoleOutcome('final', '{"decision":"clean"}').outcome).toBe('clean');
  });

  it('maps redteam repro and validator pass', () => {
    expect(parseRoleOutcome('redteam', '{"decision":"repro"}').outcome).toBe('repro');
    expect(parseRoleOutcome('redteam', '{"decision":"clean"}').outcome).toBe('clean');
    expect(parseRoleOutcome('validator', '{"decision":"pass"}').outcome).toBe('pass');
    expect(parseRoleOutcome('validator', '{"decision":"fail"}').outcome).toBe('fail');
  });

  it('defaults safely on garbage (bounce-ish, never crashes)', () => {
    expect(parseRoleOutcome('review', 'not json').outcome).toBe('bounce');
    expect(parseRoleOutcome('triage', '').outcome).toBe('reject');
  });
});
