import {
  parseDiffAddedLines,
  uncoveredLines,
  computeUncoveredChanged,
  type IstanbulCoverage,
} from '../src/gates/coverageDiff';

describe('parseDiffAddedLines', () => {
  it('extracts added line ranges per file', () => {
    const diff = [
      '--- a/src/shop/cart.ts',
      '+++ b/src/shop/cart.ts',
      '@@ -10,0 +11,2 @@',
      '+const a = 1;',
      '+const b = 2;',
    ].join('\n');
    const m = parseDiffAddedLines(diff);
    expect([...(m.get('src/shop/cart.ts') ?? [])]).toEqual([11, 12]);
  });
});

describe('uncoveredLines', () => {
  it('returns statement lines with zero hits', () => {
    const entry = {
      path: '/wt/src/shop/cart.ts',
      statementMap: { '0': { start: { line: 11 }, end: { line: 11 } }, '1': { start: { line: 12 }, end: { line: 12 } } },
      s: { '0': 1, '1': 0 },
    };
    expect([...uncoveredLines(entry)]).toEqual([12]);
  });
});

describe('computeUncoveredChanged', () => {
  const cov: IstanbulCoverage = {
    a: {
      path: '/wt/src/shop/cart.ts',
      statementMap: { '0': { start: { line: 11 }, end: { line: 11 } }, '1': { start: { line: 12 }, end: { line: 12 } } },
      s: { '0': 1, '1': 0 },
    },
  };

  it('flags a changed line that is not executed', () => {
    const changed = new Map([['src/shop/cart.ts', new Set([11, 12])]]);
    const out = computeUncoveredChanged(changed, cov, '/wt');
    expect(out).toEqual([{ file: 'src/shop/cart.ts', lines: [12] }]);
  });

  it('flags a changed source file absent from coverage entirely', () => {
    const changed = new Map([['src/shop/new.ts', new Set([1, 2])]]);
    const out = computeUncoveredChanged(changed, cov, '/wt');
    expect(out[0].file).toBe('src/shop/new.ts');
  });

  it('ignores spec files', () => {
    const changed = new Map([['src/shop/cart.spec.ts', new Set([1])]]);
    expect(computeUncoveredChanged(changed, cov, '/wt')).toEqual([]);
  });
});
