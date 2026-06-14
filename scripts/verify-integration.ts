/**
 * Audits the SHIPPED code for ONE opportunity against its brief's acceptance criteria, on demand:
 *   node --max-old-space-size=2048 dist/scripts/verify-integration.js <opportunityId>
 * Writes integration_score + integration_md (FR) + integration_prompt (EN finishing prompt). Honors the intel sub-cap.
 */
import { loadConfig } from '../src/config';
import { openDb } from '../src/db/db';
import { loadSdk } from '../src/sdk/client';
import { Ledger } from '../src/cost/ledger';
import { runVerifyIntegration } from '../src/intel/verify';

async function main(): Promise<void> {
  const id = Number(process.argv[2]);
  if (!id) {
    console.error('usage: verify-integration <opportunityId>');
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
  const res = await runVerifyIntegration({ db, query: sdk.query, ledger, cfg, log: (m, d) => console.log('[verify]', m, d !== undefined ? JSON.stringify(d).slice(0, 200) : '') }, id);
  console.log('VERIFY', JSON.stringify(res));
  process.exit(res.ok ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('verify failed:', e);
  try {
    const id = Number(process.argv[2]);
    const db = openDb(loadConfig().DB_PATH);
    db.prepare("UPDATE opportunity SET integration_state='failed', integration_detail=? WHERE id=? AND integration_state='verifying'").run('Vérification échouée — relance-la.', id);
  } catch {
    /* best-effort */
  }
  process.exit(1);
});
