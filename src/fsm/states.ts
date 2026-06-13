export type State =
  | 'QUEUED'
  | 'PRE_GATE'
  | 'SPEC'
  | 'SPEC_APPROVAL'
  | 'SETUP'
  | 'TESTS_FIRST'
  | 'IMPLEMENT'
  | 'CODE_REVIEW'
  | 'CHALLENGE'
  | 'RED_TEAM'
  | 'SECURITY'
  | 'FINAL_REVIEW'
  | 'VALIDATE'
  | 'PR_READY'
  | 'DONE'
  | 'FAILED'
  | 'NEEDS_HUMAN'
  | 'REJECTED';

export type Outcome =
  | 'actionable'
  | 'reject'
  | 'ok'
  | 'approved'
  | 'rejected'
  | 'error'
  | 'red'
  | 'not-red'
  | 'gates-pass'
  | 'gates-fail'
  | 'approve'
  | 'bounce'
  | 'clean'
  | 'repro'
  | 'pass'
  | 'fail';

export const TERMINAL: readonly State[] = ['DONE', 'FAILED', 'NEEDS_HUMAN', 'REJECTED'];

export function isTerminal(s: State): boolean {
  return TERMINAL.includes(s);
}

// Pure transition table: the code owns the workflow; an agent's output only maps to an Outcome,
// never picks the next state. A bounce from any review stage routes back to IMPLEMENT.
export function nextState(state: State, outcome: Outcome): State {
  switch (state) {
    case 'QUEUED':
      return 'PRE_GATE';
    case 'PRE_GATE':
      return outcome === 'reject' ? 'REJECTED' : 'SPEC';
    case 'SPEC':
      return outcome === 'error' ? 'FAILED' : 'SPEC_APPROVAL';
    case 'SPEC_APPROVAL':
      return outcome === 'rejected' ? 'REJECTED' : 'SETUP';
    case 'SETUP':
      return outcome === 'error' ? 'FAILED' : 'TESTS_FIRST';
    case 'TESTS_FIRST':
      return outcome === 'red' ? 'IMPLEMENT' : 'NEEDS_HUMAN';
    case 'IMPLEMENT':
      return outcome === 'gates-pass' ? 'CODE_REVIEW' : 'IMPLEMENT';
    case 'CODE_REVIEW':
      return outcome === 'approve' ? 'CHALLENGE' : 'IMPLEMENT';
    case 'CHALLENGE':
      return outcome === 'clean' ? 'RED_TEAM' : 'IMPLEMENT';
    case 'RED_TEAM':
      return outcome === 'clean' ? 'SECURITY' : 'IMPLEMENT';
    case 'SECURITY':
      return outcome === 'clean' ? 'FINAL_REVIEW' : 'IMPLEMENT';
    case 'FINAL_REVIEW':
      return outcome === 'clean' ? 'VALIDATE' : 'IMPLEMENT';
    case 'VALIDATE':
      return outcome === 'pass' ? 'PR_READY' : 'IMPLEMENT';
    case 'PR_READY':
      return 'DONE';
    default:
      return state;
  }
}
