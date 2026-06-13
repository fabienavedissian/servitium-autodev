/**
 * Loads docs/api-audit.json (the ranked audit backlog) into the proposal table so the dashboard
 * shows it. Idempotent: skips if api-audit proposals already exist.
 * Run: node --env-file-if-exists=.env dist/scripts/seed-proposals.js [path/to/json]
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '../src/config';
import { openDb } from '../src/db/db';
import { bulkInsertProposals, type ProposalInput } from '../src/dashboard/proposals';

interface RankedTask {
  rank: number;
  title: string;
  category: string;
  module?: string;
  impact?: string;
  effort?: string;
  rationale?: string;
  acceptanceHint?: string;
}

function main(): void {
  const file = process.argv[2] ?? path.join(process.cwd(), 'docs', 'api-audit.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { rankedTasks: RankedTask[] };
  const cfg = loadConfig();
  const db = openDb(cfg.DB_PATH);

  const existing = db.prepare("SELECT COUNT(*) AS n FROM proposal WHERE source='api-audit'").get() as { n: number };
  if (existing.n > 0) {
    console.log(`api-audit proposals already seeded (${existing.n}); skipping.`);
    process.exit(0);
  }

  const items: ProposalInput[] = data.rankedTasks.map((t) => ({
    rank: t.rank,
    title: t.title,
    category: t.category,
    module: t.module,
    impact: t.impact,
    effort: t.effort,
    problem: t.rationale,
    acceptanceHint: t.acceptanceHint,
  }));
  const n = bulkInsertProposals(db, items, 'api-audit', new Date().toISOString());
  console.log(`seeded ${n} proposals from ${path.basename(file)}`);
  process.exit(0);
}

main();
