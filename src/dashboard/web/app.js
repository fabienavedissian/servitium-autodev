'use strict';
const $ = (s, r = document) => r.querySelector(s);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => '$' + (Number(n) || 0).toFixed(2);

async function api(path, opts) {
  const r = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts });
  if (r.status === 401) { renderLogin(); throw new Error('unauth'); }
  return r.headers.get('content-type')?.includes('json') ? r.json() : r.text();
}

let VIEW = 'overview';
let PROP_FILTER = '';
let es = null;

function toast(msg) {
  const t = h(`<div class="toast">${esc(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

/* ---------- Login ---------- */
function renderLogin() {
  if (es) { es.close(); es = null; }
  $('#app').innerHTML = '';
  const card = h(`
    <div class="login-wrap"><form class="login-card">
      <h1>AutoDev</h1><p>Servitium autonomous engineering. Sign in with your Servitium account.</p>
      <div class="field"><label>Email</label><input name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
      <div class="err"></div>
      <button class="btn block" type="submit">Sign in</button>
    </form></div>`);
  card.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    f.querySelector('.err').textContent = '';
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: f.email.value, login: f.email.value, password: f.password.value }) });
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
        <nav class="nav">${nav.map(([k, l]) => `<a data-v="${k}" class="${k === VIEW ? 'active' : ''}">${l}</a>`).join('')}</nav>
        <div class="spacer"></div>
        <div class="foot">v0.1 · read &amp; approve<br>no auto-merge, no deploy</div>
        <a class="nav" data-logout style="color:var(--txt-dim);padding:8px 12px">Sign out</a>
      </aside>
      <main class="main"><div id="view"></div></main>
    </div>`);
  shell.querySelectorAll('[data-v]').forEach((a) => a.addEventListener('click', () => { VIEW = a.dataset.v; route(); }));
  shell.querySelector('[data-logout]').addEventListener('click', async () => { await fetch('/api/logout'); renderLogin(); });
  $('#app').appendChild(shell);
  route();
  startStream();
}

function route() {
  document.querySelectorAll('.nav a[data-v]').forEach((a) => a.classList.toggle('active', a.dataset.v === VIEW));
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
    <div class="topbar"><div><h2>Overview</h2><div class="muted">Target repos: ${esc(o.repos)}</div></div></div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Proposals</div><div class="value" id="kpi-prop">${props.proposed || 0}</div><div class="sub">${props.approved || 0} approved · ${props.rejected || 0} rejected</div></div>
      <div class="card kpi"><div class="label">In progress</div><div class="value" id="kpi-doing">${sum(STATE_GROUPS.Doing)}</div><div class="sub">${sum(STATE_GROUPS.Planned)} planned</div></div>
      <div class="card kpi"><div class="label">Spend today</div><div class="value">${usd(o.costTodayUsd)}</div><div class="sub">cap ${usd(o.caps.dailyUsd)}</div><div class="bar ${dayPct > 80 ? 'warn' : ''}"><span style="width:${dayPct}%"></span></div></div>
      <div class="card kpi"><div class="label">Spend this month</div><div class="value">${usd(o.costMonthUsd)}</div><div class="sub">cap ${usd(o.caps.monthlyUsd)}</div><div class="bar ${monPct > 80 ? 'warn' : ''}"><span style="width:${monPct}%"></span></div></div>
    </div>
    <div class="section-title">Pipeline</div>
    <div class="grid board">
      ${Object.entries(STATE_GROUPS).map(([g, states]) => `
        <div class="col card"><h3>${g} · ${sum(states)}</h3>
          ${states.filter((s) => o.tasksByState[s]).map((s) => `<div class="state-row"><span class="chip state ${s.toLowerCase()}">${s}</span><span class="count">${o.tasksByState[s]}</span></div>`).join('') || '<div class="muted" style="padding:8px">—</div>'}
        </div>`).join('')}
    </div>`;
}

/* ---------- Proposals ---------- */
async function renderProposals() {
  const list = await api('/proposals' + (PROP_FILTER ? '?status=' + PROP_FILTER : ''));
  const cats = ['security', 'performance', 'refactor', 'bug', 'test-gap'];
  $('#view').innerHTML = `
    <div class="topbar"><div><h2>Proposals</h2><div class="muted">From the API audit. Approve to queue for an atomic, TDD-backed PR.</div></div></div>
    <div class="filters">
      ${[['', 'All'], ['proposed', 'Open'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['queued', 'Queued']].map(([k, l]) => `<button data-f="${k}" class="${PROP_FILTER === k ? 'active' : ''}">${l}</button>`).join('')}
    </div>
    <div id="props">${list.length ? list.map(propCard).join('') : '<div class="empty">No proposals yet. Run the API audit to populate this.</div>'}</div>`;
  $('#view').querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { PROP_FILTER = b.dataset.f; renderProposals(); }));
  $('#view').querySelectorAll('.prop').forEach(wireProp);
}
function propCard(p) {
  const cat = (p.category || '').toLowerCase();
  return `<div class="prop" data-id="${p.id}" data-status="${p.status}">
    <div class="head">
      <div style="display:flex;gap:12px;align-items:flex-start">
        <div class="rank">${p.rank ?? '·'}</div>
        <div><h4 class="title">${esc(p.title)}</h4>
          <div class="meta">
            <span class="chip ${cat}">${esc(p.category)}</span>
            ${p.module ? `<span class="chip">${esc(p.module)}</span>` : ''}
            ${p.impact ? `<span class="chip ${esc(p.impact)}">impact: ${esc(p.impact)}</span>` : ''}
            ${p.effort ? `<span class="chip">effort: ${esc(p.effort)}</span>` : ''}
            ${p.status !== 'proposed' ? `<span class="chip">${esc(p.status)}</span>` : ''}
          </div>
        </div>
      </div>
      <button class="btn ghost toggle">Details</button>
    </div>
    <div class="body">
      ${p.problem ? `<p><b>Problem.</b> ${esc(p.problem)}</p>` : ''}
      ${p.solution ? `<p><b>Proposed.</b> ${esc(p.solution)}</p>` : ''}
      ${p.acceptance_hint ? `<p><b>Acceptance.</b> ${esc(p.acceptance_hint)}</p>` : ''}
      ${p.rationale ? `<p><b>Why ranked here.</b> ${esc(p.rationale)}</p>` : ''}
      ${p.status === 'proposed' ? `<div class="actions"><button class="btn ok" data-act="approved">Approve</button><button class="btn no" data-act="rejected">Reject</button></div>` : ''}
    </div></div>`;
}
function wireProp(card) {
  card.querySelector('.toggle').addEventListener('click', () => card.classList.toggle('open'));
  card.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/proposals/${card.dataset.id}/decide`, { method: 'POST', body: JSON.stringify({ status: b.dataset.act }) });
    toast(b.dataset.act === 'approved' ? 'Approved · queued for the implementer' : 'Rejected');
    renderProposals();
  }));
}

/* ---------- Runs ---------- */
async function renderRuns() {
  const runs = await api('/runs');
  $('#view').innerHTML = `
    <div class="topbar"><div><h2>Runs</h2><div class="muted">Every task the chain processed. Output is always a draft PR you review.</div></div></div>
    ${runs.length ? runs.map((r) => `<div class="run-row"><div><b>#${r.id}</b> ${esc(r.title)} <span class="muted">· ${esc(r.repo)}</span></div><div style="display:flex;gap:10px;align-items:center"><span class="muted">${usd(r.spent_usd)}</span><span class="chip state ${String(r.state).toLowerCase()}">${esc(r.state)}</span></div></div>`).join('') : '<div class="empty">No runs yet. Approve a proposal to start the first one.</div>'}`;
}

/* ---------- Live ---------- */
function startStream() {
  if (es) es.close();
  es = new EventSource('/api/stream');
  es.onmessage = (ev) => {
    if (VIEW !== 'overview') return;
    try {
      const d = JSON.parse(ev.data);
      const kp = $('#kpi-prop'); if (kp && d.proposals) kp.textContent = d.proposals.proposed || 0;
    } catch {}
  };
}

async function boot() {
  try { const me = await api('/me'); if (me.authed) renderShell(); else renderLogin(); }
  catch { renderLogin(); }
}
boot();
