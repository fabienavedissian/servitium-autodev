import { canonicalizeUrl, normalizeTitle, signalDedupKey, dedupSignals, domainOf } from '../src/intel/sensing/dedup';

describe('canonicalizeUrl', () => {
  it('collapses tracking params, fragment, trailing slash, www, scheme', () => {
    const a = canonicalizeUrl('https://www.Example.com/Path/?utm_source=x&id=5#frag');
    const b = canonicalizeUrl('http://example.com/Path?id=5');
    expect(a).toBe(b);
  });
  it('keeps meaningful query params', () => {
    expect(canonicalizeUrl('https://e.com/a?id=5')).not.toBe(canonicalizeUrl('https://e.com/a?id=6'));
  });
  it('domainOf strips www', () => {
    expect(domainOf('https://www.reddit.com/r/rust')).toBe('reddit.com');
  });
});

describe('normalizeTitle', () => {
  it('is punctuation- and case-insensitive', () => {
    expect(normalizeTitle('Rust: Shop  via RCON!')).toBe(normalizeTitle('rust shop via rcon'));
  });
});

describe('signalDedupKey', () => {
  it('prefers the canonical URL when present', () => {
    expect(signalDedupKey('tech', 'A', 'https://x.com/p/')).toBe(signalDedupKey('tech', 'Different title', 'https://x.com/p'));
  });
  it('falls back to angle + normalized title without a URL', () => {
    expect(signalDedupKey('game', 'Rust Shop!')).toBe('t:game:rust shop');
    expect(signalDedupKey('game', 'Rust Shop')).not.toBe(signalDedupKey('tech', 'Rust Shop')); // angle-scoped
  });
});

describe('dedupSignals', () => {
  it('splits fresh vs already-known and collapses within-batch dups', () => {
    const known = new Set([signalDedupKey('tech', 'old', 'https://x.com/old')]);
    const items = [
      { angle: 'tech', title: 'old one', url: 'https://x.com/old' }, // known -> seen
      { angle: 'game', title: 'Rust shop', url: 'https://r.com/a' }, // fresh
      { angle: 'game', title: 'Rust shop', url: 'https://r.com/a' }, // within-batch dup -> seen
      { angle: 'game', title: 'Palworld admin' }, // fresh (title key)
    ];
    const { fresh, seen } = dedupSignals(items, known);
    expect(fresh.map((f) => f.title)).toEqual(['Rust shop', 'Palworld admin']);
    expect(seen).toHaveLength(2);
    expect(fresh[0].dedupKey).toMatch(/^url:/);
    expect(fresh[1].dedupKey).toMatch(/^t:game:/);
  });
});
