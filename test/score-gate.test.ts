import { scoreOpportunity, tierForScore, FEATURE_KEYS, DEFAULT_WEIGHTS, type Features, type FeatureKey } from '../src/intel/score/rubric';
import { rankOpportunities, weightsValid, type Rankable } from '../src/intel/score/gate';

const ALL = (v: number): Features => Object.fromEntries(FEATURE_KEYS.map((k) => [k, v])) as Features;
const EV = (v: number): Record<FeatureKey, number> => Object.fromEntries(FEATURE_KEYS.map((k) => [k, v])) as Record<FeatureKey, number>;

describe('weights', () => {
  it('v0 baseline weights are valid (8 axes, sum to 1)', () => {
    expect(weightsValid(DEFAULT_WEIGHTS)).toBe(true);
  });
});

describe('scoreOpportunity', () => {
  it('a fully-evidenced perfect opportunity scores ~100', () => {
    const r = scoreOpportunity({ features: ALL(1), evidenceCount: EV(2), signalCount: 1, daysSinceLastSignal: 0 });
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('claiming everything = 1 with NO evidence is gutted (evidence cap + low confidence)', () => {
    const r = scoreOpportunity({ features: ALL(1), evidenceCount: EV(0), signalCount: 1 });
    for (const k of FEATURE_KEYS) expect(r.features[k]).toBeLessThanOrEqual(0.3); // each axis capped
    expect(r.score).toBeLessThan(20); // gaming the features doesn't work
  });

  it('evidence makes the same claim score strictly higher', () => {
    const withEv = scoreOpportunity({ features: ALL(0.8), evidenceCount: EV(1), signalCount: 1 }).score;
    const noEv = scoreOpportunity({ features: ALL(0.8), evidenceCount: EV(0), signalCount: 1 }).score;
    expect(withEv).toBeGreaterThan(noEv);
  });

  it('fit-guard halves an off-mission opportunity', () => {
    const r = scoreOpportunity({ features: { ...ALL(0.8), strategic_fit: 0.3 }, evidenceCount: EV(1) });
    expect(r.modifiers.fitGuard).toBe(0.5);
  });

  it('feasibility floor down-weights the unbuildable', () => {
    const r = scoreOpportunity({ features: { ...ALL(0.8), feasibility: 0.2 }, evidenceCount: EV(1) });
    expect(r.modifiers.feasibilityFloor).toBe(0.6);
  });

  it('momentum rises with corroborating signals but is capped', () => {
    const one = scoreOpportunity({ features: ALL(0.7), evidenceCount: EV(1), signalCount: 1 }).modifiers.momentum;
    const many = scoreOpportunity({ features: ALL(0.7), evidenceCount: EV(1), signalCount: 50 }).modifiers.momentum;
    expect(many).toBeGreaterThan(one);
    expect(many).toBeLessThanOrEqual(15);
  });

  it('recency decay sinks a stale opportunity', () => {
    const fresh = scoreOpportunity({ features: ALL(0.8), evidenceCount: EV(1), daysSinceLastSignal: 0 }).score;
    const stale = scoreOpportunity({ features: ALL(0.8), evidenceCount: EV(1), daysSinceLastSignal: 60 }).score;
    expect(stale).toBeLessThan(fresh);
  });

  it('always returns a 0..100 integer', () => {
    const r = scoreOpportunity({ features: ALL(0.5) });
    expect(Number.isInteger(r.score)).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe('tierForScore', () => {
  it('classifies by threshold and flags flagships', () => {
    expect(tierForScore(90, 'game')).toEqual({ disposition: 'shown', status: 'proposed', flagship: true });
    expect(tierForScore(90, 'feature').flagship).toBe(false); // flagship only for game/business
    expect(tierForScore(70, 'feature')).toEqual({ disposition: 'shown', status: 'proposed', flagship: false });
    expect(tierForScore(50, 'feature').status).toBe('parked');
    expect(tierForScore(30, 'feature').status).toBe('archived');
  });
});

describe('rankOpportunities', () => {
  it('produces dense ranks ordered by score, higher first', () => {
    const items: Rankable[] = [
      { id: 1, kind: 'feature', createdAt: '2026-06-01T00:00:00Z', input: { features: ALL(0.4), evidenceCount: EV(1) } },
      { id: 2, kind: 'game', createdAt: '2026-06-01T00:00:00Z', input: { features: ALL(0.9), evidenceCount: EV(2) } },
      { id: 3, kind: 'feature', createdAt: '2026-06-01T00:00:00Z', input: { features: ALL(0.6), evidenceCount: EV(1) } },
    ];
    const ranked = rankOpportunities(items);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranked[0].id).toBe(2); // highest score first
    expect(ranked[0].result.score).toBeGreaterThan(ranked[1].result.score);
  });

  it('breaks exact ties deterministically (oldest, then lowest id)', () => {
    const mk = (id: number, createdAt: string): Rankable => ({ id, kind: 'feature', createdAt, input: { features: ALL(0.7), evidenceCount: EV(1) } });
    const a = rankOpportunities([mk(5, '2026-06-02T00:00:00Z'), mk(9, '2026-06-01T00:00:00Z')]);
    expect(a[0].id).toBe(9); // older wins the tie
    const b = rankOpportunities([mk(9, '2026-06-01T00:00:00Z'), mk(5, '2026-06-01T00:00:00Z')]);
    expect(b[0].id).toBe(5); // same date -> lowest id
  });
});
