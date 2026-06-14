// The scoring spine. The agent EXTRACTS 8 features in [0,1]; CODE computes the 0..100 score.
// Every past opportunity is replayable against any weight set for free -> ranking is deterministic
// and auditable, never an LLM vibe. Re-ranking on a new signal / weight tweak is token-free.

export type FeatureKey =
  | 'strategic_fit'
  | 'demand_evidence'
  | 'feasibility'
  | 'effort_inv'
  | 'revenue_proximity'
  | 'moat_or_diff'
  | 'reversibility'
  | 'freshness';

export const FEATURE_KEYS: FeatureKey[] = [
  'strategic_fit',
  'demand_evidence',
  'feasibility',
  'effort_inv',
  'revenue_proximity',
  'moat_or_diff',
  'reversibility',
  'freshness',
];

export type Features = Record<FeatureKey, number>;

export interface WeightSet {
  version: number;
  weights: Record<FeatureKey, number>;
}

// v0 baseline. Mutated only by the (future) learning loop or manual dashboard tuning, never an agent.
export const DEFAULT_WEIGHTS: WeightSet = {
  version: 0,
  weights: {
    strategic_fit: 0.22,
    demand_evidence: 0.2,
    feasibility: 0.16,
    effort_inv: 0.12,
    revenue_proximity: 0.12,
    moat_or_diff: 0.08,
    reversibility: 0.06,
    freshness: 0.04,
  },
};

export interface ScoreInput {
  features: Partial<Features>;
  evidenceCount?: Partial<Record<FeatureKey, number>>; // # cited sources per axis
  signalCount?: number; // corroborating signals
  daysSinceLastSignal?: number;
  categoryBias?: number; // learned per-kind bias (validated kinds rise, rejected fall), clamped
}

export interface ScoreResult {
  score: number; // 0..100, rounded
  base: number; // pre-modifier weighted sum (0..100)
  features: Features; // clamped + evidence-capped
  evidenceCoverage: number; // axes-with-evidence / 8
  modifiers: { confidence: number; momentum: number; recency: number; fitGuard: number; feasibilityFloor: number; learnedBias: number };
}

export function clamp01(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Composite = 100 * Σ wᵢ·featureᵢ, then deterministic clamped modifiers. An axis with NO cited
// evidence is capped at 0.3 (kills score-gaming at the source).
export function scoreOpportunity(input: ScoreInput, ws: WeightSet = DEFAULT_WEIGHTS): ScoreResult {
  const evidence = input.evidenceCount ?? {};
  const f = {} as Features;
  let axesWithEvidence = 0;
  for (const k of FEATURE_KEYS) {
    let v = clamp01(input.features[k]);
    const hasEvidence = (evidence[k] ?? 0) > 0;
    if (!hasEvidence) v = Math.min(v, 0.3);
    else axesWithEvidence += 1;
    f[k] = v;
  }
  const evidenceCoverage = axesWithEvidence / FEATURE_KEYS.length;

  let base = 100 * FEATURE_KEYS.reduce((s, k) => s + ws.weights[k] * f[k], 0);

  const confidence = 0.6 + 0.4 * evidenceCoverage;
  const momentum = Math.min(15, 1.5 * Math.log(1 + Math.max(0, input.signalCount ?? 1)));
  const recency = Math.exp(-Math.max(0, input.daysSinceLastSignal ?? 0) / 30);
  const fitGuard = f.strategic_fit <= 0.3 ? 0.5 : 1;
  const feasibilityFloor = f.feasibility <= 0.2 ? 0.6 : 1;
  const learnedBias = 100 * Math.max(-0.08, Math.min(0.08, input.categoryBias ?? 0));

  base = base * confidence;
  base = base + momentum;
  base = base * recency;
  base = base * fitGuard;
  base = base * feasibilityFloor;
  base = base + learnedBias; // owner preference: validated kinds rise, rejected fall

  const score = Math.round(Math.max(0, Math.min(100, base)));
  return {
    score,
    base: Math.round(base * 100) / 100,
    features: f,
    evidenceCoverage,
    modifiers: { confidence, momentum, recency, fitGuard, feasibilityFloor, learnedBias },
  };
}

export type Disposition = 'shown' | 'parked' | 'archived';

export interface Tiered {
  disposition: Disposition;
  status: 'proposed' | 'parked' | 'archived';
  flagship: boolean;
}

// Thresholds: >=65 shown, [40,65) parked, <40 archived. >=85 + game/business => flagship.
export function tierForScore(score: number, kind: string): Tiered {
  const flagship = score >= 85 && (kind === 'game' || kind === 'business');
  if (score >= 65) return { disposition: 'shown', status: 'proposed', flagship };
  if (score >= 40) return { disposition: 'parked', status: 'parked', flagship: false };
  return { disposition: 'archived', status: 'archived', flagship: false };
}
