import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { openDb } from '../db/db';
import { loadConfig } from '../config';
import { createLogger } from '../log';
import { spawn } from 'child_process';
import { tasksByState, costSince, recentRuns, runDetail, addComment } from './queries';
import { listProposals, decideProposal, proposalCounts, type ProposalStatus } from './proposals';
import { listOpportunities, opportunityDetail, decideOpportunity, sieOverview, logbookFeed, addLogbookNote, recentSenseRuns, type DecideAction } from './opportunities';

const cfg = loadConfig();
const log = createLogger(cfg);
const db = openDb(cfg.DB_PATH);
const PORT = Number(process.env.DASH_PORT ?? 8787);
const SECRET = cfg.DASH_SESSION_SECRET || 'dev-insecure-secret-change-me';
const WEB = path.join(process.cwd(), 'src', 'dashboard', 'web');

const sign = (v: string): string => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const makeSession = (): string => {
  const exp = String(Date.now() + 7 * 86_400_000);
  return `${exp}.${sign(exp)}`;
};
const validSession = (tok?: string): boolean => {
  if (!tok) return false;
  const [v, sig] = tok.split('.');
  return !!v && !!sig && sign(v) === sig && Number(v) > Date.now();
};
const cookie = (req: http.IncomingMessage, name: string): string | undefined =>
  (req.headers.cookie ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);

function send(res: http.ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json', ...headers });
  res.end(data);
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
function serveStatic(res: http.ServerResponse, urlPath: string): void {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(WEB, rel));
  if (!file.startsWith(WEB) || !fs.existsSync(file)) {
    // SPA fallback
    rel = '/index.html';
  }
  const final = fs.existsSync(path.join(WEB, rel)) ? path.join(WEB, rel) : path.join(WEB, 'index.html');
  fs.readFile(final, (err, buf) => {
    if (err) return send(res, 404, 'not found');
    send(res, 200, buf.toString('utf8'), { 'content-type': MIME[path.extname(final)] ?? 'text/plain' });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const p = url.pathname;
  const authed = validSession(cookie(req, 'autodev_sess'));

  if (p === '/healthz') return send(res, 200, { ok: true });

  // Auth
  if (p === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email ?? body.login ?? '');
    const password = String(body.password ?? '');
    const setCookie = `autodev_sess=${makeSession()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`;

    // Preferred: a dedicated dashboard credential (hashed at rest in .env).
    if (cfg.DASH_USER && cfg.DASH_PASSWORD_SHA256) {
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      const userOk = email.toLowerCase() === cfg.DASH_USER.toLowerCase();
      let passOk = false;
      try {
        passOk = crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(cfg.DASH_PASSWORD_SHA256));
      } catch {
        passOk = false;
      }
      if (userOk && passOk) return send(res, 200, { ok: true }, { 'set-cookie': setCookie });
      return send(res, 401, { error: 'invalid credentials' });
    }

    // Fallback: validate against the Servitium API.
    try {
      const r = await fetch(cfg.API_AUTH_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) return send(res, 401, { error: 'invalid credentials' });
      return send(res, 200, { ok: true }, { 'set-cookie': setCookie });
    } catch (e) {
      log.error({ e: String(e) }, 'login upstream failed');
      return send(res, 502, { error: 'auth upstream unreachable' });
    }
  }
  if (p === '/api/logout') return send(res, 200, { ok: true }, { 'set-cookie': 'autodev_sess=; HttpOnly; Path=/; Max-Age=0' });
  if (p === '/api/me') return send(res, 200, { authed });

  // API (auth required)
  if (p.startsWith('/api/')) {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const now = new Date();
    const startDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const intelMonthUsd = (db.prepare("SELECT COALESCE(SUM(cost_usd),0) AS s FROM spend_ledger WHERE scope='intel' AND created_at >= ?").get(startMonth) as { s: number }).s;
    const intelCapped = intelMonthUsd >= cfg.SIE_MONTHLY_CAP_USD;
    const capMsg = `Plafond intel mensuel atteint (${intelMonthUsd.toFixed(2)}$ / ${cfg.SIE_MONTHLY_CAP_USD}$ ~ 50 EUR). Ca reprendra le mois prochain.`;

    if (p === '/api/overview') {
      return send(res, 200, {
        tasksByState: tasksByState(db),
        proposals: proposalCounts(db),
        costTodayUsd: costSince(db, startDay),
        costMonthUsd: costSince(db, startMonth),
        caps: { dailyUsd: cfg.DAILY_SPEND_CAP_USD, monthlyUsd: cfg.MONTHLY_SPEND_CAP_USD },
        repos: cfg.TARGET_REPOS,
      });
    }
    if (p === '/api/proposals') return send(res, 200, listProposals(db, url.searchParams.get('status') ?? undefined));
    if (p === '/api/runs') return send(res, 200, recentRuns(db));
    const runMatch = /^\/api\/runs\/(\d+)$/.exec(p);
    if (runMatch) return send(res, 200, runDetail(db, Number(runMatch[1])));
    const commentMatch = /^\/api\/runs\/(\d+)\/comment$/.exec(p);
    if (commentMatch && req.method === 'POST') {
      const body = await readBody(req);
      const text = String(body.body ?? '').slice(0, 4000);
      if (!text.trim()) return send(res, 400, { error: 'empty comment' });
      addComment(db, Number(commentMatch[1]), text, new Date().toISOString());
      return send(res, 200, { ok: true });
    }
    const decideMatch = /^\/api\/proposals\/(\d+)\/decide$/.exec(p);
    if (decideMatch && req.method === 'POST') {
      const body = await readBody(req);
      const status = String(body.status) as ProposalStatus;
      if (!['approved', 'rejected', 'queued'].includes(status)) return send(res, 400, { error: 'bad status' });
      decideProposal(db, Number(decideMatch[1]), status, (body.comment as string) ?? null, new Date().toISOString());
      return send(res, 200, { ok: true });
    }
    // ── Intelligence Engine (SIE) ──────────────────────────────────────────
    if (p === '/api/sie/overview') return send(res, 200, sieOverview(db, startMonth));
    if (p === '/api/sie/runs') return send(res, 200, recentSenseRuns(db));
    if (p === '/api/opportunities') return send(res, 200, listOpportunities(db, url.searchParams.get('status') ?? 'open', url.searchParams.get('source') ?? 'all'));
    const oppMatch = /^\/api\/opportunities\/(\d+)$/.exec(p);
    if (oppMatch && req.method === 'GET') {
      const d = opportunityDetail(db, Number(oppMatch[1]));
      return d ? send(res, 200, d) : send(res, 404, { error: 'not found' });
    }
    const oppDecide = /^\/api\/opportunities\/(\d+)\/decide$/.exec(p);
    if (oppDecide && req.method === 'POST') {
      const body = await readBody(req);
      const action = String(body.action) as DecideAction;
      if (!['accept', 'reject', 'greenlight', 'close', 'comment', 'thumbs_up', 'thumbs_down'].includes(action)) return send(res, 400, { error: 'bad action' });
      decideOpportunity(db, Number(oppDecide[1]), action, (body.comment as string)?.slice(0, 4000) ?? null, new Date().toISOString());
      return send(res, 200, { ok: true });
    }
    if (p === '/api/logbook' && req.method === 'GET') return send(res, 200, logbookFeed(db));
    if (p === '/api/logbook' && req.method === 'POST') {
      const body = await readBody(req);
      const summary = String(body.summary ?? '').slice(0, 1000);
      const kind = ['want', 'can', 'did', 'note'].includes(String(body.kind)) ? String(body.kind) : 'note';
      if (!summary.trim()) return send(res, 400, { error: 'empty' });
      addLogbookNote(db, kind, summary, new Date().toISOString());
      return send(res, 200, { ok: true });
    }
    const oppBrief = /^\/api\/opportunities\/(\d+)\/brief$/.exec(p);
    if (oppBrief && req.method === 'POST') {
      const id = Number(oppBrief[1]);
      const exists = db.prepare('SELECT 1 FROM opportunity WHERE id=?').get(id);
      if (!exists) return send(res, 404, { error: 'not found' });
      if (intelCapped) return send(res, 429, { error: capMsg });
      const briefBody = await readBody(req);
      const steer = String(briefBody.steer ?? '').slice(0, 800);
      db.prepare("UPDATE opportunity SET brief_state='running', brief_progress=0, brief_started_at=NULL, brief_steer=?, detail='Lancement de l investigation...', status=CASE WHEN status='proposed' THEN 'greenlit' ELSE status END, decided_at=COALESCE(decided_at, ?), updated_at=? WHERE id=?").run(steer || null, now.toISOString(), now.toISOString(), id);
      const child = spawn(process.execPath, ['--max-old-space-size=2048', 'dist/scripts/brief-opportunity.js', String(id)], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.unref();
      return send(res, 200, { ok: true, started: true });
    }
    if (p === '/api/sie/run-now' && req.method === 'POST') {
      const today = new Date().toISOString().slice(0, 10);
      const running = db.prepare("SELECT 1 FROM sie_run WHERE run_date=? AND status='running'").get(today);
      if (running) return send(res, 409, { error: 'Une veille est déjà en cours.' });
      if (intelCapped) return send(res, 429, { error: capMsg });
      const child = spawn(process.execPath, ['--max-old-space-size=1536', 'dist/scripts/run-veille.js', '--force'], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.unref();
      return send(res, 200, { ok: true, started: true });
    }
    if (p === '/api/sie/code-scan-now' && req.method === 'POST') {
      if (intelCapped) return send(res, 429, { error: capMsg });
      const body = await readBody(req);
      const repoArg = typeof body.repo === 'string' && /^[a-z0-9-]+$/i.test(body.repo) ? [body.repo] : [];
      const child = spawn(process.execPath, ['--max-old-space-size=1536', 'dist/scripts/run-code-scan.js', ...repoArg], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.unref();
      return send(res, 200, { ok: true, started: true });
    }

    if (p === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const tick = (): void => {
        res.write(`data: ${JSON.stringify({ tasksByState: tasksByState(db), proposals: proposalCounts(db), costTodayUsd: costSince(db, startDay), t: new Date().toISOString() })}\n\n`);
      };
      tick();
      const iv = setInterval(tick, 4000);
      req.on('close', () => clearInterval(iv));
      return;
    }
    return send(res, 404, { error: 'not found' });
  }

  return serveStatic(res, p);
});

// Recover dead investigations: a brief stuck 'running' with no DB update for 15 min (its process
// crashed or was killed mid-run) is marked failed so the card stops showing a frozen spinner and the
// owner can relaunch it.
setInterval(() => {
  try {
    db.prepare("UPDATE opportunity SET brief_state='failed', detail='Investigation interrompue - relance-la.' WHERE brief_state='running' AND (julianday('now') - julianday(updated_at)) * 86400 > 900").run();
  } catch {
    /* best-effort */
  }
}, 60_000);

// WebSocket: push to clients the instant the DB changes (no client polling). Auth via the session cookie.
const wss = new WebSocketServer({ noServer: true });
const clients = new Set<WebSocket>();
server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (u.pathname !== '/ws' || !validSession(cookie(req, 'autodev_sess'))) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });
});
function broadcast(obj: unknown): void {
  const s = JSON.stringify(obj);
  for (const c of clients) {
    try {
      if (c.readyState === 1) c.send(s);
    } catch {
      /* drop */
    }
  }
}

let lastFp = '';
setInterval(() => {
  if (clients.size === 0) return;
  const now = new Date();
  const startDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const overview = {
    tasksByState: tasksByState(db),
    proposals: proposalCounts(db),
    costTodayUsd: costSince(db, startDay),
    costMonthUsd: costSince(db, startMonth),
    caps: { dailyUsd: cfg.DAILY_SPEND_CAP_USD, monthlyUsd: cfg.MONTHLY_SPEND_CAP_USD },
    repos: cfg.TARGET_REPOS,
  };
  const runs = recentRuns(db, 50);
  const maxStep = (db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM step').get() as { m: number }).m;
  // SIE live signals: any opportunity change, new veille run/status, or logbook line pushes instantly.
  const sieFp = db
    .prepare(
      `SELECT (SELECT COALESCE(MAX(id),0) FROM opportunity) AS mo,
              (SELECT COALESCE(MAX(updated_at),'') FROM opportunity) AS mou,
              (SELECT COALESCE(MAX(id),0) FROM sie_run) AS mr,
              (SELECT status FROM sie_run ORDER BY id DESC LIMIT 1) AS rs,
              (SELECT COALESCE(MAX(id),0) FROM logbook) AS ml`,
    )
    .get();
  const fp = JSON.stringify([overview.tasksByState, overview.proposals, overview.costTodayUsd, maxStep, runs.map((r) => [r.id, r.state, r.steps, r.spent_usd, r.detail]), sieFp]);
  if (fp === lastFp) return;
  lastFp = fp;
  broadcast({ type: 'changed', overview, runs });
}, 1000);

server.listen(PORT, () => log.info({ port: PORT }, 'AutoDev dashboard listening'));
