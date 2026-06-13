import { loadConfig, targetRepos } from './config';
import { createLogger } from './log';
import { openDb } from './db/db';
import { tableNames } from './db/repos';

// M0 scaffold entrypoint: boots config + db and exits. The FSM scheduler is wired in M3+.
function main(): void {
  const cfg = loadConfig();
  const log = createLogger(cfg);
  const db = openDb(cfg.DB_PATH);
  log.info(
    {
      targetRepos: targetRepos(cfg),
      monthlyCapUsd: cfg.MONTHLY_SPEND_CAP_USD,
      dailyCapUsd: cfg.DAILY_SPEND_CAP_USD,
      tables: tableNames(db).length,
    },
    'AutoDev orchestrator booted (M0 scaffold, FSM not yet wired)',
  );
  db.close();
}

main();
