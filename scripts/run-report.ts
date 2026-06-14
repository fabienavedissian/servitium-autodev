/**
 * Runs a deep research report (compte-rendu) for one report row:
 *   node --max-old-space-size=2048 dist/scripts/run-report.js <reportId>
 */
import { loadConfig } from '../src/config';
import { openDb } from '../src/db/db';
import { loadSdk } from '../src/sdk/client';
import { Ledger } from '../src/cost/ledger';
import { runReportById } from '../src/intel/report';

async function main(): Promise<void> {
  const id = Number(process.argv[2]);
  if (!id) {
    console.error('usage: run-report <reportId>');
    process.exit(1);
  }
  const cfg = loadConfig();
  if (!cfg.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY required');
    process.exit(1);
  }
  const db = openDb(cfg.DB_PATH);
  const sdk = await loadSdk();
  const ledger = new Ledger(db);
  const res = await runReportById({ db, query: sdk.query, ledger, cfg, onStage: (s, d) => console.log(`  [${s}] ${d ?? ''}`) }, id);
  console.log('REPORT', JSON.stringify(res));
  process.exit(res.ok ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('report failed:', e);
  try {
    const db = openDb(loadConfig().DB_PATH);
    db.prepare("UPDATE report SET state='failed', detail=? WHERE id=? AND state='running'").run('Recherche échouée - réessaie.', Number(process.argv[2]));
  } catch {
    /* best-effort */
  }
  process.exit(1);
});
