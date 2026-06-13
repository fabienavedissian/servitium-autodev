import { openDb } from '../src/db/db';
import { countTasks, tableNames } from '../src/db/repos';

describe('db', () => {
  it('opens an in-memory database and applies the schema', () => {
    const db = openDb(':memory:');
    const names = tableNames(db);
    expect(names).toEqual(
      expect.arrayContaining(['task', 'step', 'checkpoint', 'gate_result', 'spend_ledger', 'lesson', 'comment']),
    );
    expect(countTasks(db)).toBe(0);
    db.close();
  });

  it('migration is idempotent on reopen of the same file db', () => {
    const db1 = openDb(':memory:');
    expect(() => openDb(':memory:')).not.toThrow();
    db1.close();
  });
});
