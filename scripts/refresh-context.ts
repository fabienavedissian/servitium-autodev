/**
 * Weekly auto-refresh of the grounding dossier from the real CLAUDE.md + repo READMEs + structure:
 *   node --env-file-if-exists=.env dist/scripts/refresh-context.js
 */
import { loadConfig } from '../src/config';
import { openDb } from '../src/db/db';
import { loadSdk } from '../src/sdk/client';
import { Ledger } from '../src/cost/ledger';
import { refreshDossier } from '../src/intel/kb/refresh';

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.ANTHROPIC_API_KEY || !cfg.GITHUB_PAT) {
    console.error('ANTHROPIC_API_KEY + GITHUB_PAT required.');
    process.exit(1);
  }
  const db = openDb(cfg.DB_PATH);
  const sdk = await loadSdk();
  const ledger = new Ledger(db);
  const res = await refreshDossier({ db, query: sdk.query, ledger, cfg, log: (m, d) => console.log('[dossier]', m, d !== undefined ? JSON.stringify(d).slice(0, 200) : '') });
  console.log('REFRESH', JSON.stringify(res));
  process.exit(res.ok ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('refresh failed:', e);
  process.exit(1);
});
