import { openDb } from '../src/db/db';
import { Ledger } from '../src/cost/ledger';

describe('Ledger', () => {
  it('records spend and rolls up daily vs monthly', () => {
    const db = openDb(':memory:');
    const l = new Ledger(db);
    l.record('claude-haiku-4-5', { input_tokens: 1_000_000, output_tokens: 0 }, { at: '2026-06-13T10:00:00.000Z' }); // $1
    l.record('claude-sonnet-4-6', { input_tokens: 1_000_000, output_tokens: 0 }, { at: '2026-06-13T11:00:00.000Z' }); // $3
    l.record('claude-haiku-4-5', { input_tokens: 1_000_000, output_tokens: 0 }, { at: '2026-06-12T10:00:00.000Z' }); // prev day $1
    const now = new Date('2026-06-13T12:00:00.000Z');
    expect(l.dailyUsd(now)).toBeCloseTo(4);
    expect(l.monthlyUsd(now)).toBeCloseTo(5);
    db.close();
  });

  it('pauses when the monthly cap is reached', () => {
    const db = openDb(':memory:');
    const l = new Ledger(db);
    l.record('claude-opus-4-8', { input_tokens: 0, output_tokens: 4_000_000 }, { at: '2026-06-13T10:00:00.000Z' }); // $100
    const s = l.status({ dailyUsd: 10, monthlyUsd: 100 }, new Date('2026-06-13T12:00:00.000Z'));
    expect(s.paused).toBe(true);
    expect(s.reason).toMatch(/monthly/);
    db.close();
  });

  it('pauses on the daily cap below the monthly cap', () => {
    const db = openDb(':memory:');
    const l = new Ledger(db);
    l.record('claude-sonnet-4-6', { input_tokens: 0, output_tokens: 1_000_000 }, { at: '2026-06-13T10:00:00.000Z' }); // $15
    const s = l.status({ dailyUsd: 10, monthlyUsd: 100 }, new Date('2026-06-13T12:00:00.000Z'));
    expect(s.paused).toBe(true);
    expect(s.reason).toMatch(/daily/);
    db.close();
  });
});
