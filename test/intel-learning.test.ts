import { openDb } from '../src/db/db';
import { recomputeKindBias, getKindBias } from '../src/intel/learning';
import { scoreOpportunity, FEATURE_KEYS, type Features, type FeatureKey } from '../src/intel/score/rubric';

const ALL = (v: number): Features => Object.fromEntries(FEATURE_KEYS.map((k) => [k, v])) as Features;
const EV = (v: number): Record<FeatureKey, number> => Object.fromEntries(FEATURE_KEYS.map((k) => [k, v])) as Record<FeatureKey, number>;

describe('learning loop (per-kind ranking bias)', () => {
  it('validated kinds get a positive bias, rejected negative, clamped to +/-0.08', () => {
    const db = openDb(':memory:');
    const at = '2026-06-14T00:00:00Z';
    const ins = db.prepare('INSERT INTO opportunity (kind, angle, dedup_key, title, status, first_seen_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)');
    for (let i = 0; i < 5; i++) ins.run('game', 'x', 'g' + i, 'g' + i, 'greenlit', at, at, at);
    for (let i = 0; i < 4; i++) ins.run('refactor', 'x', 'r' + i, 'r' + i, 'rejected', at, at, at);
    const bias = recomputeKindBias(db, at);
    expect(bias.game).toBeGreaterThan(0);
    expect(bias.refactor).toBeLessThan(0);
    expect(bias.game).toBeLessThanOrEqual(0.08);
    expect(bias.refactor).toBeGreaterThanOrEqual(-0.08);
    expect(getKindBias(db).game).toBe(bias.game);
    db.close();
  });

  it('the learned bias raises the score (validated) and lowers it (rejected)', () => {
    const baseInput = { features: ALL(0.7), evidenceCount: EV(1), signalCount: 1 };
    const neutral = scoreOpportunity(baseInput).score;
    const boosted = scoreOpportunity({ ...baseInput, categoryBias: 0.08 }).score;
    const dropped = scoreOpportunity({ ...baseInput, categoryBias: -0.08 }).score;
    expect(boosted).toBeGreaterThan(neutral);
    expect(dropped).toBeLessThan(neutral);
  });
});
