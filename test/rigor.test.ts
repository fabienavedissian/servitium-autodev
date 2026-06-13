import { isSensitive, rigorPlan } from '../src/agents/roles';

describe('isSensitive (cost/rigor backstop)', () => {
  it('flags security keywords in the title', () => {
    expect(isSensitive('Add login rate limit', [])).toBe(true);
    expect(isSensitive('Refactor PayPal webhook', [])).toBe(true);
    expect(isSensitive('Strip @Public from DDoS whitelist', [])).toBe(true);
  });
  it('flags sensitive paths even with a neutral title', () => {
    expect(isSensitive('tidy', ['src/auth/**'])).toBe(true);
    expect(isSensitive('tidy', ['src/payments/paypal.service.ts'])).toBe(true);
  });
  it('does not flag a plain cosmetic change', () => {
    expect(isSensitive('Fix typo in dashboard footer', ['src/dashboard/footer.ts'])).toBe(false);
  });
});

describe('rigorPlan', () => {
  it('lean for a trivial non-sensitive task: one Sonnet pass, no red team', () => {
    const p = rigorPlan('trivial', false);
    expect(p.full).toBe(false);
    expect(p.runRedTeam).toBe(false);
    expect(p.challengerModel).toContain('sonnet');
  });
  it('full for a complex task', () => {
    const p = rigorPlan('complex', false);
    expect(p.full).toBe(true);
    expect(p.runRedTeam).toBe(true);
    expect(p.challengerModel).toContain('opus');
  });
  it('full for a sensitive task regardless of tier (safety never traded for cost)', () => {
    const p = rigorPlan('trivial', true);
    expect(p.full).toBe(true);
    expect(p.runRedTeam).toBe(true);
    expect(p.redteamModel).toContain('opus');
  });
});
