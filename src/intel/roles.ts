import { MODELS, type EffortLevel } from '../agents/roles';

// SIE role routing, parallel to agents/roles.ts ROLES. Every call goes through the SAME runRole()
// (same usage/cost capture -> Ledger, scope 'intel'). Opus appears once per deep brief, gated to
// SIE_BRIEF_TOP_N and to owner-greenlit opportunities. Haiku is the firehose, Sonnet the workhorse.
export interface SieRoleConfig {
  model: string;
  effort: EffortLevel;
  maxTurns: number;
}

export type SieRoleName = 'harvest' | 'extract' | 'ideator' | 'scorer' | 'feasibility' | 'promptsmith' | 'critic';

export const SIE_ROLES: Record<SieRoleName, SieRoleConfig> = {
  harvest: { model: MODELS.haiku, effort: 'low', maxTurns: 6 }, // WebSearch one batch/angle
  extract: { model: MODELS.haiku, effort: 'low', maxTurns: 5 }, // page text -> structured signal
  ideator: { model: MODELS.sonnet, effort: 'medium', maxTurns: 6 }, // signals -> candidate opportunities
  scorer: { model: MODELS.sonnet, effort: 'medium', maxTurns: 4 }, // emit the 8 features (no score)
  feasibility: { model: MODELS.opus, effort: 'high', maxTurns: 10 }, // deep concrete brief, gated to greenlit
  promptsmith: { model: MODELS.sonnet, effort: 'high', maxTurns: 8 }, // fill the Max prompt template
  critic: { model: MODELS.sonnet, effort: 'medium', maxTurns: 6 }, // one validation bounce on the prompt
};
