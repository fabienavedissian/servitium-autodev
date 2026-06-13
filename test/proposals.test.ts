import { openDb } from '../src/db/db';
import { bulkInsertProposals, listProposals, decideProposal, proposalCounts } from '../src/dashboard/proposals';

describe('proposals store', () => {
  it('bulk-inserts, lists by rank, decides, and counts', () => {
    const db = openDb(':memory:');
    const n = bulkInsertProposals(
      db,
      [
        { rank: 2, title: 'B', category: 'performance' },
        { rank: 1, title: 'A', category: 'security', impact: 'high' },
      ],
      'api-audit',
      '2026-06-13T10:00:00.000Z',
    );
    expect(n).toBe(2);
    const all = listProposals(db);
    expect(all.map((p) => p.title)).toEqual(['A', 'B']); // ordered by rank
    expect(proposalCounts(db).proposed).toBe(2);

    const id = all[0].id as number;
    decideProposal(db, id, 'approved', 'go', '2026-06-13T11:00:00.000Z');
    expect(proposalCounts(db).approved).toBe(1);
    expect(listProposals(db, 'approved')[0].title).toBe('A');
    db.close();
  });
});
