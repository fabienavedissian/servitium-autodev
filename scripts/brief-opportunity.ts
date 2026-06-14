/**
 * Runs the deep concrete investigation (one gated Opus pass) for ONE opportunity, on demand:
 *   node --max-old-space-size=512 dist/scripts/brief-opportunity.js <opportunityId>
 * Writes brief_md + max_prompt + deeper_prompt. Honors the intel sub-cap.
 */
import { loadConfig } from '../src/config';
import { openDb } from '../src/db/db';
import { loadSdk } from '../src/sdk/client';
import { Ledger } from '../src/cost/ledger';
import { briefOpportunityById } from '../src/intel/pipeline';

async function main(): Promise<void> {
  const id = Number(process.argv[2]);
  if (!id) {
    console.error('usage: brief-opportunity <opportunityId>');
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
  const res = await briefOpportunityById(
    { db, query: sdk.query, ledger, cfg, log: (m, d) => console.log('[brief]', m, d !== undefined ? JSON.stringify(d).slice(0, 200) : ''), onStage: (s, d) => console.log(`  [${s}] ${d}`) },
    id,
  );
  console.log('BRIEF', JSON.stringify(res));
  process.exit(res.ok ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('brief failed:', e);
  try {
    const id = Number(process.argv[2]);
    const db = openDb(loadConfig().DB_PATH);
    db.prepare("UPDATE opportunity SET brief_state='failed', detail=? WHERE id=? AND brief_state='running'").run('Investigation échouée - relance-la.', id);
  } catch {
    /* best-effort */
  }
  process.exit(1);
});
