'use strict';
const $ = (s, r = document) => r.querySelector(s);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Minimal, safe markdown -> HTML (escape first, then apply markers). For rendering briefs nicely.
function mdInline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1 ↗</a>');
}
function renderMarkdown(md) {
  const lines = esc(md).split('\n');
  let html = '';
  let inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const line of lines) {
    if (/^### /.test(line)) { closeList(); html += `<h4>${mdInline(line.slice(4))}</h4>`; }
    else if (/^## /.test(line)) { closeList(); html += `<h3>${mdInline(line.slice(3))}</h3>`; }
    else if (/^# /.test(line)) { closeList(); html += `<h2>${mdInline(line.slice(2))}</h2>`; }
    else if (/^[-*] /.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${mdInline(line.slice(2))}</li>`; }
    else if (line.trim() === '') { closeList(); }
    else { closeList(); html += `<p>${mdInline(line)}</p>`; }
  }
  closeList();
  return html;
}
const usd = (n) => '$' + (Number(n) || 0).toFixed(n < 1 ? 4 : 2);

async function api(path, opts) {
  const r = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts });
  if (r.status === 401) { renderLogin(); throw new Error('unauth'); }
  return r.headers.get('content-type')?.includes('json') ? r.json() : r.text();
}

let VIEW = 'opportunities';
let OPP_SOURCE = 'all';
let OPP_STATUS = 'open';
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
  const primary = [['opportunities', 'Opportunités'], ['validated', 'Mes briefs'], ['research', 'Veille'], ['logbook', 'Carnet de bord']];
  const secondary = [['overview', 'Aperçu'], ['proposals', 'Propositions'], ['runs', 'Runs']];
  const link = ([k, l]) => `<a data-v="${k}">${l}</a>`;
  $('#app').innerHTML = '';
  const shell = h(`
    <div class="shell">
      <aside class="side">
        <div class="brand"><div class="logo"></div><div><b>Servitium</b><small>Intelligence</small></div></div>
        <nav class="nav">${primary.map(link).join('')}<div class="nav-sep">Build (secondaire)</div>${secondary.map(link).join('')}</nav>
        <div class="spacer"></div>
        <div class="foot">Veille quotidienne · briefs prêts à coller<br>PR en brouillon seulement, aucun déploiement auto</div>
        <a class="nav" data-logout style="color:var(--txt-dim);padding:8px 12px">Déconnexion</a>
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
  else if (VIEW === 'opportunities') renderOpportunities();
  else if (VIEW === 'validated') renderValidated();
  else if (VIEW === 'research') renderResearch();
  else if (VIEW === 'logbook') renderLogbook();
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

/* ---------- Opportunités (Intelligence Engine) ---------- */
const scoreClass = (s) => (s >= 85 ? 'flag' : s >= 65 ? 'good' : 'mid');
function veilleBanner(ov) {
  const r = ov && ov.lastRun;
  if (!r || r.status !== 'running') return '';
  const pct = Math.max(2, Math.min(100, r.progress || 0));
  return `<div class="veille-banner"><div class="spinner"></div><div class="vb-main"><div class="vb-head"><b>Veille en cours</b> <span class="muted small">${esc(r.stage || 'démarrage…')}</span><span class="vb-pct">${pct}%</span></div><div class="bar"><span style="width:${pct}%"></span></div></div></div>`;
}
const GAME_APPID = { rust: 252490, dayz: 221100, ark: 346110, 'v rising': 1604030, vrising: 1604030, 'conan exiles': 440900, conan: 440900, soulmask: 2646460, palworld: 1623730, enshrouded: 1203620, valheim: 892970, "garry's mod": 4000, 's&box': 4000, "7 days to die": 251570, 'project zomboid': 108600 };
function gameImage(title) {
  const t = (title || '').toLowerCase();
  for (const [name, id] of Object.entries(GAME_APPID)) if (t.includes(name)) return `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;
  return null;
}
const KIND_FR = { feature: 'feature', game: 'jeu', business: 'métier', integration: 'intégration', pricing: 'tarif', 'tech-enabler': 'technique', security: 'sécurité', performance: 'perf', refactor: 'refactor', 'lib-upgrade': 'libs', 'test-gap': 'tests' };
async function renderOpportunities() {
  const [ov, list] = await Promise.all([api('/sie/overview'), api(`/opportunities?status=${OPP_STATUS}&source=${OPP_SOURCE}`)]);
  const last = ov.lastRun;
  const lastTxt = last ? `dernière veille ${esc(String(last.run_date).split('#')[0])} · ${esc(last.status)} · ${last.opportunities || 0} opportunités · ${usd(last.cost_usd)}` : 'aucune veille pour l’instant';
  const cap = 52, monPct = Math.min(100, (ov.intelMonthUsd / cap) * 100 || 0);
  const srcFilter = [['all', 'Toutes'], ['web', 'Web'], ['code', 'Code']].map(([k, l]) => `<button data-src="${k}" class="${OPP_SOURCE === k ? 'active' : ''}">${l}</button>`).join('');
  const statFilter = [['open', 'À traiter'], ['all', 'Tout']].map(([k, l]) => `<button data-stat="${k}" class="${OPP_STATUS === k ? 'active' : ''}">${l}</button>`).join('');
  const lb = Object.entries(ov.learnedBias || {}).sort((a, b) => b[1] - a[1]);
  const lbHtml = lb.length ? `<div class="learned"><span class="muted small">Le moteur a appris de tes choix :</span> ${lb.map(([k, v]) => `<span class="lb ${v > 0 ? 'up' : 'down'}">${v > 0 ? '↑' : '↓'} ${esc(KIND_FR[k] || k)}</span>`).join(' ')}</div>` : '';
  $('#view').innerHTML = `
    <div class="topbar"><div><h2>Opportunités</h2><div class="muted">${lastTxt}</div></div>
      <div style="display:flex;gap:10px;align-items:center"><span class="live-dot" title="en direct"></span><button class="btn ghost" id="scan-code">Analyser le code</button><button class="btn" id="run-now">Lancer la veille</button></div></div>
    <div id="veille-banner">${veilleBanner(ov)}</div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Opportunités ouvertes</div><div class="value">${ov.openOpportunities}</div><div class="sub">${ov.flagshipOpen} phares</div></div>
      <div class="card kpi"><div class="label">Dépense intel (mois)</div><div class="value">${usd(ov.intelMonthUsd)}</div><div class="sub">plafond ${usd(cap)} ~ 50 EUR</div><div class="bar ${monPct > 80 ? 'warn' : ''}"><span style="width:${monPct}%"></span></div></div>
    </div>
    ${lbHtml}
    <div class="filters">${statFilter}<span style="width:14px"></span>${srcFilter}</div>
    <div id="opps">${list.length ? list.map(oppCard).join('') : `<div class="empty">${OPP_STATUS === 'validated' ? 'Aucune opportunité validée. Clique « Valider » sur une opportunité pour générer son brief + prompt Max ; elle apparaîtra ici.' : '« Lancer la veille » scanne le web ; « Analyser le code » audite tes dépôts.'}</div>`}</div>`;
  $('#run-now').addEventListener('click', async () => { const r = await api('/sie/run-now', { method: 'POST', body: '{}' }); toast(r && r.error ? r.error : 'Veille lancée — elle apparaîtra ici en direct.'); });
  $('#scan-code').addEventListener('click', async () => { const r = await api('/sie/code-scan-now', { method: 'POST', body: '{}' }); toast(r && r.error ? r.error : 'Analyse du code lancée — résultats en direct.'); });
  $('#view').querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => { OPP_SOURCE = b.dataset.src; renderOpportunities(); }));
  $('#view').querySelectorAll('[data-stat]').forEach((b) => b.addEventListener('click', () => { OPP_STATUS = b.dataset.stat; renderOpportunities(); }));
  $('#view').querySelectorAll('.opp').forEach(wireOpp);
}

// Dedicated menu: the opportunities the owner has pushed (validated -> brief + Max prompt). They live here forever.
async function renderValidated() {
  const list = await api('/opportunities?status=validated&source=' + OPP_SOURCE);
  const srcFilter = [['all', 'Toutes'], ['web', 'Web'], ['code', 'Code']].map(([k, l]) => `<button data-src="${k}" class="${OPP_SOURCE === k ? 'active' : ''}">${l}</button>`).join('');
  $('#view').innerHTML = `
    <div class="topbar"><div><h2>Mes briefs</h2><div class="muted">Les sujets que tu as poussés : brief concret + prompt Max prêts. Ils restent ici à vie pour ne pas les refaire.</div></div><span class="live-dot" title="en direct"></span></div>
    <div class="filters">${srcFilter}</div>
    <div id="opps">${list.length ? list.map(oppCard).join('') : '<div class="empty">Aucun sujet poussé pour l’instant. Dans « Opportunités », clique « Valider » : l’investigation se lance et le sujet atterrit ici avec son brief + prompt Max.</div>'}</div>`;
  $('#view').querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => { OPP_SOURCE = b.dataset.src; renderValidated(); }));
  $('#view').querySelectorAll('.opp').forEach(wireOpp);
}
// Dynamic (live-patchable) fragments — shared by initial render and the surgical WS update.
function oppTitleHTML(o) {
  return `#${o.rank ?? '·'} ${esc(o.title)} ${o.flagship ? '<span class="chip flag">phare</span>' : ''} ${o.seen_before ? '<span class="chip seen">déjà vu</span>' : ''} ${o.relevance === 1 ? '<span class="chip ok-chip">pertinent</span>' : o.relevance === -1 ? '<span class="chip no-chip">bruit</span>' : ''}`;
}
function oppMetaHTML(o) {
  return `<span class="chip src-${o.source_kind === 'code' ? 'code' : 'web'}">${o.source_kind === 'code' ? 'code' : 'web'}</span><span class="chip ${esc(o.kind)}">${esc(KIND_FR[o.kind] || o.kind)}</span>${o.source_kind === 'code' && o.repo ? `<span class="chip">${esc(String(o.repo).replace('servitium-', ''))}</span>` : `<span class="chip">${esc(o.angle)}</span>`}${o.status !== 'proposed' ? `<span class="chip">${esc(o.status)}</span>` : ''}${o.has_brief ? '<span class="chip good-chip">brief prêt</span>' : ''}`;
}
function pqClass(q) { return q >= 75 ? 'good' : q >= 55 ? 'mid' : 'low'; }
function fmtDur(sec) { if (sec < 60) return Math.round(sec) + ' s'; const m = Math.floor(sec / 60); const s = Math.round(sec % 60); return m + ' min' + (s ? ' ' + s + ' s' : ''); }
function briefActionsHTML(o) {
  if (o.brief_state === 'running') {
    const pct = Math.max(2, Math.min(100, o.brief_progress || 0));
    let eta = '';
    if (o.brief_started_at && pct > 4 && pct < 100) {
      const elapsed = (Date.now() - Date.parse(o.brief_started_at)) / 1000;
      const remaining = Math.round((elapsed * (100 - pct)) / pct);
      if (remaining > 0 && remaining < 3600) eta = ` · ~${fmtDur(remaining)} restantes`;
    }
    return `<div class="brief-running"><div class="brief-prog"><div class="brief-prog-head"><span class="trace">${esc(o.detail || 'Investigation profonde en cours…')}</span><span class="brief-pct">${pct}%${eta}</span></div><div class="bar"><span style="width:${pct}%"></span></div></div></div>`;
  }
  if (o.brief_state === 'failed' && !o.has_brief) return `<button class="btn ok" data-brief>Relancer l'investigation</button><span class="muted small">${esc(o.detail || 'échec')}</span>`;
  if (!o.has_brief) return `<button class="btn ok" data-brief>Générer le brief concret</button><span class="muted small">investigation Opus profonde (~5-10 min) → brief concret + prompt Max</span>`;
  const pq = o.promptQuality != null
    ? `<span class="pq ${pqClass(o.promptQuality)}" title="Fiabilité du prompt selon la profondeur d'investigation. Les inconnues se lèvent avec le prompt « approfondir » sur Max.">Qualité du prompt : ${o.promptQuality}%${o.unknowns_count ? ` · ${o.unknowns_count} inconnue${o.unknowns_count > 1 ? 's' : ''} à lever` : ''}</span>`
    : '';
  return `<div class="brief-buttons"><button class="btn ok" data-copy="max">Copier le prompt Max</button><button class="btn ghost" data-copy="deeper">Copier le prompt « approfondir »</button><button class="btn ghost" data-view-brief>Voir le brief</button><button class="btn ghost" data-brief title="relance l'enquête : lève les inconnues restantes + ta consigne ci-dessous — le % monte">Approfondir</button>${pq}</div>
    <div class="steer-box"><input type="text" data-steer placeholder="Optionnel : oriente la prochaine passe (ex : vérifie que chaque commande RCON marche vraiment)"></div>`;
}
function oppCard(o) {
  const b = o.breakdown || { bars: [] };
  const sources = (o.sources || []).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label || 'source')} ↗</a>`).join(' · ');
  const bars = b.bars.map((bar) => `<div class="bd-row" title="${esc(bar.why)}"><span class="bd-k">${esc(bar.key)}</span><div class="bd-bar"><span style="width:${Math.round((bar.value || 0) * 100)}%"></span></div><span class="bd-w">x${bar.weight}</span><span class="bd-ev ${bar.evidence ? '' : 'none'}">${bar.evidence ? 'sourcé' : 'sans preuve'}</span></div>`).join('');
  const img = gameImage(o.title);
  return `<div class="opp" data-id="${o.id}">
    <div class="opp-head">
      ${img ? `<img class="opp-img" src="${img}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <div class="opp-score ${scoreClass(o.score)}">${o.score ?? '?'}</div>
      <div class="opp-main">
        <div class="opp-title">${oppTitleHTML(o)}</div>
        <div class="opp-meta">${oppMetaHTML(o)}</div>
        ${o.thesis ? `<div class="opp-thesis">${esc(o.thesis)}</div>` : ''}
      </div>
      <button class="btn ghost toggle">Détails</button>
    </div>
    <div class="opp-body">
      ${o.why_now ? `<p><b>Pourquoi maintenant.</b> ${esc(o.why_now)}</p>` : ''}
      ${o.fit ? `<p><b>Lien.</b> ${esc(o.fit)}</p>` : ''}
      ${sources ? `<div class="evidence"><b>Sources :</b> ${sources}</div>` : ''}
      <div class="breakdown"><div class="bd-title">Pourquoi ce score (8 critères × poids, calculé par code)</div>${bars}</div>
      <div class="brief-zone"></div>
      <div class="brief-actions">${briefActionsHTML(o)}</div>
      <div class="opp-actions">
        ${o.status === 'greenlit' || o.status === 'accepted'
          ? `<button class="btn ok" data-act="close">Clôturer (terminé)</button><button class="btn no" data-act="reject">Pas intéressé</button><span class="muted small">Reste ici à vie pour ne pas le refaire.</span>`
          : `<button class="btn ok" data-act="greenlight">Valider — générer le brief</button><button class="btn no" data-act="reject">Pas intéressé</button><span class="spacer-x"></span><span class="muted small">Bien ciblé&nbsp;?</span><button class="btn ghost" data-act="thumbs_up" title="la veille a visé juste">Utile</button><button class="btn ghost" data-act="thumbs_down" title="hors sujet / sans intérêt">Hors sujet</button>`}
      </div>
      <div class="comment-box small"><textarea data-comment placeholder="Raison (ex : « on a déjà ça, la map gère déjà les 2 maps »). Écris-la puis « Pas intéressé » : le moteur ne te le reproposera plus."></textarea><button class="btn ghost" data-send-comment>Envoyer</button></div>
    </div></div>`;
}
async function triggerBrief(id, btn, steer) {
  if (btn) { btn.disabled = true; btn.textContent = 'Investigation en cours…'; }
  const r = await api(`/opportunities/${id}/brief`, { method: 'POST', body: JSON.stringify({ steer: steer || '' }) });
  if (r && r.error) { toast(r.error); if (btn) { btn.disabled = false; btn.textContent = 'Générer le brief concret'; } }
  else toast((steer ? 'Investigation orientée lancée' : 'Investigation profonde lancée') + ' — visible en direct (~5-10 min).');
}
function wireBriefActions(card) {
  const id = card.dataset.id;
  card.querySelector('[data-brief]')?.addEventListener('click', (e) => triggerBrief(id, e.target, card.querySelector('[data-steer]')?.value || ''));
  card.querySelectorAll('[data-copy]').forEach((btn) => btn.addEventListener('click', async () => {
    const d = await api(`/opportunities/${id}`);
    const text = btn.dataset.copy === 'max' ? d.max_prompt : d.deeper_prompt;
    try { await navigator.clipboard.writeText(text || ''); toast('Copié. Colle-le dans Claude Code Max.'); } catch { toast('Copie impossible — ouvre le brief.'); }
  }));
  card.querySelector('[data-view-brief]')?.addEventListener('click', async () => {
    const zone = card.querySelector('.brief-zone');
    if (zone.dataset.open) { zone.innerHTML = ''; zone.dataset.open = ''; return; }
    const d = await api(`/opportunities/${id}`);
    zone.innerHTML = `<div class="brief-doc">${d.brief_md ? renderMarkdown(d.brief_md) : '(pas de brief)'}</div>`; zone.dataset.open = '1';
  });
}
function wireOpp(card) {
  const id = card.dataset.id;
  card.querySelector('.toggle').addEventListener('click', () => card.classList.toggle('open'));
  card.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    const act = btn.dataset.act;
    const body = { action: act };
    // On reject, carry the comment box text as the reason (teaches the engine not to re-propose it).
    if (act === 'reject') { const c = card.querySelector('[data-comment]')?.value.trim(); if (c) body.comment = c; }
    await api(`/opportunities/${id}/decide`, { method: 'POST', body: JSON.stringify(body) });
    const fr = { greenlight: 'validé', reject: 'pas intéressé', close: 'clôturé', thumbs_up: 'utile', thumbs_down: 'hors sujet' };
    toast('Enregistré : ' + (fr[act] || act) + (act === 'reject' && body.comment ? ' (le moteur ne le reproposera plus)' : ''));
    if (act === 'greenlight' && !card.querySelector('[data-copy]')) await triggerBrief(id);
    if (['greenlight', 'close', 'reject'].includes(act)) route();
  }));
  card.querySelector('[data-send-comment]')?.addEventListener('click', async () => {
    const txt = card.querySelector('[data-comment]').value.trim();
    if (!txt) return;
    await api(`/opportunities/${id}/decide`, { method: 'POST', body: JSON.stringify({ action: 'comment', comment: txt }) });
    card.querySelector('[data-comment]').value = ''; toast('Commentaire enregistré');
  });
  wireBriefActions(card);
}
// Surgical WS update: patch existing cards in place (never touches the open accordion / breakdown /
// textarea), insert new ones, drop gone ones. No full re-render -> open cards stay open.
function patchOppCard(card, o) {
  const sc = card.querySelector('.opp-score');
  if (sc) { sc.textContent = o.score ?? '?'; sc.className = 'opp-score ' + scoreClass(o.score); }
  const t = card.querySelector('.opp-title'); if (t) t.innerHTML = oppTitleHTML(o);
  const m = card.querySelector('.opp-meta'); if (m) m.innerHTML = oppMetaHTML(o);
  const ba = card.querySelector('.brief-actions');
  const sig = `${o.brief_state || ''}|${o.has_brief ? 1 : 0}|${o.brief_progress || 0}|${o.detail || ''}`;
  if (ba && ba.dataset.sig !== sig) { ba.innerHTML = briefActionsHTML(o); ba.dataset.sig = sig; wireBriefActions(card); }
}
async function updateOpportunitiesLive() {
  const container = $('#opps');
  if (!container) return route();
  const status = VIEW === 'validated' ? 'validated' : OPP_STATUS;
  const [ov, list] = await Promise.all([api('/sie/overview'), api(`/opportunities?status=${status}&source=${OPP_SOURCE}`)]);
  const seen = new Set();
  for (const o of list) {
    seen.add(String(o.id));
    const card = container.querySelector(`.opp[data-id="${o.id}"]`);
    if (card) patchOppCard(card, o);
    else { const n = h(oppCard(o)); wireOpp(n); container.appendChild(n); }
  }
  container.querySelectorAll('.opp').forEach((c) => { if (!seen.has(c.dataset.id)) c.remove(); });
  // KPIs + live veille banner (cheap, no layout disruption)
  const k = $('#view').querySelectorAll('.kpi .value');
  if (k[0]) k[0].textContent = ov.openOpportunities;
  if (k[1]) k[1].textContent = usd(ov.intelMonthUsd);
  const vb = $('#veille-banner'); if (vb) vb.innerHTML = veilleBanner(ov);
}

/* ---------- Veille (transparence : tout ce que le moteur a vu) ---------- */
const ANGLE_FR = { tech: 'Tech & moteurs', product: 'Discord & produit', competitor: 'Concurrents', game: 'Jeux candidats', market: 'Marché & pricing', business: 'Nouveaux métiers', platform: 'Plateforme', owner: 'Tes priorités', code: 'Code' };
function whyNot(o) {
  if (o.status === 'rejected') return o.comment ? `tu l'as écarté : « ${esc(o.comment)} »` : "tu l'as écarté";
  const b = o.breakdown;
  if (!b || !b.bars || !b.bars.length) return `score ${o.score}/100 sous le seuil de 65`;
  const weak = [...b.bars].sort((a, c) => a.value * a.weight - c.value * c.weight).slice(0, 2).map((x) => x.key);
  return `score ${o.score}/100 sous le seuil (65) — points faibles : ${weak.join(', ')}`;
}
async function renderResearch() {
  const [d, ov] = await Promise.all([api('/sie/research'), api('/sie/overview')]);
  const byAngle = {};
  (d.signals || []).forEach((s) => { (byAngle[s.angle] = byAngle[s.angle] || []).push(s); });
  $('#view').innerHTML = `
    <div class="topbar"><div><h2>Veille — tout ce que le moteur a vu</h2><div class="muted">Ses recherches, ses lectures, et ce qui n'a pas été retenu (avec la raison).</div></div><span class="live-dot" title="en direct"></span></div>
    <div id="veille-banner">${veilleBanner(ov)}</div>
    <div class="section-title">Activité</div>
    <div class="runs-feed">${(d.runs || []).length ? d.runs.map((r) => `<div class="run-line"><span class="chip state ${esc(String(r.status))}">${esc(String(r.run_date).split('#')[0])}</span><span class="muted small">${r.queries_run || 0} recherches · ${r.hits_fetched || 0} pages lues · ${r.signals_new || 0} signaux · ${r.opportunities || 0} opportunités</span><span class="muted small">${usd(r.cost_usd)}</span></div>`).join('') : '<div class="muted">Aucun run encore.</div>'}</div>
    <div class="section-title">Recherches & lectures · ${(d.signals || []).length} signaux</div>
    <div class="signals">${Object.keys(byAngle).length ? Object.entries(byAngle).map(([a, sigs]) => `<div class="sig-group"><h4>${esc(ANGLE_FR[a] || a)} <span class="muted">· ${sigs.length}</span></h4>${sigs.map((s) => `<div class="sig"><div class="sig-title">${esc(s.title)}${s.source_url ? ` <a href="${esc(s.source_url)}" target="_blank" rel="noopener">${esc(s.source_domain || 'source')} ↗</a>` : ''}</div>${s.summary ? `<div class="sig-sum">${esc(s.summary)}</div>` : ''}</div>`).join('')}</div>`).join('') : '<div class="empty">Aucun signal pour l\'instant — lance une veille.</div>'}</div>
    <div class="section-title">Considéré mais non retenu · ${(d.notRetained || []).length}</div>
    <div class="not-retained">${(d.notRetained || []).length ? d.notRetained.map((o) => `<div class="nr"><div class="nr-score ${scoreClass(o.score)}">${o.score ?? '?'}</div><div class="nr-main"><div class="nr-title">${esc(o.title)} <span class="chip">${esc(o.status)}</span><span class="chip ${esc(o.kind)}">${esc(KIND_FR[o.kind] || o.kind)}</span></div>${o.thesis ? `<div class="muted small">${esc(o.thesis)}</div>` : ''}<div class="nr-why">Pourquoi non retenu : ${whyNot(o)}</div></div></div>`).join('') : '<div class="muted">Rien d\'écarté pour l\'instant.</div>'}</div>`;
}

/* ---------- Carnet de bord ---------- */
const KIND_LABEL = { veille: 'veille', decided: 'décidé', did: 'fait', want: 'envie', can: 'possible', note: 'note', spent: 'dépense' };
async function renderLogbook() {
  const feed = await api('/logbook');
  const byDay = {};
  feed.forEach((l) => { (byDay[l.dated_on] = byDay[l.dated_on] || []).push(l); });
  $('#view').innerHTML = `
    <div class="topbar"><div><h2>Carnet de bord</h2><div class="muted">Ce que le moteur a fait, ce qu’on veut, ce qu’on peut faire.</div></div><span class="live-dot" title="en direct"></span></div>
    <div class="card"><div class="comment-box"><textarea id="lb-note" placeholder="Ajoute une note (envie / idée / possible)…"></textarea><button class="btn" id="lb-send">Ajouter</button></div></div>
    <div class="logbook">${Object.keys(byDay).length ? Object.entries(byDay).map(([day, items]) => `<div class="lb-day"><div class="lb-date">${esc(day)}</div>${items.map((l) => `<div class="lb-line"><span class="chip kind ${esc(l.kind)}">${esc(KIND_LABEL[l.kind] || l.kind)}</span><span class="lb-sum">${esc(l.summary)}</span>${l.source === 'owner' ? '<span class="muted small">toi</span>' : ''}</div>`).join('')}</div>`).join('') : '<div class="empty">Vide. La première veille commencera à écrire le carnet.</div>'}</div>`;
  $('#lb-send').addEventListener('click', async () => {
    const v = $('#lb-note').value.trim(); if (!v) return;
    await api('/logbook', { method: 'POST', body: JSON.stringify({ kind: 'want', summary: v }) });
    $('#lb-note').value = ''; renderLogbook();
  });
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
  if (document.activeElement && ['TEXTAREA', 'INPUT'].includes(document.activeElement.tagName)) return; // don't clobber typing
  if (OPEN_RUN) return updateRunDetailLive();
  if (VIEW === 'overview') renderOverview();
  else if (VIEW === 'opportunities' || VIEW === 'validated') updateOpportunitiesLive();
  else if (VIEW === 'research') renderResearch();
  else if (VIEW === 'logbook') renderLogbook();
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
