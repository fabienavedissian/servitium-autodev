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
