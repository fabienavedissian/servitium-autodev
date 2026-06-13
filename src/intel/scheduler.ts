import type { DB } from '../db/db';
import type { Config } from '../config';
import type { Ledger } from '../cost/ledger';
import type { QueryFn } from '../agents/run';
import { runVeille, type VeilleSummary } from './pipeline';

export interface SchedulerDeps {
  db: DB;
  query: QueryFn;
  ledger: Ledger;
  cfg: Config;
  log?: (m: string, d?: unknown) => void;
  notify?: (summary: VeilleSummary) => void; // optional out-of-band ping (e.g. Discord webhook)
}

// In-process daily tick. Runs the veille once per UTC day, only after SIE_HOUR_UTC, never concurrently,
// and never when the intel sub-cap is paused (runVeille re-checks all of this; the tick just paces).
// One running pass at a time is guaranteed by the sie_run UNIQUE(run_date) guard + the inFlight latch.
export function startSensingLoop(deps: SchedulerDeps, intervalMs = 30 * 60_000): { stop: () => void } {
  let inFlight = false;
  const log = deps.log ?? (() => {});

  const tick = async (): Promise<void> => {
    if (!deps.cfg.SIE_ENABLED || inFlight) return;
    const now = new Date();
    if (now.getUTCHours() < deps.cfg.SIE_HOUR_UTC) return;
    const today = now.toISOString().slice(0, 10);
    const ran = deps.db.prepare("SELECT 1 FROM sie_run WHERE run_date=? AND status IN ('done','partial-budget','skipped-capped')").get(today);
    if (ran) return;

    inFlight = true;
    try {
      log('SIE daily veille starting', { date: today });
      const summary = await runVeille({ db: deps.db, query: deps.query, ledger: deps.ledger, cfg: deps.cfg, now, log: deps.log });
      log('SIE daily veille done', summary);
      deps.notify?.(summary);
    } catch (e) {
      log('SIE veille crashed', { error: String(e).slice(0, 200) });
    } finally {
      inFlight = false;
    }
  };

  void tick();
  const iv = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(iv) };
}
