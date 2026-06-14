// Phase 0 grounding: the "what Servitium is" blob anchoring every sensing/scoring/feasibility/brief
// prompt, so opportunities map onto the REAL product (not a generic SaaS) and the ideator never
// re-proposes shipped features. Sourced from the exhaustive service-by-service audit corpus
// (docs/engine-context-corpus, generated into ./generatedContext). Phase 1 (kb/refresh.ts) will
// auto-refresh this from CLAUDE.md / READMEs; until then re-run scripts/gen-context.js after an audit.
import { IMPROVED_DOSSIER } from './generatedContext';

export const SERVITIUM_DOSSIER = IMPROVED_DOSSIER;

// The ACTIVE dossier: the auto-refreshed version (from CLAUDE.md + READMEs) when present, else the
// hand-seeded constant. The pipeline sets it at run start so every prompt stays current.
let activeDossier = SERVITIUM_DOSSIER;
export function getActiveDossier(): string {
  return activeDossier;
}
export function setActiveDossier(d: string | null | undefined): void {
  activeDossier = d && d.trim().length > 100 ? d : SERVITIUM_DOSSIER;
}
