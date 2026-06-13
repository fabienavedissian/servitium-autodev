import { costUsd } from '../src/cost/prices';

describe('costUsd', () => {
  it('prices opus input and output per MTok', () => {
    expect(costUsd('claude-opus-4-8', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(5);
    expect(costUsd('claude-opus-4-8', { input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(25);
  });

  it('prices cache reads cheaply', () => {
    expect(
      costUsd('claude-sonnet-4-6', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }),
    ).toBeCloseTo(0.3);
  });

  it('throws on an unknown model', () => {
    expect(() => costUsd('gpt-4', { input_tokens: 1, output_tokens: 1 })).toThrow(/Unknown model/);
  });
});
