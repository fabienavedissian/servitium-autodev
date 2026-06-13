import { scanSecret } from '../util/secretScan';

export interface PrInput {
  issueNumber: number;
  title: string;
  branch: string;
  spec?: string;
  acceptanceCriteria?: string[];
  gateMatrix: { gate: string; status: 'pass' | 'fail' }[];
  costUsd: number;
  redTeamNotes?: string[];
  runUrl?: string;
}

export function composePrTitle(input: PrInput): string {
  return `[autodev] ${input.title} (#${input.issueNumber})`;
}

// The host composes the PR body from structured fields; the agent never writes it directly.
// Returns secretLeak=true if the composed body trips the outbound secret scanner (then DO NOT send).
export function composePrBody(input: PrInput): { body: string; secretLeak: boolean } {
  const matrix = input.gateMatrix.map((g) => `- ${g.status === 'pass' ? 'PASS' : 'FAIL'} ${g.gate}`).join('\n');
  const accept = (input.acceptanceCriteria ?? []).map((a) => `- ${a}`).join('\n');
  const rt = (input.redTeamNotes ?? []).map((n) => `- ${n}`).join('\n');
  const body = [
    `Closes #${input.issueNumber}.`,
    '',
    '## Spec',
    input.spec ?? '(none)',
    '',
    '## Acceptance criteria',
    accept || '(none)',
    '',
    '## Gate matrix',
    matrix || '(none)',
    '',
    '## Red-team',
    rt || 'nothing found (or repros locked as regression tests)',
    '',
    '## Cost',
    `$${input.costUsd.toFixed(4)}`,
    input.runUrl ? `\n[run details](${input.runUrl})` : '',
    '',
    '> Prepared by AutoDev. DRAFT only: review and merge manually. AutoDev never merges or deploys.',
  ].join('\n');
  return { body, secretLeak: scanSecret(body).found };
}
