import type { Outcome } from './states';
import type { RoleName } from '../agents/roles';
import { parseJsonLoose } from '../util/json';

export interface ParsedOutcome {
  outcome: Outcome;
  data: Record<string, unknown>;
}

// Maps a review-role agent's structured JSON to a transition Outcome. Gate-driven states
// (TESTS_FIRST / IMPLEMENT) get their outcome from the deterministic gate matrix, not from here.
export function parseRoleOutcome(role: RoleName, text: string): ParsedOutcome {
  const data = parseJsonLoose<Record<string, unknown>>(text) ?? {};
  const decision = String(data.decision ?? '');
  switch (role) {
    case 'triage':
      return { outcome: data.actionable === true ? 'actionable' : 'reject', data };
    case 'spec':
      return { outcome: Array.isArray(data.allowedPaths) && (data.allowedPaths as unknown[]).length > 0 ? 'ok' : 'error', data };
    case 'review':
      return { outcome: decision === 'approve' ? 'approve' : 'bounce', data };
    case 'challenger':
      return { outcome: decision === 'clean' ? 'clean' : 'bounce', data };
    case 'redteam':
      return { outcome: decision === 'repro' ? 'repro' : 'clean', data };
    case 'security':
      return { outcome: decision === 'clean' ? 'clean' : 'bounce', data };
    case 'final':
      return { outcome: decision === 'clean' ? 'clean' : 'bounce', data };
    case 'validator':
      return { outcome: decision === 'pass' ? 'pass' : 'fail', data };
    default:
      return { outcome: 'ok', data };
  }
}
