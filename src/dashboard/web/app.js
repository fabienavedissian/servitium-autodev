'use strict';
const $ = (s, r = document) => r.querySelector(s);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => '$' + (Number(n) || 0).toFixed(n < 1 ? 4 : 2);

async function api(path, opts) {
  const r = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts });
  if (r.status === 401) { renderLogin(); throw new Error('unauth'); }
  return r.headers.get('content-type')?.includes('json') ? r.json() : r.text();
}

let VIEW = 'overview';
let PROP_FILTER = '';
let OPEN_RUN = null;
let es = null;

function toast(msg) {
  const t = h(`<div class="toast">${esc(msg)}</div>`);
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}

/* ---------- Login ---------- */
function renderLogin() {
  if (es) { es.close(); es = null; }
  $('#app').innerHTML = '';
  const card = h(`
    <div class="login-wrap"><form class="login-card">
      <h1>AutoDev</h1><p>Servitium autonomous engineering. Sign in.</p>
      <div class="field"><label>Email</label><input name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
      <div class="err"></div><button class="btn block" type="submit">Sign in</button>
    </form></div>`);
  card.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; f.querySelector('.err').textContent = '';
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: f.email.value, login: f.email.value, password: f.password.value }) });
      if (!r.ok) { f.querySelector('.err').textContent = r.status === 401 ? 'Invalid credentials.' : 'Auth service unreachable.'; return; }
      boot();
    } catch { f.querySelector('.err').textContent = 'Network error.'; }
  });
  $('#app').appendChild(card);
}

/* ---------- Shell ---------- */
function renderShell() {
  const nav = [['overview', 'Overview'], ['proposals', 'Proposals'], ['runs', 'Runs']];
  $('#app').innerHTML = '';
  const shell = h(`
    <div class="shell">
      <aside class="side">
        <div class="brand"><div class="logo"></div><div><b>AutoDev</b><small>Servitium</small></div></div>
        <nav class="nav">${nav.map(([k, l]) => `<a data-v="${k}">${l}</a>`).join('')}</nav>
        <div class="spacer"></div>
        <div class="foot">draft PRs only<br>no auto-merge, no deploy</div>
        <a class="nav" data-logout style="color:var(--txt-dim);padding:8px 12px">Sign out</a>
      </aside>
      <main class="main"><div id="view"></div></main>
    </div>`);
  shell.querySelectorAll('[data-v]').forEach((a) => a.addEventListener('click', () => { VIEW = a.dataset.v; OPEN_RUN = null; route(); }));
  shell.querySelector('[data-logout]').addEventListener('click', async () => { await fetch('/api/logout'); renderLogin(); });
  $('#app').appendChild(shell);
  route(); connectWs();
}
function route() {
  document.querySelectorAll('.nav a[data-v]').forEach((a) => a.classList.toggle('active', a.dataset.v === VIEW));
  if (OPEN_RUN) return renderRunDetail(OPEN_RUN);
  if (VIEW === 'overview') renderOverview();
  else if (VIEW === 'proposals') renderProposals();
  else renderRuns();
}

/* ---------- Overview ---------- */
const STATE_GROUPS = {
  Planned: ['QUEUED', 'PRE_GATE', 'SPEC', 'SPEC_APPROVAL'],
  Doing: ['SETUP', 'TESTS_FIRST', 'IMPLEMENT', 'CODE_REVIEW', 'CHALLENGE', 'RED_TEAM', 'SECURITY', 'FINAL_REVIEW', 'VALIDATE'],
  Done: ['PR_READY', 'DONE', 'NEEDS_HUMAN', 'FAILED', 'REJECTED'],
};
async function renderOverview() {
  const o = await api('/overview');
  const sum = (arr) => arr.reduce((a, s) => a + (o.tasksByState[s] || 0), 0);
  const props = o.proposals || {};
  const dayPct = Math.min(100, (o.costTodayUsd / o.caps.dailyUsd) * 100 || 0);
  const monPct = Math.min(100, (o.costMonthUsd / o.caps.monthlyUsd) * 100 || 0);
  $('#view').innerHTML = `
    <div class="topbar"><div><h2>Overview</h2><div class="muted">Target: ${esc(o.repos)}</div></div></div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Proposals open</div><div class="value">${props.proposed || 0}</div><div class="sub">${props.approved || 0} approved · ${props.done || 0} done</div></div>
      <div class="card kpi"><div class="label">In progress</div><div class="value">${sum(STATE_GROUPS.Doing)}</div><div class="sub">${sum(STATE_GROUPS.Planned)} planned</div></div>
      <div class="card kpi"><div class="label">Spend today</div><div class="value">${usd(o.costTodayUsd)}</div><div class="sub">cap ${usd(o.caps.dailyUsd)}</div><div class="bar ${dayPct > 80 ? 'warn' : ''}"><span style="width:${dayPct}%"></span></div></div>
      <div class="card kpi"><div class="label">This month</div><div class="value">${usd(o.costMonthUsd)}</div><div class="sub">cap ${usd(o.caps.monthlyUsd)}</div><div class="bar ${monPct > 80 ? 'warn' : ''}"><span style="width:${monPct}%"></span></div></div>
    </div>
    <div class="section-title">Pipeline</div>
    <div class="grid board">
      ${Object.entries(STATE_GROUPS).map(([g, states]) => `<div class="col card"><h3>${g} · ${sum(states)}</h3>
        ${states.filter((s) => o.tasksByState[s]).map((s) => `<div class="state-row"><span class="chip state">${s}</span><span class="count">${o.tasksByState[s]}</span></div>`).join('') || '<div class="muted" style="padding:8px">—</div>'}</div>`).join('')}
    </div>`;
}

/* ---------- Proposals ---------- */
async function renderProposals() {
  const list = await api('/proposals' + (PROP_FILTER ? '?status=' + PROP_FILTER : ''));
  $('#view').innerHTML = `
    <div class="topbar"><div><h2>Proposals</h2><div class="muted">From the API audit. Approve to queue an atomic, TDD-backed PR.</div></div></div>
    <div class="filters">${[['', 'All'], ['proposed', 'Open'], ['approved', 'Approved'], ['queued', 'Queued'], ['done', 'Done'], ['rejected', 'Rejected']].map(([k, l]) => `<button data-f="${k}" class="${PROP_FILTER === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div id="props">${list.length ? list.map(propCard).join('') : '<div class="empty">No proposals. Run the audit to populate.</div>'}</div>`;
  $('#view').querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { PROP_FILTER = b.dataset.f; renderProposals(); }));
  $('#view').querySelectorAll('.prop').forEach(wireProp);
}
function propCard(p) {
  const cat = (p.category || '').toLowerCase();
  return `<div class="prop" data-id="${p.id}">
    <div class="head"><div style="display:flex;gap:12px;align-items:flex-start">
      <div class="rank">${p.rank ?? '·'}</div>
      <div><h4 class="title">${esc(p.title)}</h4><div class="meta">
        <span class="chip ${cat}">${esc(p.category)}</span>${p.module ? `<span class="chip">${esc(p.module)}</span>` : ''}
        ${p.impact ? `<span class="chip ${esc(p.impact)}">impact ${esc(p.impact)}</span>` : ''}${p.effort ? `<span class="chip">effort ${esc(p.effort)}</span>` : ''}
        ${p.status !== 'proposed' ? `<span class="chip">${esc(p.status)}</span>` : ''}</div></div></div>
      <button class="btn ghost toggle">Details</button></div>
    <div class="body">${p.problem ? `<p><b>Problem.</b> ${esc(p.problem)}</p>` : ''}${p.acceptance_hint ? `<p><b>Acceptance.</b> ${esc(p.acceptance_hint)}</p>` : ''}
      ${p.status === 'proposed' ? `<div class="actions"><button class="btn ok" data-act="approved">Approve</button><button class="btn no" data-act="rejected">Reject</button></div>` : ''}</div></div>`;
}
function wireProp(card) {
  card.querySelector('.toggle').addEventListener('click', () => card.classList.toggle('open'));
  card.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/proposals/${card.dataset.id}/decide`, { method: 'POST', body: JSON.stringify({ status: b.dataset.act }) });
    toast(b.dataset.act === 'approved' ? 'Approved' : 'Rejected'); renderProposals();
  }));
}

/* ---------- Runs ---------- */
async function renderRuns() {
  const runs = await api('/runs');
  $('#view').innerHTML = `
    <div class="topbar"><div><h2>Runs</h2><div class="muted">Click a run to see every step, the diff, and the validations.</div></div></div>
    ${runs.length ? runs.map((r) => `<div class="run-row" data-run="${r.id}"><div><b>#${r.id}</b> ${esc(r.title)} <span class="muted">· ${esc(r.repo)} · ${r.steps} steps</span></div>
      <div style="display:flex;gap:10px;align-items:center"><span class="muted">${usd(r.spent_usd)}</span><span class="chip state ${String(r.state).toLowerCase()}">${esc(r.state)}</span></div></div>`).join('') : '<div class="empty">No runs yet. Approve a proposal and the engine will start one.</div>'}`;
  $('#view').querySelectorAll('[data-run]').forEach((row) => row.addEventListener('click', () => { OPEN_RUN = row.dataset.run; renderRunDetail(OPEN_RUN); }));
}

const ROLE_LABEL = { triage: 'Triage', spec: 'Spec', tdd: 'TDD (failing tests)', implement: 'Implement', review: 'Code review', challenger: 'Challenger', redteam: 'Red team', security: 'Security', final: 'Final review', validator: 'Validator' };
const PHASE_DESC = {
  PRE_GATE: 'Triage — deciding if the task is actionable', SPEC: 'Spec — writing the spec & acceptance criteria',
  SPEC_APPROVAL: 'Awaiting spec approval', SETUP: 'Setup — clone, install deps, capture the test baseline (long prep)',
  TESTS_FIRST: 'TDD — writing the failing test and running it', IMPLEMENT: 'Implement — writing the fix and running the gates',
  CODE_REVIEW: 'Code review', CHALLENGE: 'Challenger — deep bug/security hunt (Opus, slower)',
  RED_TEAM: 'Red team — trying to break it (Opus, slower)', SECURITY: 'Security — audit / semgrep / gitleaks',
  FINAL_REVIEW: 'Final review', VALIDATE: 'Validator — preparing the draft PR',
};
const TERMINAL_STATES = ['DONE', 'FAILED', 'NEEDS_HUMAN', 'REJECTED', 'PR_READY'];
function currentCard(task) {
  const st = task.state;
  if (st === 'DONE' || st === 'PR_READY') return `<div class="done-note ok">✓ Run complete — a draft PR is ready for your review.</div>`;
  if (st === 'NEEDS_HUMAN') return `<div class="done-note err">⚠ Parked — needs your input. See the last step above for why.</div>`;
  if (st === 'FAILED') return `<div class="done-note err">✕ Run failed. See the last step above.</div>`;
  if (st === 'REJECTED') return `<div class="done-note">Rejected at triage.</div>`;
  if (st === 'QUEUED') return `<div class="step running"><div class="step-head"><div class="spinner"></div><div class="step-title"><b>Queued — starting…</b></div></div></div>`;
  const sub = task.detail ? `<div class="substatus">${esc(task.detail)}…</div>` : '';
  return `<div class="step running"><div class="step-head"><div class="spinner"></div><div class="step-title"><b>${esc(PHASE_DESC[st] || st)}</b> <span class="muted">running…</span></div><div class="step-meta"><span class="chip outcome run">in progress</span></div></div>${sub}</div>`;
}

async function renderRunDetail(id) {
  OPEN_RUN = id;
  const d = await api('/runs/' + id);
  if (!d.task) { OPEN_RUN = null; return renderRuns(); }
  const t = d.task;
  $('#view').innerHTML = `
    <div class="topbar"><div><h2><a class="back" data-back>Runs</a> / #${t.id} ${esc(t.title)}</h2>
      <div class="muted" id="run-sub">${esc(t.repo)} · ${d.steps.length} steps · ${usd(t.spent_usd)} · <span class="chip state ${String(t.state).toLowerCase()}">${esc(t.state)}</span></div></div><span class="live-dot" title="live"></span></div>
    <div class="timeline">${d.steps.map(renderStep).join('')}<div id="current">${currentCard(t)}</div></div>
    <div class="section-title">Steer this run</div>
    <div class="card"><div class="comment-box"><textarea id="cmt" placeholder="Leave a note the agent takes into account on the next step (e.g. 'put more effort on edge cases', 'also cover the refund path')..."></textarea><button class="btn" id="cmt-send">Send</button></div>
      ${(d.comments || []).map((c) => `<div class="cmt"><span class="muted">${esc((c.created_at || '').slice(0, 16).replace('T', ' '))}${c.consumed_at ? ' · taken into account' : ' · pending'}</span><div>${esc(c.body)}</div></div>`).join('')}</div>`;
  $('#view').querySelector('[data-back]').addEventListener('click', () => { OPEN_RUN = null; renderRuns(); });
  $('#view').querySelectorAll('.step .step-head').forEach((hd) => hd.addEventListener('click', () => hd.parentElement.classList.toggle('open')));
  $('#cmt-send').addEventListener('click', async () => {
    const body = $('#cmt').value.trim(); if (!body) return;
    await api(`/runs/${id}/comment`, { method: 'POST', body: JSON.stringify({ body }) });
    toast('Note sent'); renderRunDetail(id);
  });
  RENDERED_STEPS = d.steps.length;
}

function renderStep(s, i) {
  const ok = s.status === 'ok';
  const cls = s.status === 'ok' ? 'ok' : s.status === 'bounced' ? 'bounced' : 'err';
  return `<div class="step ${cls}">
    <div class="step-head">
      <div class="dot"></div>
      <div class="step-title"><b>${esc(ROLE_LABEL[s.role] || s.role || s.phase)}</b> <span class="muted">${esc(s.model || '')}</span></div>
      <div class="step-meta">${s.outcome ? `<span class="chip outcome ${cls}">${esc(s.outcome)}</span>` : ''}<span class="muted">${usd(s.costUsd)}</span></div>
    </div>
    <div class="step-body">
      ${s.gates && s.gates.length ? `<div class="gates">${s.gates.map((g) => `<span class="gchip ${g.status}">${g.status === 'pass' ? '✓' : '✕'} ${esc(g.gate)}</span>`).join('')}</div>` : ''}
      ${renderAgentText(s.text)}
      ${s.diff ? `<div class="diff-wrap"><div class="diff-title">Diff</div><pre class="diff">${renderDiff(s.diff)}</pre></div>` : ''}
      ${s.note && !s.gates?.length ? `<div class="muted">${esc(s.note)}</div>` : ''}
    </div></div>`;
}

const HUMAN_KEY = { actionable: 'Actionable', reason: 'Reason', spec: 'Spec', acceptanceCriteria: 'Acceptance criteria', allowedPaths: 'Scope (allowed paths)', decision: 'Decision', notes: 'Notes', findings: 'Findings', summary: 'Summary', specFiles: 'Spec files', criticals: 'Critical issues', repro: 'Reproduction', done: 'Done', prTitle: 'PR title', prSummary: 'PR summary' };
function renderAgentText(text) {
  if (!text) return '';
  let t = String(text).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(t); // agents often wrap JSON in a code fence
  if (fence) t = fence[1].trim();
  let obj = null; try { obj = JSON.parse(t); } catch {}
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const parts = Object.entries(obj).map(([k, v]) => {
      const label = HUMAN_KEY[k] || k;
      if (Array.isArray(v)) return v.length ? `<div class="ao-k">${esc(label)}</div><ul>${v.map((x) => `<li>${esc(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('')}</ul>` : '';
      if (v == null || v === '') return '';
      if (typeof v === 'boolean') return `<div class="ao-k">${esc(label)}</div><div class="ao-v">${v ? 'yes' : 'no'}</div>`;
      return `<div class="ao-k">${esc(label)}</div><div class="ao-v">${esc(typeof v === 'string' ? v : JSON.stringify(v))}</div>`;
    }).filter(Boolean);
    if (parts.length) return '<div class="agent-out">' + parts.join('') + '</div>';
  }
  return `<div class="agent-out"><pre class="plain">${esc(t)}</pre></div>`;
}

function renderDiff(diff) {
  return esc(diff).split('\n').map((l) => {
    if (l.startsWith('diff --git') || l.startsWith('index ') || l.startsWith('--- ') || l.startsWith('+++ ')) return `<span class="dh">${l}</span>`;
    if (l.startsWith('@@')) return `<span class="dhunk">${l}</span>`;
    if (l.startsWith('+')) return `<span class="dadd">${l}</span>`;
    if (l.startsWith('-')) return `<span class="ddel">${l}</span>`;
    return `<span>${l}</span>`;
  }).join('\n');
}

/* ---------- Live (WebSocket, in-place updates) ---------- */
let ws = null;
let RENDERED_STEPS = 0;
function connectWs() {
  try { if (ws) ws.close(); } catch {}
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => { try { applyChanged(JSON.parse(ev.data)); } catch {} };
  ws.onclose = () => setTimeout(connectWs, 2000);
}
function applyChanged(msg) {
  if (msg.type !== 'changed') return;
  if (OPEN_RUN) return updateRunDetailLive();
  if (VIEW === 'overview') renderOverview();
  else if (VIEW === 'runs') renderRuns();
}
async function updateRunDetailLive() {
  const d = await api('/runs/' + OPEN_RUN);
  if (!d.task) return;
  const sub = $('#run-sub');
  if (sub) sub.innerHTML = `${esc(d.task.repo)} · ${d.steps.length} steps · ${usd(d.task.spent_usd)} · <span class="chip state ${String(d.task.state).toLowerCase()}">${esc(d.task.state)}</span>`;
  const cur = $('#current');
  if (cur) {
    if (d.steps.length > RENDERED_STEPS) {
      for (let i = RENDERED_STEPS; i < d.steps.length; i++) {
        const node = h(renderStep(d.steps[i]));
        node.querySelector('.step-head').addEventListener('click', () => node.classList.toggle('open'));
        node.classList.add('appear');
        cur.parentElement.insertBefore(node, cur);
      }
      RENDERED_STEPS = d.steps.length;
    }
    cur.innerHTML = currentCard(d.task);
  }
}

async function boot() {
  try { const me = await api('/me'); if (me.authed) renderShell(); else renderLogin(); } catch { renderLogin(); }
}
boot();
