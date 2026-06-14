/**
 * Re-renders max_prompt + deeper_prompt for briefed opportunities from their stored feasibility_json,
 * using the CURRENT templates. No API cost — pure re-render. Run after a prompt-template change:
 *   node dist/scripts/rerender-prompts.js            # all briefed opportunities
 *   node dist/scripts/rerender-prompts.js <id>       # one opportunity
 * brief_md is left untouched (it is FR-translated and unaffected by Max-prompt template changes).
 */
import { loadConfig } from '../src/config';
import { openDb } from '../src/db/db';
import { renderMaxPrompt, renderDeeperPrompt, type Feasibility } from '../src/intel/brief/maxPromptTemplate';
import { isGameOpp } from '../src/intel/appContext';

interface Row {
  id: number;
  title: string;
  thesis: string | null;
  why_now: string | null;
  fit: string | null;
  sources_json: string | null;
  feasibility_json: string | null;
  score: number;
  kind: string | null;
  dedup_key: string | null;
}

function main(): void {
  const onlyId = process.argv[2] ? Number(process.argv[2]) : null;
  const cfg = loadConfig();
  const db = openDb(cfg.DB_PATH);
  const where = onlyId ? 'id=@id' : 'feasibility_json IS NOT NULL AND max_prompt IS NOT NULL';
  const rows = db
    .prepare(`SELECT id, title, thesis, why_now, fit, sources_json, feasibility_json, score, kind, dedup_key FROM opportunity WHERE ${where}`)
    .all(onlyId ? { id: onlyId } : {}) as Row[];
  const upd = db.prepare('UPDATE opportunity SET max_prompt=?, deeper_prompt=?, updated_at=? WHERE id=?');
  const at = new Date().toISOString();
  let n = 0;
  for (const r of rows) {
    let f: Feasibility;
    try {
      f = JSON.parse(r.feasibility_json || '') as Feasibility;
    } catch {
      continue;
    }
    if (!f || !f.recommendation) continue;
    let sources: { label: string; url: string }[] = [];
    try {
      sources = JSON.parse(r.sources_json || '[]') as { label: string; url: string }[];
    } catch {
      /* none */
    }
    const oppEn = { title: r.title, thesis: r.thesis ?? undefined, whyNow: r.why_now ?? undefined, fit: r.fit ?? undefined, sources };
    const kind = isGameOpp(r.kind, r.dedup_key) ? 'game' : (r.kind ?? '');
    const maxPrompt = renderMaxPrompt(oppEn, f, r.score, { kind });
    const deeperPrompt = renderDeeperPrompt(oppEn, f, { kind });
    upd.run(maxPrompt, deeperPrompt, at, r.id);
    n += 1;
    console.log(`re-rendered opp ${r.id} "${r.title}" -> max_prompt ${maxPrompt.length} chars`);
  }
  console.log(`done: ${n} opportunit${n === 1 ? 'y' : 'ies'} re-rendered (no API spend)`);
}

main();
