import type { DB } from '../db/db';

export interface ProposalInput {
  rank?: number;
  title: string;
  category: string;
  module?: string;
  problem?: string;
  solution?: string;
  impact?: string;
  effort?: string;
  rationale?: string;
  acceptanceHint?: string;
}

export type ProposalStatus = 'proposed' | 'approved' | 'rejected' | 'queued' | 'done';

export function bulkInsertProposals(db: DB, items: ProposalInput[], source: string, at: string): number {
  const stmt = db.prepare(
    `INSERT INTO proposal (rank,title,category,module,problem,solution,impact,effort,rationale,acceptance_hint,source,status,created_at)
     VALUES (@rank,@title,@category,@module,@problem,@solution,@impact,@effort,@rationale,@acceptance_hint,@source,'proposed',@created_at)`,
  );
  const rows = items.map((p) => ({
    rank: p.rank ?? null,
    title: p.title,
    category: p.category,
    module: p.module ?? null,
    problem: p.problem ?? null,
    solution: p.solution ?? null,
    impact: p.impact ?? null,
    effort: p.effort ?? null,
    rationale: p.rationale ?? null,
    acceptance_hint: p.acceptanceHint ?? null,
    source,
    created_at: at,
  }));
  const tx = db.transaction((batch: typeof rows) => {
    for (const r of batch) stmt.run(r);
  });
  tx(rows);
  return rows.length;
}

export function listProposals(db: DB, status?: string): Record<string, unknown>[] {
  const sql = `SELECT * FROM proposal ${status ? 'WHERE status=?' : ''} ORDER BY (rank IS NULL), rank, id`;
  const stmt = db.prepare(sql);
  return (status ? stmt.all(status) : stmt.all()) as Record<string, unknown>[];
}

export function decideProposal(db: DB, id: number, status: ProposalStatus, comment: string | null, at: string): void {
  db.prepare('UPDATE proposal SET status=?, comment=?, decided_at=? WHERE id=?').run(status, comment, at, id);
}

export function proposalCounts(db: DB): Record<string, number> {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM proposal GROUP BY status').all() as { status: string; n: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.n;
  return out;
}
