I've fully grounded myself in the current implementation. Now I'll synthesize the six lenses into one coherent, buildable spec.

```markdown
# Servitium Intelligence Engine — Redesign Spec

A token-and-treatment refactor that turns a competent admin panel into a world-class intelligence product. **No re-architecture**: every class the live-patch code touches (`.opp-score`, `.opp-title`, `.opp-meta`, `.brief-actions[data-sig]`, `.kpi .value`, `#opps`, `#veille-banner`, `.bar > span`) keeps its name and box model. We change what those classes *look like* via tokens + a handful of new utility classes, and add three new patchable regions (Home). `patchOppCard()`, `briefActionsHTML()`, `updateOpportunitiesLive()` keep working unchanged.

Hard rules honored throughout: vanilla JS/CSS, no build step, dark theme, French UI, **no emoji** (inline SVG only — this also fixes the existing `✓ ✕ ⚠ ↗ ↑ ↓` literals in `app.js`), surgical WS patching preserved.

---

## 1. Design-System Token Block (paste-ready)

Drop this at the top of `styles.css`, replacing the current `:root`. The old token names are kept as **aliases** so nothing breaks before each component is migrated.

```css
:root {
  /* ── TYPE ── */
  --font-ui: "Inter var","Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --font-mono: "JetBrains Mono",ui-monospace,"SF Mono","Cascadia Code",Menlo,monospace;
  --fs-display: 30px;  --fs-h1: 22px;  --fs-h2: 17px;  --fs-h3: 15px;
  --fs-base: 14px;     --fs-sm: 13px;  --fs-xs: 12px;  --fs-2xs: 11px;
  --lh-tight: 1.2;     --lh-base: 1.55;
  --fw-regular: 440;   --fw-medium: 540;  --fw-bold: 680;
  --track-tight: -0.014em;  --track-eyebrow: 0.06em;
  --num: tabular-nums;                 /* applied wherever a live number lives */

  /* ── SURFACES / ELEVATION RAMP ── */
  --bg: #0a0c12;
  --surface-1: #11141d;   /* sidebar, sunken wells, bar tracks */
  --surface-2: #161a25;   /* cards (default) */
  --surface-3: #1c2130;   /* raised: hover, popovers, active nav */
  --surface-4: #232838;   /* highest: dropdowns, toasts, drawer */
  --line: rgba(255,255,255,.07);
  --line-strong: rgba(255,255,255,.12);
  --hairline-top: inset 0 1px 0 rgba(255,255,255,.05);   /* the "lit edge" */

  /* legacy aliases (so un-migrated rules still resolve) */
  --bg-2: var(--surface-1);  --panel: var(--surface-2);  --panel-2: var(--surface-3);

  /* ── TEXT ── */
  --txt: #eef1f7;
  --txt-dim: #9aa3b8;     /* body ≥13px */
  --txt-dim-2: #aab3c7;   /* small ≤12px chips/labels — ~5.2:1 contrast */
  --txt-mute: #6b7488;    /* timestamps, weights, disabled */

  /* ── ACCENT (one hero, used sparingly) ── */
  --accent: #7aa2ff;  --accent-press: #5b86f0;  --accent-2: #9d8bff;
  --accent-soft: rgba(122,162,255,.14);
  --accent-ring: rgba(122,162,255,.45);

  /* ── SEMANTIC ROLES (one source of truth for chips + scores) ── */
  --ok: #46d39a;     --ok-soft: rgba(70,211,154,.12);    --ok-line: rgba(70,211,154,.28);
  --warn: #f5b13d;   --warn-soft: rgba(245,177,61,.12);  --warn-line: rgba(245,177,61,.28);
  --danger: #ff6b81; --danger-soft: rgba(255,107,129,.12);--danger-line: rgba(255,107,129,.28);
  --info: #5bc8ff;   --info-soft: rgba(91,200,255,.12);  --info-line: rgba(91,200,255,.28);
  /* legacy aliases for existing JS classes */
  --green: var(--ok);  --amber: var(--warn);  --red: var(--danger);

  /* score buckets (rail + tile) */
  --phare: var(--accent-2);  --fort: var(--ok);  --moyen: var(--warn);

  /* ── SPACING (4px grid) ── */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px;  --sp-4: 16px;  --sp-5: 20px;
  --sp-6: 24px; --sp-8: 32px; --sp-10: 40px; --sp-12: 48px;

  /* ── RADIUS ── */
  --r-sm: 8px;  --r-md: 12px;  --r-lg: 16px;  --r-pill: 999px;
  --radius: var(--r-md);               /* legacy alias */

  /* ── SHADOW / GLOW ── */
  --shadow-1: 0 1px 2px rgba(0,0,0,.4);
  --shadow-2: 0 4px 12px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.04);
  --shadow-3: 0 12px 32px -8px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.06);
  --glow-accent: 0 0 0 3px var(--accent-ring);
  --glow-live: 0 0 16px -2px rgba(70,211,154,.5);
  --shadow: var(--shadow-1);           /* legacy alias */

  /* ── MOTION ── */
  --ease-out: cubic-bezier(.16,1,.3,1);
  --ease-in-out: cubic-bezier(.65,0,.35,1);
  --ease-spring: cubic-bezier(.34,1.56,.64,1);
  --dur-fast: 120ms;  --dur-base: 180ms;  --dur-slow: 240ms;
  --dur-bar: 420ms;                    /* bar growth, drawer */

  /* ── LAYOUT ── */
  --rail-w: 248px;  --content-max: 1280px;

  /* ── Z-INDEX ── */
  --z-scrim: 40;  --z-drawer: 50;  --z-toast: 60;  --z-tooltip: 70;

  /* ── DATAVIZ ── */
  --viz-bar: #2c3a55;  --viz-line: var(--accent);  --viz-area: rgba(122,162,255,.14);
  --grid-line: rgba(255,255,255,.05);
}

html { font-family: var(--font-ui); }
body {
  background: var(--bg);
  font: var(--fw-regular) var(--fs-base)/var(--lh-base) var(--font-ui);
  font-feature-settings: "cv05" 1, "ss03" 1, "tnum" 1;
  color: var(--txt);
}
/* numbers never jitter on live update */
.kpi .value, .opp-score, .vb-pct, .brief-pct, .count, .g-num,
.kt-value, .nav-badge, .vnode-stats b, .bd-w { font-variant-numeric: var(--num); }

/* one global, accessible focus ring — replaces every ad-hoc :focus border tweak */
:where(a, button, input, textarea, [tabindex]):focus-visible {
  outline: none; box-shadow: var(--glow-accent); border-radius: var(--r-sm);
}
:focus:not(:focus-visible) { outline: none; }

@media (prefers-reduced-motion: reduce) {
  *, *::after, *::before { animation-duration: .01ms !important;
    animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
```

**Type discipline:** three weights only (`440`/`540`/`680`). Kill the default uppercase `.section-title`; uppercase is reserved for tiny eyebrow labels (`.kpi .label`, `.bd-title`, `.nav-group`). Mono (`--font-mono`) is used for all machine output: briefs, prompts, diffs.

**Optional self-host (no network dep if skipped):** `@font-face` `InterVariable.woff2` + `JetBrainsMono.woff2`, both `font-display: swap`. The system fallback already looks intentional.

---

## 2. Navigation + HOME / Overview

### 2.1 Mental model, stated once

`Veille → Opportunités → Mes briefs` (world → triage → output). `Build` is a quarantined legacy island. A **pipeline ribbon** prints this model at the top of Home and doubles as sub-nav for the loop.

### 2.2 Two-tier left rail (248px)

Restructure the flat sidebar into named groups with inline-SVG icons, count badges, a pinned primary action, and a canonical spend footer.

```
◆ Servitium  ·  Intelligence Engine

[ ⚡ Lancer la veille  ▾ ]      ← pinned primary CTA (▾ caret = "Analyser le code")

── PILOTAGE ──
◉ Accueil                       ← NEW, default landing (VIEW='home')
⊙ Opportunités          12      ← badge.hot = openOpportunities
⊘ Mes briefs             3      ← badge = validated-with-brief count

── TRANSPARENCE ──
◎ Veille            ● live      ← .nav-live dot when lastRun.status==='running'
▤ Carnet de bord

── BUILD · SECONDAIRE ──  ▸     ← collapsed by default (chevron disclosure)
   Aperçu (→ "Pipeline Build") · Propositions · Runs

(spacer)
⌁ Prochaine veille 06:00
◴ 12,40 € / 50 € ce mois        ← THE canonical spend chip (removed from every view body)
⎋ Déconnexion
```

**IA decisions:**
- Primary action lives in the rail (globally reachable, never scrolls away). Remove the per-view "Lancer la veille"/"Analyser le code" buttons from the Opportunités topbar.
- Badges carry the "what needs me" signal so you don't open a view to know there's work.
- Build lane collapsed by default; **auto-expand** when any Build task is non-terminal (a run in progress) so the legacy lane isn't buried while active.
- Spend appears in exactly **one** place (rail footer). Delete the duplicate spend KPI from Opportunités and the run-cost re-prints elsewhere.
- Nav anchors get `role="link" tabindex="0"` + Enter/Space keydown for keyboard nav.

```css
.shell { display: grid; grid-template-columns: var(--rail-w) 1fr; min-height: 100vh; }
.side { background: var(--surface-1); border-right: 1px solid var(--line);
  padding: var(--sp-4); display: flex; flex-direction: column; }
.nav-group { font: var(--fw-medium) var(--fs-2xs)/1 var(--font-ui); text-transform: uppercase;
  letter-spacing: var(--track-eyebrow); color: var(--txt-mute); margin: var(--sp-4) 12px var(--sp-2); }
.nav a { position: relative; display: flex; align-items: center; gap: 10px; height: 38px;
  padding: 0 12px; border-radius: var(--r-sm); color: var(--txt-dim); font-weight: var(--fw-medium);
  transition: background var(--dur-fast), color var(--dur-fast); }
.nav a:hover { background: var(--surface-3); color: var(--txt); }
.nav a.active { background: var(--accent-soft); color: var(--txt); }
.nav a.active::before { content: ""; position: absolute; left: 0; width: 3px; height: 18px;
  border-radius: 0 2px 2px 0; background: var(--accent); }
.nav-badge { margin-left: auto; min-width: 20px; height: 18px; padding: 0 6px; border-radius: var(--r-pill);
  background: var(--surface-3); color: var(--txt-dim); font: var(--fw-bold) var(--fs-2xs)/18px var(--font-ui);
  display: grid; place-items: center; }
.nav-badge.hot { background: var(--accent-soft); color: var(--accent); }
.nav-live { width: 7px; height: 7px; border-radius: 99px; margin-left: auto;
  background: var(--ok); box-shadow: var(--glow-live); animation: pulse 1.8s infinite; }
.rail-cta { display: flex; gap: 8px; justify-content: center; align-items: center; width: 100%;
  padding: 11px 14px; margin: var(--sp-1) 0 var(--sp-2); border-radius: var(--r-sm);
  font: var(--fw-medium) var(--fs-sm) var(--font-ui); color: #07101f; border: none;
  background: linear-gradient(180deg, var(--accent), var(--accent-press)); box-shadow: var(--shadow-2); }
.main { padding: var(--sp-8); max-width: var(--content-max); margin: 0 auto; container-type: inline-size; }
```

`app.js` changes: `let VIEW = 'home';` · `primary` starts with `['home','Accueil']` · `route()` adds `if (VIEW==='home') renderHome();` · `applyChanged()` adds `else if (VIEW==='home') updateHomeLive();`.

### 2.3 The real HOME / Accueil — orient in one screen

Reading order = priority order. A 12-col grid that collapses via container query. It answers *what needs me / what's the top pick / is the engine running / how much did it cost / is it learning* without scrolling on a 1440×900 laptop.

```
┌ Accueil ─────────────────────────────────────────────────────────────┐
│ Bonjour. Le moteur a tourné ce matin à 06:00.        [ Lancer ⚡ ]     │ greeting
│ Veille ──▶ Opportunités ──▶ Mes briefs     · Build secondaire          │ pipeline ribbon
│                                                                        │
│ ┌── ACTION REQUISE (span-12, only if non-empty) ─────────────────────┐│ the "needs me" strip
│ │ 3 opportunités phares à trier · 1 brief prêt à coller             ││ (.calm + reassuring
│ │ [Voir les phares →]   [Ouvrir le brief →]                         ││  copy when empty)
│ └────────────────────────────────────────────────────────────────────┘│
│                                                                        │
│ ┌─ HERO (4 tuiles) ─────────────────────────────────────────────────┐ │ band 1: KPIs + gauge
│ │ [KPI+spark] [KPI+spark] [KPI+delta] [ JAUGE budget radiale 50€ ]   │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│ ┌─ Activité de veille (combo chart) ──────┐ ┌─ Le moteur a appris ──┐ │ band 2: dataviz
│ │ barres signaux + ligne opportunités, 14j │ │ barres divergentes ↑↓ │ │
│ └───────────────────────────────────────────┘ └───────────────────────┘ │
│                                                                        │
│ ┌─ Top opportunité (hero, actionnable) ───┐ ┌─ Activité récente ────┐ │ band 3: top + feed
│ │ #1 score 91 ▮phare · [Valider][Détails]  │ │ timeline veille+carnet │ │
│ └───────────────────────────────────────────┘ └───────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

```css
.home { display: grid; grid-template-columns: repeat(12, 1fr); gap: var(--sp-4); }
.home-hero { grid-column: span 12; display: grid; grid-template-columns: repeat(3,1fr) 1.4fr; gap: var(--sp-4); }
.home-mid  { grid-column: span 12; display: grid; grid-template-columns: 1.6fr 1fr; gap: var(--sp-4); }
.home-low  { grid-column: span 12; display: grid; grid-template-columns: 1fr 1.4fr; gap: var(--sp-4); }
@container (max-width: 920px) {
  .home-hero, .home-mid, .home-low { grid-template-columns: 1fr; }
}
.ribbon { display: flex; align-items: center; gap: 10px; margin: var(--sp-2) 0 var(--sp-5);
  font-size: var(--fs-sm); }
.ribbon a { color: var(--txt-dim); font-weight: var(--fw-medium); }
.ribbon a.active { color: var(--txt); }
.ribbon .arrow { color: var(--line-strong); }
.ribbon .tail { margin-left: auto; color: var(--txt-mute); }
.needs-me { grid-column: span 12; display: flex; align-items: center; gap: var(--sp-4);
  padding: 14px 18px; border-radius: var(--r-md); border: 1px solid var(--line-strong);
  background: linear-gradient(90deg, var(--accent-soft), rgba(157,139,255,.05)); }
.needs-me.calm { background: var(--surface-2); border-color: var(--line); color: var(--txt-dim); }
```

**The "Action requise" strip is the heart** — the single aggregator of needs-me signals (untriaged flagship opps + freshly-ready briefs). When empty it collapses to a calm `"Rien ne t'attend. Prochaine veille à 06:00."` — the difference between a dashboard that nags and one that reassures.

**The hero Top-opportunité card** reuses the exact opp action handlers (`data-act="greenlight"`) so validating the top pick is doable from Home. Post-action transition: refresh the hero to the next-ranked opp (don't leave the user staring at an empty hero).

### 2.4 Consistent view-header contract

Every view gets the same 3-part header (replaces the ad-hoc per-render `.topbar`), with real breadcrumbs for nested states (`Mes briefs / #4 Soulmask`, `Runs / #12`) replacing the one-off `<a class="back">`.

```
[ breadcrumb if nested ]
[ Title ]                                      [ contextual actions + live-dot ]
one-line "what this view is for" (the current .muted subtitle)
[ segmented filters ]
```

```css
.section-title { display: flex; align-items: center; gap: var(--sp-3);
  font: var(--fw-medium) var(--fs-sm) var(--font-ui); color: var(--txt);
  text-transform: none; letter-spacing: 0; margin: var(--sp-8) 0 var(--sp-4); }
.section-title::after { content: ""; flex: 1; height: 1px; background: var(--line); }
```

---

## 3. Redesigned Opportunity Card

The hero element. Strict 3-level hierarchy, progressive disclosure, a color-coded left rail as the primary scan cue. **Every dynamic class hook (`.opp-score`, `.opp-title`, `.opp-meta`, `.brief-actions[data-sig]`) is preserved byte-for-byte** so `patchOppCard()` is untouched; everything new lives *outside* the patched nodes.

### 3.1 Collapsed row (the 95% state, ~80px)

```html
<article class="opp" data-id="..." role="button" aria-expanded="false" data-score-band="fort">
  <i class="opp-rail"></i>                         <!-- 3px color-coded accent rail -->
  <div class="opp-score good">91<small>/100</small></div>
  <div class="opp-lead">
    <div class="opp-title">…oppTitleHTML(o)…</div>  <!-- patched, unchanged -->
    <div class="opp-thesis">…clamped 1 line…</div>
    <div class="opp-meta">…oppMetaHTML(o)…</div>    <!-- identity chips only; patched, unchanged -->
  </div>
  <img class="opp-img" src="…steam header…" onerror="this.remove()">
  <div class="opp-cta">
    <button class="btn ok" data-act="greenlight">Valider</button>
    <button class="btn icon" data-more aria-label="Plus d'actions">{svg dots}</button>
    <svg class="chev">{svg chevron}</svg>
  </div>
</article>
```

- **3px left rail** (`.opp-rail`, colored by score band) is the fastest "how good is this" cue — you read rail colors down the whole column before reading a word.
- **Score tile** shrinks to a compact 40px squircle with `/100` subscript and a band-matched ring. `scoreClass()` (`flag|good|mid`) maps to `phare|fort|moyen` bands.
- **Title** is the only `--fs-h3` semibold text; rank becomes a faint prefix, not a chip. `-webkit-line-clamp: 2`, full text on `title=`.
- **Thesis**: one clamped dimmed line. **Meta**: only identity chips (`kind`, `source`, ≤1 status badge). The 8-feature breakdown chips, angle/repo chip, steer input and comment textarea all move out of the always-rendered area.
- The **whole header is the expand affordance** (rotating chevron) — drop the separate "Détails" button. Buttons and the sources pill `stopPropagation`.

### 3.2 Progressive disclosure — three tiers

- **Tier A (collapsed):** score, title, thesis, identity chips, primary action.
- **Tier B (on `.opp.open`):** 2-col panel — left = prose (why-now / fit / full sources), right = a compact "scorecard" (top-3 strongest features as mini-bars + the prompt-quality pill) so you get the gist without opening the audit. Brief zone + `.brief-actions` + full decision footer live here.
- **Tier C (nested toggle "Pourquoi ce score"):** the full 8-bar breakdown collapsed behind a one-line button. The noisiest block is now two clicks deep. Driven by a separate `data-bd-open` class so the WS patcher never fights it.

The reject-reason textarea collapses into the `⋯` overflow (revealed by "Pas intéressé"), removing a textarea from every card.

```css
.opp { position: relative; background: var(--surface-2); border: 1px solid var(--line);
  border-radius: var(--r-md); box-shadow: var(--shadow-1), var(--hairline-top); overflow: hidden;
  transition: transform var(--dur-fast) var(--ease-out), border-color var(--dur-fast), box-shadow var(--dur-fast); }
.opp:hover { transform: translateY(-1px); border-color: var(--line-strong);
  box-shadow: var(--shadow-2), var(--hairline-top); }
.opp-rail { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; opacity: 0;
  transition: opacity var(--dur-fast); }
.opp[data-score-band="phare"] .opp-rail { background: var(--phare); }
.opp[data-score-band="fort"]  .opp-rail { background: var(--fort); }
.opp[data-score-band="moyen"] .opp-rail { background: var(--moyen); }
.opp:hover .opp-rail, .opp.open .opp-rail { opacity: 1; }

.opp-head, .opp { /* collapsed row layout */ }
.opp-score { flex: none; width: 40px; height: 40px; border-radius: var(--r-sm); display: grid;
  place-items: center; font: var(--fw-bold) 18px/1 var(--font-ui); }
.opp-score small { font-size: 9px; color: var(--txt-mute); }
.opp-score.flag { color: var(--accent-2); background: rgba(157,139,255,.12); border: 1px solid rgba(157,139,255,.3); }
.opp-score.good { color: var(--ok);  background: var(--ok-soft);  border: 1px solid var(--ok-line); }
.opp-score.mid  { color: var(--warn);background: var(--warn-soft);border: 1px solid var(--warn-line); }
.opp-score.bump { animation: scoreBump 320ms var(--ease-spring); }
@keyframes scoreBump { 0%{transform:scale(1)} 50%{transform:scale(1.12)} 100%{transform:scale(1)} }
.opp-thesis { color: var(--txt-dim); font-size: var(--fs-sm);
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }

/* Tier B / C disclosure: grid-rows animates real content height, no max-height guesswork */
.opp-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--dur-slow) var(--ease-out); }
.opp.open .opp-body { grid-template-rows: 1fr; }
.opp-body > .opp-body-inner { min-height: 0; overflow: hidden; }
.breakdown { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--dur-base) var(--ease-out); }
.opp[data-bd-open] .breakdown { grid-template-rows: 1fr; }
```

> **WS-safety:** because `briefActionsHTML` is re-injected wholesale when `data-sig` changes (destroying the bar element), extend `patchOppCard` so that while `brief_state === 'running'` it patches **only** the bar width + pct text in place (a finer-grained sig), re-injecting the full block only on state transitions. That keeps the bar element stable so its `width` transition fires instead of snapping.

### 3.3 List toolbar, groups, featured shelf

A sticky toolbar above `#opps`: **sort** (Score / Récence / Type / Qualité) + **group** (Aucun / Bande de score / Type / Jeu) + **density** toggle (`⊞`/`▤`). All pure client-side re-derivation from the already-fetched payload — never refetches, never fights WS.

Grouping subdivides `#opps` into `<section class="opp-group" data-group="…">`. `updateOpportunitiesLive()` already queries cards by `data-id` across the container; add `getOrCreateGroup(key)` so new cards land in the right section, and re-evaluate a card's group if its score band changes on patch.

A **"Phares" featured shelf** (horizontal scroll-snap of richer mini-cards with big thumbnail + score) sits above the grouped list when any `o.flagship` exists — the Amazon/Netflix "here's what matters today" pattern.

### 3.4 Tiered action bar (3 button variants only)

One filled primary CTA; everything else tonal or ghost — restoring the hierarchy lost to today's wall of gradients.

```css
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px; border-radius: var(--r-sm);
  font: var(--fw-medium) var(--fs-sm) var(--font-ui); border: 1px solid transparent;
  background: var(--accent-soft); color: var(--accent);
  transition: background var(--dur-fast), border-color var(--dur-fast), transform var(--dur-fast), filter var(--dur-fast); }
.btn:active { transform: translateY(1px) scale(.985); }
.btn.primary, .btn.ok { background: linear-gradient(180deg, var(--accent), var(--accent-press)); color: #07101f; } /* the ONE gradient: Valider / Lancer la veille */
.btn.ghost { background: transparent; border-color: var(--line); color: var(--txt); }
.btn.ghost:hover { border-color: var(--line-strong); background: var(--surface-3); }
.btn.no { background: transparent; color: var(--danger); border-color: transparent; }
.btn.no:hover { border-color: var(--danger-line); }
.btn.icon { padding: 8px; }
.chev { transition: transform var(--dur-base) var(--ease-out); }
.opp.open .chev { transform: rotate(180deg); }
```

Relevance thumbs become two small icon buttons with an active state (filled when `relevance===1/-1`), not text buttons. "Pas intéressé"/"Approfondir" are low-emphasis ghost in the expanded footer.

### 3.5 Chip family — one mixin, kills 12 bespoke hex triplets

Same class names the JS emits (`oppMetaHTML`/`oppTitleHTML` unchanged) — variants just pick a role token + its `-soft`/`-line` pair.

```css
.chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: var(--r-pill);
  font: var(--fw-medium) var(--fs-xs)/1 var(--font-ui); border: 1px solid var(--line);
  color: var(--txt-dim-2); background: var(--surface-3); }
.chip.security, .chip.no-chip, .chip.failed, .chip.needs_human { color: var(--danger); background: var(--danger-soft); border-color: var(--danger-line); }
.chip.performance, .chip.src-web { color: var(--info); background: var(--info-soft); border-color: var(--info-line); }
.chip.refactor, .chip.src-code { color: var(--accent-2); background: rgba(157,139,255,.12); border-color: rgba(157,139,255,.3); }
.chip.flag, .chip.kind.decided { color: var(--accent-2); background: rgba(157,139,255,.12); border-color: rgba(157,139,255,.3); }
.chip.good-chip, .chip.ok-chip, .chip.done, .chip.test-gap, .chip.kind.want { color: var(--ok); background: var(--ok-soft); border-color: var(--ok-line); }
.chip.seen, .chip.lib-upgrade, .chip.bug { color: var(--warn); background: var(--warn-soft); border-color: var(--warn-line); }
.chip.state, .chip.kind.veille { color: var(--accent); background: var(--accent-soft); border-color: transparent; }
```

---

## 4. Redesigned Veille View

Reframe transparency as **a research session you can read like a story**: a sticky left-rail timeline of runs, a center column of grouped favicon-stamped signal cards, and the "non retenu" promoted to an honest, elegant band where the *reason* is the hero.

```
┌ Veille — transparence totale          [● en direct]  ┐
│ Tout ce que le moteur a cherché, lu, et écarté.       │
├──────────────┬────────────────────────────────────────┤
│  RUN RAIL     │  ◇ Angle jump-nav (sticky pills)       │
│  (sticky      │  ▸ Tech & moteurs · 6   [card][card]   │
│   timeline)   │  ▸ Concurrents · 4      [card][card]   │
│  ● 14 juin    │  …                                     │
│  │ 42 req     │  ── Considéré mais non retenu · 12 ──  │
│  │ 180 pages  │     [refusé card — reason is hero]     │
│  │ 9 signaux  │                                        │
│  ○ 13 juin …  │                                        │
└──────────────┴────────────────────────────────────────┘
```

```css
.veille-grid { display: grid; grid-template-columns: var(--rail-w) 1fr; gap: var(--sp-8); align-items: start; }
@container (max-width: 900px) { .veille-grid { grid-template-columns: 1fr; } }

/* run rail = real vertical timeline (replaces .runs-feed) */
.veille-rail { position: sticky; top: var(--sp-4); }
.vtimeline { list-style: none; margin: 0; padding: 0; position: relative; }
.vtimeline::before { content: ""; position: absolute; left: 5px; top: 6px; bottom: 6px; width: 2px;
  background: linear-gradient(180deg, var(--accent), var(--accent-2) 60%, transparent); opacity: .5; }
.vnode { position: relative; padding: 0 0 var(--sp-4) 22px; }
.vnode-dot { position: absolute; left: 0; top: 6px; width: 12px; height: 12px; border-radius: 99px;
  background: var(--txt-mute); border: 2px solid var(--surface-1); }
.vnode.ok .vnode-dot { background: var(--ok); }
.vnode.failed .vnode-dot { background: var(--danger); }
.vnode.running .vnode-dot { background: var(--accent); box-shadow: var(--glow-live); animation: pulse 1.8s infinite; }
.vnode-card { background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-md);
  padding: 11px 13px; box-shadow: var(--hairline-top); }
.vnode.running .vnode-card { border-color: var(--line-strong);
  background: linear-gradient(180deg, var(--accent-soft), var(--surface-2)); }
.vnode-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; font-size: var(--fs-2xs); color: var(--txt-dim); }
.vnode-stats b { color: var(--txt); }

/* angle jump-nav (sticky) */
.angle-nav { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; flex-wrap: wrap;
  padding: 10px 0; background: var(--bg); }
.angle-nav a { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: var(--r-pill);
  font-size: var(--fs-xs); color: var(--txt-dim); border: 1px solid var(--line); }
.angle-nav a.active { color: var(--txt); border-color: var(--accent); background: var(--surface-3); }
.adot { width: 7px; height: 7px; border-radius: 99px; }

/* signal cards — favicon-stamped, auto-fill grid */
.sig-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px; }
.sigcard { display: grid; grid-template-columns: 28px 1fr; gap: 11px; padding: 12px 13px;
  background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-md);
  box-shadow: var(--hairline-top); transition: transform var(--dur-fast) var(--ease-out), border-color var(--dur-fast); }
.sigcard:hover { transform: translateY(-1px); border-color: var(--line-strong); }
.sig-favicon { width: 20px; height: 20px; border-radius: 5px; margin-top: 1px;
  background: var(--surface-1); object-fit: contain; }
.sig-favicon.noico { visibility: hidden; }

/* refusés band — the transparency centerpiece */
.rejected-band { margin-top: var(--sp-5); border-top: 1px dashed var(--line); padding: var(--sp-5);
  background: rgba(245,177,61,.035); border-radius: var(--r-lg); }
.rejected-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 10px; }
.rej { display: grid; grid-template-columns: 40px 1fr; gap: var(--sp-3); padding: 13px 15px;
  background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-md); }
.rej-reason { display: flex; gap: 7px; margin-top: 9px; padding: 7px 10px;
  border-left: 2px solid var(--warn); background: var(--warn-soft); border-radius: 0 7px 7px 0;
  font-size: var(--fs-xs); color: var(--warn); }
.rej-reason.owner { border-left-color: var(--accent-2); background: rgba(157,139,255,.07); color: #c4b5fd; }
```

**Favicon helper** (the single highest-impact "pleasant" upgrade — keyless, no build, graceful):

```js
const favicon = (url) => {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`; }
  catch { return null; }
};
// <img class="sig-favicon" loading="lazy" onerror="this.classList.add('noico')">
```

The angle level is the **only** place we inject per-axis color identity (dots + hover borders), so the page reads as structured intelligence, not a gray scroll. The "non retenu" reason gets an amber left-accent + x icon; owner rejections swap to a violet quote treatment ("tu l'as écarté : « … »") — the engine showing it learned from you. v1 can keep `renderResearch()` as a full render; the flat keyed markup (`data-run-date`, `data-sig-id`, `data-id`) is append-friendly for a future surgical `updateResearchLive()`.

> CSP/privacy note: Google's s2 favicon is a third-party dependency that can be blocked/rate-limited and leaks visited domains. `onerror` degrades gracefully; the longer-term fix is a tiny self-hosted favicon proxy on the API, or a colored monogram fallback from the domain's first letter.

---

## 5. Home Data-Viz (inline SVG/CSS)

All charts are hand-drawn SVG — zero libs, surgical-update-friendly. Numbers patch via `textContent`; shapes patch via attribute (`points`, `stroke-dashoffset`, `--pct`, `width`); CSS transitions do the animation so a targeted patch *animates* instead of flashing.

### 5.1 Sparklines under each KPI

```js
function sparkPoints(vals, w = 120, h = 32) {
  if (vals.length < 2) return '';
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0), span = max - min || 1;
  return vals.map((v, i) =>
    `${(i / (vals.length - 1) * w).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`
  ).join(' ');
}
```

```css
.spark { width: 100%; height: 32px; margin-top: var(--sp-2); display: block; }
.spark-line { fill: none; stroke: var(--accent); stroke-width: 2;
  vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
.spark-area { fill: var(--viz-area); }
```

### 5.2 Budget gauge (radial arc vs ~50 €) — the centerpiece

```html
<svg viewBox="0 0 120 120" class="gauge" style="--pct: 38">
  <defs><linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/>
  </linearGradient></defs>
  <circle class="g-track" cx="60" cy="60" r="52"/>
  <circle class="g-fill"  cx="60" cy="60" r="52"
          stroke-dasharray="326.7"
          stroke-dashoffset="calc(326.7 - 326.7 * var(--pct) / 100)"/>
  <text x="60" y="56" class="g-num">38%</text>
  <text x="60" y="74" class="g-cap">19,80 € / 52 €</text>
</svg>
```

```css
.gauge { width: 120px; height: 120px; transform: rotate(135deg); }   /* start bottom-left */
.g-track { fill: none; stroke: var(--surface-1); stroke-width: 10; }
.g-fill  { fill: none; stroke: url(#gaugeGrad); stroke-width: 10; stroke-linecap: round;
  transition: stroke-dashoffset var(--dur-bar) var(--ease-out); }
.gauge-tile.warn .g-fill { stroke: var(--warn); }
.gauge-tile.crit .g-fill { stroke: var(--danger); }
.g-num, .g-cap { transform: rotate(-135deg); transform-origin: 60px 60px;   /* counter-rotate text */
  fill: var(--txt); text-anchor: middle; }
.g-num { font: var(--fw-bold) 22px var(--font-ui); }
.g-cap { font-size: 9px; fill: var(--txt-dim); }
```

`--pct = Math.min(100, intelMonthUsd / cap * 100)`; `.warn` >80%, `.crit` >95%. Projected "≈ N jours restants au rythme actuel" = pure JS: `(cap - used) / (used / daysElapsed)`.

### 5.3 Combo chart — signals (bars) + opportunities (line), 14 runs

```html
<svg class="chart" viewBox="0 0 560 180" preserveAspectRatio="none" role="img" aria-label="Activité de veille">
  <g class="grid">…4 gridlines…</g>
  <g class="bars">…<g class="col"><rect class="bar"/><title>14 juin · 38 signaux</title></g>…</g>
  <polyline class="ch-line" points="…"/>
  <g class="dots">…<circle/>…</g>
</svg>
```

```css
.chart { width: 100%; aspect-ratio: 560/180; display: block; }
.chart .grid line { stroke: var(--grid-line); }
.chart .bars rect { fill: var(--viz-bar); transition: height var(--dur-base) var(--ease-out); }
.chart .col:hover rect { fill: var(--accent-press); }
.ch-line { fill: none; stroke: var(--viz-line); stroke-width: 2; vector-effect: non-scaling-stroke; }
.chart .dots circle { fill: var(--bg); stroke: var(--accent); stroke-width: 2; }
```

**`vector-effect: non-scaling-stroke` is mandatory everywhere** because `preserveAspectRatio="none"` would otherwise smear strokes on wide screens. Hover tooltip via native `<title>` (free, zero JS) for v1.

### 5.4 "Le moteur a appris" — divergent bars

Promote `learnedBias` from a buried chip line into a first-class card: ↑ green right / ↓ red left, width ∝ `|bias|`, sorted by magnitude.

```css
.learn-row { display: grid; grid-template-columns: 70px 1fr 18px; gap: var(--sp-2); align-items: center; padding: 5px 0; }
.lr-bar { height: 8px; background: var(--surface-1); border-radius: var(--r-pill); display: flex; overflow: hidden; }
.lr-bar span { height: 100%; border-radius: var(--r-pill); transition: width var(--dur-base) var(--ease-out); }
.learn-row.up .lr-bar { justify-content: flex-start; }
.learn-row.up .lr-bar span { background: linear-gradient(90deg, var(--ok), #2faf76); }
.learn-row.down .lr-bar { justify-content: flex-end; }
.learn-row.down .lr-bar span { background: linear-gradient(90deg, #c0455a, var(--danger)); }
```

### 5.5 Empty-data guard

At cold start (0–1 runs) sparklines/charts must show a clean empty state (`"Pas encore assez de données"`), never a flat line or `NaN` in `points`. Debounce `updateHomeLive()` (~500ms) and refetch `/sie/runs` only if `runs.length` changed, so a chatty engine doesn't re-fetch in a loop.

---

## 6. Micro-Interactions & States

### 6.1 Unified progress language (3 live surfaces → 1 vocabulary)

```css
.bar { height: 7px; background: var(--surface-1); border-radius: 99px; overflow: hidden; box-shadow: var(--hairline-top); }
.bar > span { display: block; height: 100%; border-radius: 99px; position: relative;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  transition: width var(--dur-bar) var(--ease-out); }                 /* WS pushes glide */
.bar > span::after { content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.25), transparent);
  animation: sheen 1.6s linear infinite; }                            /* stalled bar still reads alive */
.bar.warn > span { background: linear-gradient(90deg, var(--warn), var(--danger)); }
.bar.indeterminate > span { width: 35% !important; animation: indet 1.4s var(--ease-in-out) infinite; }
@keyframes sheen { 100% { transform: translateX(100%); } }
@keyframes indet { 0%{margin-left:-35%} 100%{margin-left:100%} }
```

Determinate (have %), indeterminate (stage known, no %), pulse-dot (channel open). The veille banner, brief-running strip, and budget cap all use the identical `.bar`. The `.live-dot` stays as the global "this view is streaming" marker, with `role="status" aria-label="Flux en direct actif"`.

### 6.2 Loading skeletons (kill the flash-of-empty)

Split each render so the skeleton paints synchronously *before* the await, then real content swaps in (a cross-fade of the same silhouette, no reflow). **Only on the full-render path — never on `updateOpportunitiesLive`/`updateRunDetailLive`**, or skeletons would flash on every WS tick.

```css
.skel { position: relative; overflow: hidden; background: var(--surface-2); border-radius: var(--r-md); }
.skel::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.045), transparent);
  animation: shimmer 1.25s var(--ease-out) infinite; }
@keyframes shimmer { 100% { transform: translateX(100%); } }
.skel-card { height: 84px; } .skel-line { height: 11px; border-radius: 99px; }
@media (prefers-reduced-motion: reduce) { .skel::after { animation: none; opacity: .5; } }
```

### 6.3 Guided empty states

Three-part: muted SVG glyph in a soft circle, one-line title, helper, **a primary CTA that does the obvious next thing**. Distinguish "nothing yet" (CTA = do the thing) from "filtered to zero" (CTA = reset filters) — the current code can't tell them apart and shows the wrong copy.

```css
.empty-state { display: grid; justify-items: center; gap: var(--sp-3); padding: var(--sp-12) var(--sp-4);
  text-align: center; border: 1px dashed var(--line); border-radius: var(--r-lg); }
.empty-ico { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 50%;
  background: var(--surface-3); color: var(--txt-dim); }
```

### 6.4 Toast stack (keep `toast(msg)` signature)

```js
function toast(msg, kind = 'info') {
  let host = document.getElementById('toasts');
  if (!host) { host = h('<div id="toasts" role="status" aria-live="polite"></div>'); document.body.appendChild(host); }
  const t = h(`<div class="toast t-${kind}">${ICON[kind]}<span>${esc(msg)}</span></div>`);
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  const die = () => { t.classList.add('out'); setTimeout(() => t.remove(), 220); };
  const to = setTimeout(die, kind === 'error' ? 4500 : 2600);
  t.addEventListener('click', () => { clearTimeout(to); die(); });
}
```

```css
#toasts { position: fixed; right: 20px; bottom: 20px; display: flex; flex-direction: column; gap: 10px;
  z-index: var(--z-toast); pointer-events: none; }
.toast { pointer-events: auto; display: flex; align-items: center; gap: 10px; padding: 12px 15px; max-width: 360px;
  background: var(--surface-4); border: 1px solid var(--line-strong); border-left: 3px solid var(--accent);
  border-radius: var(--r-md); box-shadow: var(--shadow-3);
  transform: translateY(8px) scale(.98); opacity: 0; transition: all var(--dur-base) var(--ease-out); }
.toast.in { transform: none; opacity: 1; }
.toast.out { transform: translateX(12px); opacity: 0; }
.toast.t-success { border-left-color: var(--ok); }
.toast.t-error { border-left-color: var(--danger); }
```

Existing call sites unchanged; `api()` error branches pass `'error'`. `aria-live="polite"` announces every toast (toasts are the only feedback for greenlight/reject/copy).

### 6.5 `icon()` helper — replaces the emoji literals

A tiny lucide-subset map returning inline SVG. **Replaces the `✓ ✕ ⚠ ↗ ↑ ↓` literals currently in `app.js`** (gates, done-notes, source links, learned-bias) — they violate the no-emoji rule.

```js
const ICON = { /* check, x, alert, arrow-up-right, arrow-up, arrow-down, radar, file, signal, copy, chevron, dots… */ };
function icon(name) { return ICON[name] || ''; }  // <svg aria-hidden="true" focusable="false" width=16 height=16 stroke=currentColor fill=none stroke-width=2>
```

### 6.6 Interaction contract + accessibility

- 4-state on every interactive: rest → hover (lift + brighten) → active (press `translateY(1px) scale(.985)`) → focus-visible (the one global `--glow-accent` ring).
- `aria-expanded` on every accordion toggle (`.opp`, `.prop`, `.step`), flipped with `.open`; clickable rows get `role="button" tabindex="0"` + Enter/Space.
- Skip link `<a href="#view" class="skip">Aller au contenu</a>`, visually hidden until focused.
- Small-text contrast fix already baked in (`--txt-dim-2`). Icon-only buttons keep `title` **and** get `aria-label`. SVG icons are `aria-hidden`.

### 6.7 Responsive

```css
@media (max-width: 1080px) {                 /* tablet: icon rail */
  .shell { grid-template-columns: 64px 1fr; }
  .nav a span, .brand small, .nav-group, .side .foot { display: none; }
  .nav a { justify-content: center; }
}
@media (max-width: 720px) {                  /* mobile: off-canvas drawer + app-bar */
  .shell { grid-template-columns: 1fr; }
  .side { position: fixed; inset: 0 auto 0 0; width: 264px; transform: translateX(-100%);
    transition: transform var(--dur-base) var(--ease-out); z-index: var(--z-drawer); }
  .side.open { transform: none; box-shadow: var(--shadow-3); }
  .scrim { position: fixed; inset: 0; background: rgba(0,0,0,.5); opacity: 0; pointer-events: none;
    transition: opacity var(--dur-base); z-index: var(--z-scrim); }
  .scrim.show { opacity: 1; pointer-events: auto; }
  .appbar { display: flex; }                 /* sticky top bar + hamburger, hidden on desktop */
  .main { padding: var(--sp-4); }
  #toasts { left: 12px; right: 12px; bottom: 12px; }
  .bd-row { grid-template-columns: 1fr auto; }
}
```

Drawer listeners (click/Esc/scrim) must be idempotent across `renderShell()` rebuilds to avoid duplicates. A `@container (max-width:460px)` query on `#opps` collapses score+thumb+title into one compact header line.

---

## 7. Phased Build Plan

### Phase 1 — Design system + nav + opportunity card *(transforms the feel on its own)*
1. Paste the token block (§1) over `:root`; keep legacy aliases so nothing breaks. Set `<html lang="fr">`, title → "Servitium Intelligence". Optional `@font-face` for Inter + JetBrains Mono.
2. Apply base treatments: card hairline-top + translucent borders + hover lift; three-variant button system; chip role-token collapse; `.bar` width-transition + sheen; sentence-case `.section-title`; tabular-nums token; global `:focus-visible` ring + `prefers-reduced-motion` reset.
3. Restructure the sidebar into grouped nav with icons, badges, the pinned `.rail-cta`, the canonical spend footer, and the collapsible Build group (auto-expand on active run). Add `role/tabindex/keydown`.
4. Rebuild the opportunity card: left accent rail + 40px score tile + clamped thesis + identity-only meta; Tier B `grid-rows 0fr→1fr` panel with scorecard; Tier C nested breakdown toggle; tiered action bar; `.bump` on score patch + finer-grained brief-running sig in `patchOppCard`. List toolbar (sort/group/density) + `getOrCreateGroup` + Phares shelf.
5. `icon()` helper replacing the emoji literals; toast stack (same signature, error variant on `api()` errors).

*Outcome:* the dashboard already reads as a premium product. No new endpoints, WS contract untouched.

### Phase 2 — Home / Accueil + data-viz
6. `VIEW='home'` default; `renderHome()`/`updateHomeLive()`; pipeline ribbon; the 3-band grid; "Action requise" strip; reused hero opp card with next-pick transition.
7. SVG helpers (`sparkPoints`, `setGauge`, `barChart`); KPI sparklines; radial budget gauge; combo chart; divergent learned-bias card. Empty-data guards + ~500ms debounce + nav-badge live patching.

### Phase 3 — Veille polish
8. `favicon()` helper; rewrite `renderResearch()` into the sticky run-rail timeline + angle jump-nav + auto-fill favicon signal grid + per-angle color identity + the warm "non retenu" band with reason-as-hero (owner-quote variant). Keep flat keyed markup for a later surgical `updateResearchLive()`.

### Phase 4 — States, responsive & a11y finishing layer
9. Loading skeletons on every full render (not on surgical paths); guided two-variant empty states with CTAs; unified determinate/indeterminate progress everywhere; one-shot count-up + bar-grow mount animations (fresh nodes only).
10. Icon-rail (tablet) + off-canvas drawer/app-bar (mobile) + reflows; skip link; `aria-expanded`/live-regions/keyboard across accordions; container query on `#opps`.

---

### Cross-cutting invariants (do not violate)
- Keep new structure **outside** the WS-patched nodes (`.opp-score`, `.opp-title`, `.opp-meta`, `.brief-actions[data-sig]`); restyle in place only.
- Accordions stay `display`/`grid-rows` class toggles — never height-animate on the patched element, WS fires mid-interaction.
- The `applyChanged` "don't clobber typing" guard (`document.activeElement` TEXTAREA/INPUT) is preserved as-is; the live-dot must stay pulsing so paused updates don't look frozen.
- One spend number in the chrome; delete duplicate KPI/spend blocks from view bodies.
- Every new string ships French; no emoji (inline SVG only); never name internal infra in user copy.
```

---

# CRITIQUE & PHASE 1

I've now read all three files in full. The spec's claims about class names, JS functions, and WS-patching internals check out against reality. I can critique with confidence, flagging the spots where the spec is wrong about the actual code.

## Critique

A top product designer at Google/Apple, after using this for ten minutes, would sign off on the *direction* but push back hard on these points. Several are not just taste — they are factual errors about the code in this repo that would break the build or fight the WebSocket updates.

**Hierarchy & restraint — the spec still over-builds Home.**
- The "Action requise" strip, the pipeline ribbon, *and* the greeting line all live above the fold competing for the same "orient me" job. That's three orientation devices stacked. Apple would keep exactly one. Kill the pipeline ribbon (it's decorative IA that restates the nav) and the greeting prose ("Bonjour. Le moteur a tourné…"). Keep only the "Action requise" strip — it's the one element that earns its pixels because it's the sole place needs-me signals aggregate.
- Five distinct dataviz treatments on Home (sparklines + radial gauge + combo chart + divergent bars + recent-feed) is a *chart museum*, not a dashboard. The combo chart (bars + line, dual-encoding signals and opportunities) is the single most over-designed element in the whole spec: dual-axis combo charts are a known comprehension trap, and with the real data (`/sie/runs` is a flat list, typically a handful of runs at cold start) it will render two or three lonely bars. Cut it for v1. The radial budget gauge is also gimmick territory — a gauge encodes one number worse than a labelled linear bar does, and you *already have* a perfectly good `.bar` component for exactly this. Ship the linear bar you already have; the gauge is motion for motion's sake.
- Net: Home should be KPI tiles (with sparklines, the one cheap win) + Action-requise strip + the reused top-opportunity card + a recent-activity feed. That's a world-class overview. The charts are Phase-2-maybe, not Phase-2-must.

**Consistency — the spec is internally inconsistent and factually wrong in spots.**
- It defines `.btn.ok` as *both* the green "Valider" success button (existing `app.js` semantics: `data-act="greenlight"`, `data-brief`, `data-copy`) *and* re-skins `.btn.ok` to the **blue** primary gradient (`.btn.primary, .btn.ok { background: linear-gradient(180deg, var(--accent)…) }`). But `.btn.ok` is used all over `app.js` for *generate-brief / copy-prompt / approve*, not just the hero CTA. Recoloring every `.ok` button blue erases the green = "go/validate" semantics the product relies on. This is a real regression, not a nuance. The hero CTA must get a **new** class (`.btn.primary`), and `.btn.ok` must stay green.
- The chip mixin collapses `.chip.kind.want` and friends, but the existing CSS already binds `.chip.kind.want, .chip.kind.can` to green and `.chip.kind.veille` to accent. The spec's new chip rules don't account for `.chip.high/.medium/.low` (impact chips in `propCard`) or `.chip.outcome.run/.ok/.bounced/.err` (run steps). A blanket chip refactor that misses these will leave the legacy Build views with broken chip colors. The chip system can be unified, but the migration must enumerate *every* existing chip variant, not a representative sample.

**The WS-surgical claims are the most dangerous part — two are wrong about this code.**
- The spec says "extend `patchOppCard` so that while `brief_state === 'running'` it patches only the bar width + pct text." But look at the actual sig: `const sig = \`${o.brief_state||''}|${o.has_brief?1:0}|${o.brief_progress||0}|${o.detail||''}\``. `brief_progress` and `detail` are **already in the sig**, so every progress tick *already* changes the sig and *already* re-injects the whole `.brief-actions` block via `ba.innerHTML = …` + `wireBriefActions`. That means today the running bar **snaps** instead of gliding, and the spec's "finer-grained sig" is the correct fix — but the spec misdescribes it as an addition when it's actually a *rewrite* of the existing sig logic. Concretely: drop `brief_progress` and `detail` out of the sig, and when state is `running` patch `.bar > span` width + `.brief-pct` text in place. Get this detail right or the headline "smooth progress bar" never materializes.
- The spec proposes grouping `#opps` into `<section class="opp-group">` subsections and a "Phares shelf" above the list. But `updateOpportunitiesLive()` does `container.querySelectorAll('.opp')` and `container.appendChild(n)` directly on `#opps`. Introducing intermediate group `<section>`s *and a shelf that duplicates flagship cards* breaks two invariants at once: (a) `appendChild` now drops new cards at the bottom outside any group, and (b) a flagship opp would exist as **two** `.opp[data-id]` nodes (shelf + list), so `patchOppCard`'s `querySelector('.opp[data-id="X"]')` patches only the first and the dedupe `seen` logic removes the wrong one. Grouping and the shelf are real surgical-update hazards. For v1, **client-side sort only** (reorder is a no-op risk because WS appends to bottom anyway — actually even sort fights append). Honestly: skip grouping/shelf entirely in Phase 1. They're the highest-risk, lowest-leverage items in the spec.

**Things that are not buildable as described / fight the runtime:**
- `font-feature-settings: "cv05" 1, "ss03" 1` only does anything with Inter loaded; on the system fallback it's inert (harmless, but don't claim it as a treatment). Fine to keep, just not load-bearing.
- The favicon helper depends on `https://www.google.com/s2/favicons` — a third-party network call on a dashboard explicitly marked `noindex`/internal, behind a login. The spec itself flags the CSP/privacy concern but then still puts it in Phase 3 as the "highest-impact pleasant upgrade." It's a leak of which domains the engine reads, to Google, on every Veille render. A colored monogram from the domain's first letter (zero network, deterministic color via a hash) is *strictly better* here and just as pretty. Drop the Google dependency entirely.
- The `grid-template-rows: 0fr → 1fr` accordion animation is genuinely good and buildable — but the spec keeps the existing `display:none → block` toggle pattern in `wireOpp` (`card.classList.toggle('open')`). You can't animate `grid-rows` if the parent is `display:none`. The opp body must switch from `display:none` to the grid-rows technique *and* the inner wrapper `<div class="opp-body-inner">` must actually be added to `oppCard()` markup. The spec shows the CSS but the markup change to `oppCard()` is only implied. Minor, but it's the difference between "animates" and "nothing happens."
- `--fw-regular: 440` etc. (custom numeric weights) only render on variable Inter. On the `system-ui` fallback the browser snaps to 400/500/700 — so the carefully-chosen 440/540/680 are aspirational unless you actually ship `InterVariable.woff2`. Either commit to self-hosting the font (one `@font-face`, ~100KB woff2, no network dep) or use 400/500/700 and stop pretending.

**Motion — mostly disciplined, two excesses.** The `.bar > span::after` sheen animating *infinitely* on every progress bar (including the budget cap bar, which is static) is restless — a static 30%-full budget bar shouldn't shimmer forever. Scope the sheen to `.bar.indeterminate` and running states only. The `scoreBump` spring on every WS score patch is nice once but will fire on *every* tick if the score oscillates; gate it to fire only when the score actually changes value (compare old `textContent` before setting).

**Contrast — the one real accessibility fix is correctly identified.** `--txt-dim: #97a0b5` on `--panel` is ~4.0:1, under-spec for the 11–12px chip/label text everywhere. The spec's `--txt-dim-2: #aab3c7` for small text is the right call. Just apply it consistently — `.kpi .label`, `.opp-thesis`, `.muted.small`, chip text — not only "where chips live."

**Bottom line:** the token system, the opportunity-card redesign, the button/chip/elevation/focus discipline, and the toast/icon helpers are the real ~80% of the perceived-quality jump and are all low-risk. The Home charts, grouping, favicon, and gauge are the risky, over-designed 20% — defer or cut them. Ship the foundation first; it transforms the feel with near-zero chance of breaking the live updates.

## Phase 1 build checklist

The goal of Phase 1: maximum perceived-quality leap, **zero** risk to WS surgical updates, no new endpoints, no new views. Everything below restyles existing nodes or adds markup strictly *outside* the patched ones (`.opp-score`, `.opp-title`, `.opp-meta`, `.brief-actions[data-sig]`, `.kpi .value`, `#opps`, `#veille-banner`, `.bar > span`).

**1. Token block (drop over `:root`, keep legacy aliases).** Ship exactly these, no more:
```css
:root{
  /* type — use 400/500/700 unless you also ship InterVariable.woff2 */
  --font-ui:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace;
  --fs-h1:22px; --fs-h2:17px; --fs-h3:15px; --fs-base:14px; --fs-sm:13px; --fs-xs:12px; --fs-2xs:11px;
  /* elevation ramp */
  --bg:#0a0c12; --surface-1:#11141d; --surface-2:#161a25; --surface-3:#1c2130; --surface-4:#232838;
  --line:rgba(255,255,255,.07); --line-strong:rgba(255,255,255,.12); --hairline-top:inset 0 1px 0 rgba(255,255,255,.05);
  --bg-2:var(--surface-1); --panel:var(--surface-2); --panel-2:var(--surface-3); /* legacy aliases */
  /* text — note the brighter small-text token */
  --txt:#eef1f7; --txt-dim:#9aa3b8; --txt-dim-2:#aab3c7; --txt-mute:#6b7488;
  /* accent + semantic (keep green=go, never recolor) */
  --accent:#7aa2ff; --accent-press:#5b86f0; --accent-2:#9d8bff; --accent-soft:rgba(122,162,255,.14); --accent-ring:rgba(122,162,255,.45);
  --ok:#46d39a; --ok-soft:rgba(70,211,154,.12); --ok-line:rgba(70,211,154,.28);
  --warn:#f5b13d; --warn-soft:rgba(245,177,61,.12); --warn-line:rgba(245,177,61,.28);
  --danger:#ff6b81; --danger-soft:rgba(255,107,129,.12); --danger-line:rgba(255,107,129,.28);
  --info:#5bc8ff; --info-soft:rgba(91,200,255,.12); --info-line:rgba(91,200,255,.28);
  --green:var(--ok); --amber:var(--warn); --red:var(--danger); /* legacy aliases */
  /* spacing / radius / shadow / motion */
  --sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-5:20px;--sp-6:24px;--sp-8:32px;
  --r-sm:8px; --r-md:12px; --r-lg:16px; --r-pill:999px; --radius:var(--r-md);
  --shadow-1:0 1px 2px rgba(0,0,0,.4); --shadow-2:0 4px 12px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.04);
  --shadow-3:0 12px 32px -8px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.06); --glow-accent:0 0 0 3px var(--accent-ring); --shadow:var(--shadow-1);
  --ease-out:cubic-bezier(.16,1,.3,1); --ease-spring:cubic-bezier(.34,1.56,.64,1);
  --dur-fast:120ms; --dur-base:180ms; --dur-slow:240ms; --dur-bar:420ms;
}
```
Plus the three globals: `body{background:var(--bg);font-family:var(--font-ui)}` (drop the radial-gradient body bg — it muddies the new flat elevation ramp), one `:where(a,button,input,textarea,[tabindex]):focus-visible{outline:none;box-shadow:var(--glow-accent)}` ring (replaces every ad-hoc `:focus{border-color}`), and the `prefers-reduced-motion` reset. Set `<html lang="fr">`. **Skip** the custom numeric font-weights and `font-feature-settings` unless you self-host Inter in the same PR.

**2. Card + surface + chip + button treatments (pure CSS, no JS, no markup change).**
- `.card, .opp, .prop, .step, .veille-banner, .run-line, .nr`: `background:var(--surface-2); border:1px solid var(--line); box-shadow:var(--shadow-1),var(--hairline-top)`. Add a hover lift only to interactive cards (`.opp:hover, .run-row:hover, .prop:hover{transform:translateY(-1px);border-color:var(--line-strong);box-shadow:var(--shadow-2),var(--hairline-top)}`) with `transition:transform var(--dur-fast) var(--ease-out),border-color var(--dur-fast),box-shadow var(--dur-fast)`.
- Buttons: keep `.btn.ok` **green**, `.btn.no` danger-ghost, `.btn.ghost` neutral. Add a **new** `.btn.primary` for the blue hero CTA — do **not** recolor `.btn.ok`. Add `.btn:active{transform:translateY(1px) scale(.985)}` to all.
- Chips: enumerate and migrate **every** existing variant to the role-token pattern (`color/background/border` from one `--role`/`-soft`/`-line` triple): `.security/.no-chip/.failed/.needs_human`→danger, `.performance/.src-web`→info, `.refactor/.src-code/.flag/.kind.decided`→accent-2, `.good-chip/.ok-chip/.done/.test-gap/.kind.want/.kind.can`→ok, `.seen/.lib-upgrade/.bug/.high`→warn, `.state/.kind.veille/.outcome.run`→accent, base chip→`--surface-3` + `--txt-dim-2`. Don't leave `.medium/.low/.outcome.bounced/.outcome.err` unstyled.
- Sentence-case the section titles: `.section-title{text-transform:none;letter-spacing:0;color:var(--txt);font-weight:600}` with the trailing hairline (`::after{content:"";flex:1;height:1px;background:var(--line)}`). Keep uppercase **only** on the tiny eyebrow labels (`.kpi .label`, `.bd-title`, `.nav-sep`, `.lb-date`, `.ao-k`, `.diff-title`).

**3. Sidebar restructure (markup in `renderShell` + CSS).** Grouped nav (`PILOTAGE` / `TRANSPARENCE` / `BUILD · SECONDAIRE`), active-item left accent bar (`.nav a.active::before`), inline-SVG icons via the new `icon()` helper, and the **pinned primary CTA** (`.btn.primary` "Lancer la veille") moved from the Opportunités topbar into the rail so it never scrolls away. Add `role="link" tabindex="0"` + Enter/Space keydown to nav anchors. Add count badges (`.nav-badge.hot` = `openOpportunities`) — fetch once in `renderShell`, patch in `applyChanged`. Move the spend chip to the rail footer and **delete the duplicate** `Dépense intel` KPI from `renderOpportunities`. (Defer the collapsible-Build disclosure and live-dot-in-nav to Phase 2 — they touch routing.)

**4. Opportunity card — the hero, restyled in place (markup change confined to `oppCard()`, patched nodes untouched).**
- Add `<i class="opp-rail">` (3px score-band accent), set `data-score-band` from `scoreClass()` (`flag→phare`, `good→fort`, `mid→moyen`). Shrink `.opp-score` to a 40px squircle with the new `-soft`/`-line` band rings. Clamp `.opp-thesis` to one line; keep `.opp-meta` to identity chips.
- Replace the `display:none→block` body toggle with the `grid-template-rows:0fr→1fr` technique **and add the `<div class="opp-body-inner">` wrapper inside `.opp-body`** in `oppCard()` markup (without it the animation no-ops). Rotate a chevron on `.opp.open`.
- Move the **8-bar breakdown** behind a nested `data-bd-open` toggle (two clicks deep), and move the reject-reason `<textarea>` out of the always-rendered footer into the expanded area. Both reduce the noisiest blocks without touching the patched nodes.
- **Fix the brief-running bar so it glides:** rewrite the `patchOppCard` sig to *exclude* `brief_progress` and `detail`; when `brief_state==='running'`, patch `.bar > span` width and `.brief-pct` text in place instead of re-injecting `.brief-actions`. Re-inject the full block only on a true state transition. This is the single highest-value WS fix.
- Gate `.bump` (score spring) to fire only when the score value actually changed (compare `sc.textContent` before assignment).

**5. Helpers + micro-states (additive, signatures preserved).**
- `icon(name)` → inline-SVG lucide subset; use it to **replace the `✓ ✕ ⚠ ↗ ↑ ↓` emoji literals** in `app.js` (gates, done-notes, source links, learned-bias arrows) — they violate the no-emoji rule today.
- Upgrade `toast(msg, kind='info')` to the stacked, `aria-live="polite"`, auto-dismiss, click-to-dismiss version (keep the 1-arg call sites working; pass `'error'` from `api()`'s error branches).
- `.bar > span{transition:width var(--dur-bar) var(--ease-out)}` so every WS-pushed width change glides. Scope the shimmer/sheen to `.bar.indeterminate` only — do **not** animate it on static bars.

**Explicitly deferred out of Phase 1 (the risky/over-designed 20%):** Home/Accueil view + all dataviz (gauge, combo chart, divergent bars), opp-list grouping + Phares shelf, favicon fetch (use a monogram fallback when you do build Veille), loading skeletons, off-canvas mobile drawer. None of these are needed for the dashboard to read as world-class, and each one carries real WS-patching or third-party-dependency risk.

Relevant files: `e:/Servitium Project/servitium-autodev/src/dashboard/web/styles.css`, `e:/Servitium Project/servitium-autodev/src/dashboard/web/app.js`, `e:/Servitium Project/servitium-autodev/src/dashboard/web/index.html`. The load-bearing code facts: the brief-running sig at `app.js:326` already contains `brief_progress`+`detail` (so it re-injects and snaps — must be rewritten, not extended); `.btn.ok` is reused for greenlight/brief/copy/approve (so it must stay green, add a separate `.btn.primary`); `updateOpportunitiesLive` queries/append directly on `#opps` (so grouping and a flagship shelf would create duplicate `.opp[data-id]` nodes and break dedupe/patch).