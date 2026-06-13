import { ROLES, MODELS, modelForImplement } from '../src/agents/roles';

describe('role registry', () => {
  it('reserves Opus for the two adversarial roles only', () => {
    const opusRoles = Object.values(ROLES).filter((r) => r.model === MODELS.opus).map((r) => r.name);
    expect(opusRoles.sort()).toEqual(['challenger', 'redteam']);
  });

  it('uses Haiku for triage and Sonnet for the rest', () => {
    expect(ROLES.triage.model).toBe(MODELS.haiku);
    expect(ROLES.spec.model).toBe(MODELS.sonnet);
    expect(ROLES.validator.model).toBe(MODELS.sonnet);
  });

  it('escalates implement to Opus only when hard or after repeated failures', () => {
    expect(modelForImplement(0, false)).toBe(MODELS.sonnet);
    expect(modelForImplement(1, false)).toBe(MODELS.sonnet);
    expect(modelForImplement(2, false)).toBe(MODELS.opus);
    expect(modelForImplement(0, true)).toBe(MODELS.opus);
  });
});
