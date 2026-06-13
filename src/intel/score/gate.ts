import { FEATURE_KEYS, scoreOpportunity, type ScoreInput, type WeightSet, type ScoreResult } from './rubric';

// Token-free ranking gate. Total, stable tie-break so `rank` is a deterministic dense integer:
// score -> strategic_fit -> evidenceCoverage -> momentum -> effort_inv -> oldest first.
// Ranking is free, so a new signal or a weight tweak reshuffles the whole backlog instantly.

export interface Rankable {
  id: number;
  kind: string;
  createdAt: string; // ISO; oldest wins ties (stable)
  input: ScoreInput;
}

export interface Ranked extends Rankable {
  rank: number;
  result: ScoreResult;
}

export function rankOpportunities(items: Rankable[], ws?: WeightSet): Ranked[] {
  const scored = items.map((it) => ({ ...it, result: scoreOpportunity(it.input, ws), rank: 0 }));
  scored.sort((a, b) => {
    const d =
      b.result.score - a.result.score ||
      b.result.features.strategic_fit - a.result.features.strategic_fit ||
      b.result.evidenceCoverage - a.result.evidenceCoverage ||
      b.result.modifiers.momentum - a.result.modifiers.momentum ||
      b.result.features.effort_inv - a.result.features.effort_inv;
    if (d !== 0) return d;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1; // oldest first
    return a.id - b.id; // final total-order anchor
  });
  scored.forEach((s, i) => (s.rank = i + 1));
  return scored;
}

// Guard used by the dashboard/score-breakdown: the weights must sum to ~1 and cover the 8 axes.
export function weightsValid(ws: WeightSet): boolean {
  const keys = Object.keys(ws.weights);
  if (keys.length !== FEATURE_KEYS.length || !FEATURE_KEYS.every((k) => k in ws.weights)) return false;
  const sum = FEATURE_KEYS.reduce((s, k) => s + ws.weights[k], 0);
  return Math.abs(sum - 1) < 1e-6;
}
