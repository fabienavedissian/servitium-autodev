/**
 * Runs ONE code-analysis pass over a Servitium repo (rotating by day, or an explicit repo arg):
 *   node --max-old-space-size=512 dist/scripts/run-code-scan.js [repo]
 * Clones the repo, checks outdated deps, audits a rotating set of areas, upserts code opportunities.
 */
import { loadConfig } from '../src/config';
import { openDb } from '../src/db/db';
import { loadSdk } from '../src/sdk/client';
import { Ledger } from '../src/cost/ledger';
import { runCodeScan } from '../src/intel/code/scan';

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.ANTHROPIC_API_KEY || !cfg.GITHUB_PAT) {
    console.error('ANTHROPIC_API_KEY + GITHUB_PAT required for the code scan.');
    process.exit(1);
  }
  const db = openDb(cfg.DB_PATH);
  const sdk = await loadSdk();
  const ledger = new Ledger(db);
  const repo = process.argv[2];
  console.log('=== SIE code scan starting ===');
  const res = await runCodeScan(
    { db, query: sdk.query, ledger, cfg, log: (m, d) => console.log('[code]', m, d !== undefined ? JSON.stringify(d).slice(0, 200) : ''), onStage: (s, d) => console.log(`  [${s}] ${d}`) },
    repo,
  );
  console.log('\n=== CODE SCAN DONE ===');
  console.log(JSON.stringify(res, null, 1));
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('code scan failed:', e);
  process.exit(1);
});
