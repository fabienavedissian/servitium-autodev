import { relevanceGate } from '../src/gates/relevance';
import { FakeRunner, result } from './helpers/fakeRunner';
import type { GateContext } from '../src/gates/index';

// Scripts the git + jest calls so the revert-and-rerun decision is tested without a real repo.
function scripted(jestExit: number): FakeRunner {
  return new FakeRunner((command, args) => {
    if (command === 'git' && args[0] === 'diff') {
      return result({ stdout: 'src/shop/cart.ts\nsrc/shop/cart.spec.ts\n' });
    }
    if (command === 'git' && args[0] === 'worktree') return result({ exitCode: 0 });
    if (command === 'git' && args[0] === 'checkout') return result({ exitCode: 0 });
    if (command === 'npx' && args[0] === 'jest') return result({ exitCode: jestExit });
    return result({ exitCode: 0 });
  });
}

const ctx = (runner: FakeRunner): GateContext => ({
  worktreeRoot: '/wt/task',
  runner,
  allowedPaths: ['src/shop/**'],
  baseRef: 'BASE',
  specFiles: ['src/shop/cart.spec.ts'],
});

describe('relevance gate', () => {
  it('passes when specs FAIL after the production diff is reverted', () => {
    expect(relevanceGate.run(ctx(scripted(1))).status).toBe('pass');
  });

  it('fails when specs still pass with the implementation reverted', () => {
    expect(relevanceGate.run(ctx(scripted(0))).status).toBe('fail');
  });

  it('fails when there are no specs to verify', () => {
    const c = { ...ctx(scripted(1)), specFiles: [] };
    expect(relevanceGate.run(c).status).toBe('fail');
  });
});
