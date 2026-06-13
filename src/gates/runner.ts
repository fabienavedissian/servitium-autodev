import type { Gate, GateContext, GateResult } from './index';

export interface GateRunSummary {
  results: GateResult[];
  allPass: boolean;
  failed: string[];
}

// Sequentially runs a list of gates and aggregates. Stops at nothing (collects every result) so
// the dashboard shows the full matrix, but the FSM only advances when allPass is true.
export async function runGates(gates: Gate[], ctx: GateContext): Promise<GateRunSummary> {
  const results: GateResult[] = [];
  for (const g of gates) {
    try {
      results.push(await g.run(ctx));
    } catch (e) {
      results.push({ gate: g.name, status: 'fail', details: { error: String(e) } });
    }
  }
  const failed = results.filter((r) => r.status === 'fail').map((r) => r.gate);
  return { results, allPass: failed.length === 0, failed };
}
