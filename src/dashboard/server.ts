import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { openDb } from '../db/db';
import { loadConfig } from '../config';
import { createLogger } from '../log';
import { tasksByState, costSince, recentRuns, runDetail, addComment } from './queries';
import { listProposals, decideProposal, proposalCounts, type ProposalStatus } from './proposals';

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

server.listen(PORT, () => log.info({ port: PORT }, 'AutoDev dashboard listening'));
