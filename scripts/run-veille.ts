/**
 * Runs ONE intelligence-engine veille pass now (the dashboard "run now" / manual trigger):
 *   node --env-file-if-exists=.env dist/scripts/run-veille.js
 * Spends the intel budget scope. Honors the intel sub-cap; once-per-UTC-day guard unless --force.
 */
import { loadConfig } from '../src/config';
import { openDb } from '../src/db/db';
import { loadSdk } from '../src/sdk/client';
import { Ledger } from '../src/cost/ledger';
import { runVeille } from '../src/intel/pipeline';

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY required for the veille.');
    process.exit(1);
  }
  const db = openDb(cfg.DB_PATH);
  const sdk = await loadSdk();
  const ledger = new Ledger(db);

  if (process.argv.includes('--force')) {
    // Free today's once-per-day slot WITHOUT deleting (signals FK-reference the run): rename prior
    // runs of today so a fresh run can start. Earlier the DELETE skipped 'done' runs, so a manual
    // re-run after the day's first run silently did nothing.
    const today = new Date().toISOString().slice(0, 10);
    db.prepare("UPDATE sie_run SET run_date = run_date || '#' || id WHERE run_date = ? AND status != 'running'").run(today);
  }

  console.log('=== SIE veille starting ===');
  const summary = await runVeille({
    db,
    query: sdk.query,
    ledger,
    cfg,
    log: (m, d) => console.log('[veille]', m, d !== undefined ? JSON.stringify(d).slice(0, 200) : ''),
    onStage: (s, d) => console.log(`  [${s}] ${d}`),
  });
  console.log('\n=== VEILLE DONE ===');
  console.log(JSON.stringify(summary, null, 1));
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('veille failed:', e);
  process.exit(1);
});
