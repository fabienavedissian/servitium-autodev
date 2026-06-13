import { composePrTitle, composePrBody, type PrInput } from '../src/github/pr';

const base: PrInput = {
  issueNumber: 123,
  title: 'Reject non-positive quantities',
  branch: 'autodev/123',
  spec: 'Validate quantity > 0.',
  acceptanceCriteria: ['quantity=0 -> 400', 'quantity=1 -> ok'],
  gateMatrix: [
    { gate: 'tests-green', status: 'pass' },
    { gate: 'tsc', status: 'pass' },
  ],
  costUsd: 1.2345,
};

describe('composePrTitle/Body', () => {
  it('composes a titled, structured draft body', () => {
    expect(composePrTitle(base)).toBe('[autodev] Reject non-positive quantities (#123)');
    const { body, secretLeak } = composePrBody(base);
    expect(body).toContain('Closes #123.');
    expect(body).toContain('PASS tests-green');
    expect(body).toContain('quantity=0 -> 400');
    expect(body).toContain('$1.2345');
    expect(body).toContain('DRAFT only');
    expect(secretLeak).toBe(false);
  });

  it('flags a secret leak in the composed body', () => {
    const leaky = { ...base, spec: 'token sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA' };
    expect(composePrBody(leaky).secretLeak).toBe(true);
  });
});
