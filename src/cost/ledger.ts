import type { DB } from '../db/db';
import { costUsd, type Usage } from './prices';

export interface Caps {
  dailyUsd: number;
  monthlyUsd: number;
}

export interface SpendStatus {
  dailyUsd: number;
  monthlyUsd: number;
  paused: boolean;
  reason?: string;
}

// Append-only spend ledger + daily/monthly rollups. The monthly cap is the primary kill-switch;
// the daily cap only paces. `now`/`at` are injectable so logic stays deterministic in tests.
export class Ledger {
  constructor(private readonly db: DB) {}

  // Prefer the SDK's authoritative total_cost_usd (opts.costUsd) when available; fall back to the
  // local estimate from the price map (which can differ on cache TTL pricing).
  record(
    model: string,
    usage: Usage,
    opts: { taskId?: number; stepId?: number; at?: string; costUsd?: number; scope?: 'build' | 'intel' } = {},
  ): number {
    const cost = opts.costUsd ?? costUsd(model, usage);
    const at = opts.at ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO spend_ledger
         (task_id, step_id, model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, cost_usd, scope, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        opts.taskId ?? null,
        opts.stepId ?? null,
        model,
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_read_input_tokens ?? 0,
        usage.cache_creation_input_tokens ?? 0,
        cost,
        opts.scope ?? 'build',
        at,
      );
    return cost;
  }

  sumSince(iso: string, scope?: 'build' | 'intel'): number {
    const row = (
      scope
        ? this.db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS s FROM spend_ledger WHERE created_at >= ? AND scope = ?').get(iso, scope)
        : this.db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS s FROM spend_ledger WHERE created_at >= ?').get(iso)
    ) as { s: number };
    return row.s;
  }

  dailyUsd(now: Date = new Date()): number {
    return this.sumSince(startOfDayIso(now));
  }

  monthlyUsd(now: Date = new Date()): number {
    return this.sumSince(startOfMonthIso(now));
  }

  status(caps: Caps, now: Date = new Date()): SpendStatus {
    const dailyUsd = this.dailyUsd(now);
    const monthlyUsd = this.monthlyUsd(now);
    if (monthlyUsd >= caps.monthlyUsd) return { dailyUsd, monthlyUsd, paused: true, reason: 'monthly cap reached' };
    if (dailyUsd >= caps.dailyUsd) return { dailyUsd, monthlyUsd, paused: true, reason: 'daily cap reached' };
    return { dailyUsd, monthlyUsd, paused: false };
  }

  // Per-scope spend status (the intel lane: ~50 EUR/mo, can't starve or be starved by the build lane).
  subStatus(scope: 'build' | 'intel', caps: Caps, now: Date = new Date()): SpendStatus {
    const dailyUsd = this.sumSince(startOfDayIso(now), scope);
    const monthlyUsd = this.sumSince(startOfMonthIso(now), scope);
    if (monthlyUsd >= caps.monthlyUsd) return { dailyUsd, monthlyUsd, paused: true, reason: `${scope} monthly cap reached` };
    if (dailyUsd >= caps.dailyUsd) return { dailyUsd, monthlyUsd, paused: true, reason: `${scope} daily cap reached` };
    return { dailyUsd, monthlyUsd, paused: false };
  }
}

function startOfDayIso(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function startOfMonthIso(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}
