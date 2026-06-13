// EffortLevel mirrors the SDK's type (low|medium|high|xhigh|max) without importing the ESM module.
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type RoleName =
  | 'triage'
  | 'spec'
  | 'tdd'
  | 'implement'
  | 'review'
  | 'challenger'
  | 'redteam'
  | 'security'
  | 'final'
  | 'validator';

export interface RoleConfig {
  name: RoleName;
  model: string;
  effort: EffortLevel;
  maxTurns: number;
}

export const MODELS = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
} as const;

// Cost spine: Sonnet default, Opus only for the two adversarial roles, Haiku for triage.
export const ROLES: Record<RoleName, RoleConfig> = {
  triage: { name: 'triage', model: MODELS.haiku, effort: 'low', maxTurns: 5 },
  spec: { name: 'spec', model: MODELS.sonnet, effort: 'medium', maxTurns: 12 },
  tdd: { name: 'tdd', model: MODELS.sonnet, effort: 'medium', maxTurns: 30 },
  implement: { name: 'implement', model: MODELS.sonnet, effort: 'high', maxTurns: 45 },
  review: { name: 'review', model: MODELS.sonnet, effort: 'high', maxTurns: 14 },
  challenger: { name: 'challenger', model: MODELS.opus, effort: 'xhigh', maxTurns: 22 },
  redteam: { name: 'redteam', model: MODELS.opus, effort: 'high', maxTurns: 22 },
  security: { name: 'security', model: MODELS.sonnet, effort: 'high', maxTurns: 16 },
  final: { name: 'final', model: MODELS.sonnet, effort: 'high', maxTurns: 14 },
  validator: { name: 'validator', model: MODELS.sonnet, effort: 'medium', maxTurns: 10 },
};

// Implement escalates to Opus only when cost-justified: a `hard` task or repeated Sonnet failures.
export function modelForImplement(attempt: number, hard: boolean): string {
  return hard || attempt >= 2 ? MODELS.opus : MODELS.sonnet;
}

export type Tier = 'trivial' | 'standard' | 'complex';

// Proportional rigor: the adversarial depth (Opus passes) scales with task size/risk so a one-line
// fix is not billed two deep Opus audits. A code-side keyword backstop FORCES full rigor on anything
// security-relevant even if the triage LLM under-rates it — we never trade safety for cost there.
const SENSITIVE_RE =
  /(auth|login|logout|password|secret|credential|token|session|jwt|oauth|crypto|encrypt|sign|payment|billing|paypal|stripe|webhook|permission|\brole\b|guard|ddos|whitelist|firewall|\badmin\b|csrf|cors|sql|injection|sanitiz)/i;

export function isSensitive(title: string, paths: string[]): boolean {
  return SENSITIVE_RE.test(title) || paths.some((p) => SENSITIVE_RE.test(p));
}

export interface RigorPlan {
  full: boolean; // full = both Opus adversarial passes; lean = one Sonnet pass, no red team
  challengerModel: string;
  challengerEffort: EffortLevel;
  runRedTeam: boolean;
  redteamModel: string;
}

export function rigorPlan(tier: Tier | undefined, sensitive: boolean): RigorPlan {
  const full = sensitive || tier === 'complex';
  return full
    ? { full, challengerModel: MODELS.opus, challengerEffort: 'xhigh', runRedTeam: true, redteamModel: MODELS.opus }
    : { full, challengerModel: MODELS.sonnet, challengerEffort: 'high', runRedTeam: false, redteamModel: MODELS.sonnet };
}
