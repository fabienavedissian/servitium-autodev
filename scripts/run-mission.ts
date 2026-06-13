/**
 * Runs ONE approved proposal end-to-end through the chain on the box: mirror -> worktree -> npm ci
 * -> agent chain (gates) -> draft PR. Picks the lowest-rank approved proposal, or an explicit id.
 *   node --env-file-if-exists=.env dist/scripts/run-mission.js [proposalId]
 * For the first supervised run set AUTODEV_SANDBOX=off (gates via LocalRunner so mongod can download);
 * re-enable the bubblewrap sandbox afterwards.
 */
import { loadConfig, assertRuntimeSecrets } from '../src/config';
import { openDb } from '../src/db/db';
import { loadSdk } from '../src/sdk/client';
import { loadGithub } from '../src/github/client';
import { Ledger } from '../src/cost/ledger';
import { buildProcessor } from '../src/orchestrator/processor';
import type { QueuedTask } from '../src/orchestrator/poll';

async function main(): Promise<void> {
  const cfg = loadConfig();
  assertRuntimeSecrets(cfg);
  const db = openDb(cfg.DB_PATH);

  const idArg = process.argv[2];
  const row = (idArg
    ? db.prepare('SELECT * FROM proposal WHERE id = ?').get(Number(idArg))
    : db.prepare("SELECT * FROM proposal WHERE status='approved' ORDER BY (rank IS NULL), rank, id LIMIT 1").get()) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    console.error('No approved proposal to run (approve one in the dashboard first).');
    process.exit(1);
  }

  const repo = (cfg.TARGET_REPOS.split(',')[0] || 'servitium-api').trim();
  const proposalId = Number(row.id);
  const moduleTop = String(row.module ?? '').split('/')[0];
  const allowedPaths = moduleTop ? [`src/${moduleTop}/**`] : ['src/**'];

  // Create a real task row so the spend ledger / steps FK-reference it and the dashboard Runs view fills.
  const now = new Date().toISOString();
  const ins = db
    .prepare(
      `INSERT INTO task (repo, issue_number, title, state, status, allowed_paths_json, budget_usd, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(repo, proposalId, String(row.title), 'QUEUED', 'active', JSON.stringify(allowedPaths), cfg.PER_TASK_BUDGET_USD, now, now);
  const taskId = Number(ins.lastInsertRowid);

  const task: QueuedTask = {
    id: taskId,
    repo,
    title: String(row.title),
    body: `${String(row.problem ?? '')}\n\nAcceptance: ${String(row.acceptance_hint ?? '')}`,
    allowedPaths,
  };
  console.log(`\n=== MISSION #${task.id} [${row.category}] ${task.title} ===`);
  console.log(`repo=${repo} allowedPaths=${allowedPaths.join(',')} sandbox=${process.env.AUTODEV_SANDBOX ?? 'on'}\n`);

  const sdk = await loadSdk();
  const github = await loadGithub(cfg.GITHUB_PAT as string, cfg.GITHUB_ORG);
  const ledger = new Ledger(db);
  const pat = cfg.GITHUB_PAT as string;

  const processOne = buildProcessor({
    sdk,
    ledger,
    caps: { maxLoops: cfg.MAX_LOOPS_PER_TASK, maxTaskBudgetUsd: cfg.PER_TASK_BUDGET_USD },
    workRoot: cfg.WORK_ROOT,
    mirrorRoot: cfg.MIRROR_ROOT,
    repoUrl: (r) => `https://x-access-token:${pat}@github.com/${cfg.GITHUB_ORG}/${r}.git`,
    github,
    gitIdentity: { name: 'AutoDev', email: 'autodev@servitium.org' },
    onStep: (tid, rec) => {
      const detail = JSON.stringify({ outcome: rec.outcome, note: rec.note, status: rec.status, text: (rec.text ?? '').slice(0, 12000), diff: rec.diff });
      const at = new Date().toISOString();
      const ins = db
        .prepare(`INSERT INTO step (task_id, role, model, phase, status, cost_usd, summary, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(tid, rec.role ?? rec.phase, rec.model ?? '', rec.phase, rec.status, rec.costUsd, detail, at, at);
      const stepId = Number(ins.lastInsertRowid);
      for (const g of rec.gates ?? []) {
        db.prepare(`INSERT INTO gate_result (task_id, step_id, gate, status, details_json, created_at) VALUES (?,?,?,?,?,?)`)
          .run(tid, stepId, g.gate, g.status, JSON.stringify(g.details ?? {}).slice(0, 8000), at);
      }
      db.prepare(`UPDATE task SET detail=NULL WHERE id=?`).run(tid); // step recorded -> clear the live sub-status
      console.log(`[step] ${rec.phase} ${rec.role ?? ''} -> ${rec.outcome} ($${rec.costUsd.toFixed(3)})`);
    },
    onState: (tid, state, _prev, spentUsd) => {
      db.prepare(`UPDATE task SET state=?, spent_usd=?, detail=NULL, updated_at=? WHERE id=?`).run(state, spentUsd, new Date().toISOString(), tid);
    },
    onProgress: (tid, _phase, detail) => {
      db.prepare(`UPDATE task SET detail=?, updated_at=? WHERE id=?`).run(detail, new Date().toISOString(), tid);
    },
    log: (m, d) => console.log('[proc]', m, d !== undefined ? JSON.stringify(d).slice(0, 240) : ''),
  });

  const { final, prCreated } = await processOne(task);
  db.prepare(`UPDATE task SET state=?, status=?, spent_usd=?, updated_at=? WHERE id=?`).run(
    final.state,
    final.state === 'DONE' || final.state === 'PR_READY' ? 'done' : 'needs_human',
    final.spentUsd,
    new Date().toISOString(),
    taskId,
  );
  console.log(`\nFINAL state=${final.state}  spent=$${final.spentUsd.toFixed(3)}  loops=${final.loopCount}`);
  if (prCreated) {
    console.log(`DRAFT PR: ${prCreated.url}`);
    db.prepare("UPDATE proposal SET status='done' WHERE id=?").run(proposalId);
  } else {
    db.prepare("UPDATE proposal SET status='queued' WHERE id=?").run(proposalId);
    console.log('No PR (see state above). Proposal left as "queued" for inspection/retry.');
  }
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('mission failed:', e);
  process.exit(1);
});
