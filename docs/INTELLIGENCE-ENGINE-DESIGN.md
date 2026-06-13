# Servitium Intelligence Engine (SIE) — Build Spec

A second, proactive loop inside the `servitium-autodev` daemon. AutoDev is reactive
(GitHub `auto` issue → FSM → draft PR). SIE is its mirror: **daily web veille → scored,
ranked, SOURCED opportunities → deep concrete brief → copy-paste prompt the owner runs on
his flat-rate Max plan**. Same process, same `autodev.db`, same `Ledger`, same dashboard,
same Anthropic key, separate budget scope.

## Non-negotiables (inherited from AutoDev)
- Code owns the workflow; the LLM only fills a step. Code computes the final score/rank, never the LLM.
- Token-free gates do the cheap deterministic work (dedup, ranking, rendering). LLM = extraction + judgment only.
- Opus only where it earns it (deep investigation of greenlit items). Haiku = firehose, Sonnet = workhorse.
- SIE emits TEXT, never code. It never auto-spends an expensive deep dive without a human greenlight.
- Additive migrations only; SIE never touches the FSM tables (`task`/`step`/`gate_result`).
- One shared `Ledger` with an `intel` scope → the ~50€/mo intel cap can't starve (or be starved by) the build lane.

## The quality bar — CONCRETE, never vague
A brief must be an instruction dossier, not an idea. Gold standard (owner's words):
> NOT "on pourrait intégrer Rust" — but "les joueurs Rust veulent un shop; jouable via RCON;
> voici la clé `.ini` qui change; on récupère le SteamID via commande X; don d'item via
> `inventory.giveto <id> <item>`; limites: …". Directly actionable or it failed.

## Two expensive things, split by budget
- **Deep investigation** (research feasibility → the concrete RCON/.ini-level brief) — gated to opportunities the owner GREENLIGHTS, budgeted per-investigation.
- **Implementation** (actually build it) — always a copy-paste prompt the owner runs MANUALLY on Max (flat rate). The API budget never builds.

---

## Scoring — explainable, code-computed (the heart)
Each opportunity = **8 features in [0,1]**, extracted by a Sonnet scorer into a persisted
`feature_json`; **code** computes the 0–100 score. Every past opportunity is replayable
against any weight set for free → ranking is deterministic + auditable, never a vibe.

| feature | 0 vs 1 | weight |
|---|---|---|
| strategic_fit | off-mission (we'd become a hoster) vs dead-center deep-admin | 0.22 |
| demand_evidence | no signal vs cited competitor gaps / forum pain (must cite ≥1 source) | 0.20 |
| feasibility | needs infra we lack vs drops into an existing app | 0.16 |
| effort_inv | inverse effort (1=days, 0=quarters) | 0.12 |
| revenue_proximity | free-tier only vs clean Pro upsell / new billable line | 0.12 |
| moat_or_diff | trivially copyable vs leverages our agent+Rust+Discord lib | 0.08 |
| reversibility | irreversible vs cheap to try and abandon | 0.06 |
| freshness | already-known vs net-new (anti-rehash) | 0.04 |

`base = 100·Σ wᵢ·featureᵢ`, then clamped modifiers: confidence (evidence coverage),
momentum (corroborated persistent signals rise), recency decay (stale sinks), fit-guard
(off-mission halved), feasibility floor. Thresholds: ≥65 shown, 40–65 parked, <40 archived,
≥85 + game/business = flagship. **An axis with no evidence is clamped ≤0.3** (kills score-gaming).
Re-ranking is token-free → a new signal or a weight tweak reshuffles the backlog instantly, free.

## The copy-paste Max prompt (the economic linchpin)
A fixed `renderMaxPrompt(slots)` template, hard-constraints block imported VERBATIM from
`agents/prompts.ts` CONVENTIONS (so the manual prompt can never drift from the autonomous one).
Slots: verdict, target app, capability slice, why-now + sources, unknowns to spike first,
approach steps (naming real files), out-of-scope, acceptance criteria (1:1 with tests), test
strategy, verify commands, review checklist. Owner pastes it into Claude Code Max → free build.

## Transparency dashboard (non-negotiable, WS)
Per-investigation live TRACE: every search query typed, every source URL opened (clickable),
every reasoning step, every sub-agent, cost per step. Opportunity cards show the 8-bar score
breakdown × weights + the per-axis justification + evidence `↗` links + **Copy Max prompt** +
accept/reject/comment + a thumbs-up/down on *signal relevance*. A "seen ~3 weeks ago" line on
anything resurfaced (repetition is the #1 reason this kind of feature gets abandoned). One KPI:
"Intel spend $X / $45 this month" + "last run: Nh ago, status". Rides the existing 1s
SQLite-fingerprint WS broadcast — no new transport/auth.

---

## Phased build plan (critique-tightened: prove the feed before building what learns from it)

### Phase 0 — "Does the veille produce something I'd actually read?"
The smallest honest slice that already delivers value daily.
- **3 tables**: `sie_run` (idempotency + cost + status), `signal` (+ source_url/domain/seen_before columns), `opportunity` (feature_json, score, brief_md, max_prompt, status, comment, relevance). `spend_ledger.scope` via `ensureColumn`. Weights = a config constant (not a table yet).
- **Grounding = paste, not agent**: one dossier blob seeded manually from CLAUDE.md + MEMORY.md. No KB-refresh machinery.
- **Pipeline (6 stages, mostly token-free)**: PLAN (code, ~5 angles, empty lanes allowed) → HARVEST (Haiku + WebSearch) → FETCH (host fetch + readability; WebFetch fallback) → EXTRACT (Haiku, batched) → IDEATE+SCORE (1 Sonnet/day: dedup vs last-30-days + open opps, ≤5 candidates with the 8 features) → RANK+PUBLISH (token-free).
- **Deep investigation on GREENLIT items** (the centerpiece): a budgeted multi-step dive → concrete brief (RCON/.ini level) + the Max prompt. Gated by the owner's click so Opus spend stays sane.
- **Dedup** = canonical-URL + lowercased-title exact (no SimHash). `seen_before` drives the "seen 3 weeks ago" line.
- **Budget hard + visible**: `ledger.subStatus('intel', caps)`; per-run abort skips the deep dive first; `SIE_MONTHLY_CAP_USD=45` (EUR headroom for Opus variance); a `PushNotification` ping on run-done + on any capped run.
- **Dashboard**: Opportunities + Logbook views only; the score-breakdown expander, evidence links, Copy Max prompt, relevance thumbs + accept/reject/comment (each writes an append-only `intel_decision` row — banks training data for later, no consumer yet).
- **Scheduler**: in-process daily UTC tick beside the poll loop + a manual "run now" button.
- **4 green tests**: score-gate (rubric math + tie-break), sie-dedup, intel-pipeline (scripted-query stage transitions + budget abort), sie-budget (intel/build scope isolation).

**Gate after ~2 weeks running**: relevance thumbs-up >~40% AND ≥1 Max prompt copied? If no → fix sensing quality, do NOT build learning. If yes → proceed.

### Phase 1 — trustworthy + self-grounding (only if Phase 0 earns it)
Lightweight weekly Sonnet dossier refresh (reads CLAUDE.md + MEMORY.md + 5 READMEs, rewrites the blob — one call/week). Manual weight-tuning UI (edit the 8 weights from the dashboard, free re-rank — this is the owner's "learning loop" for months). Cost hardening: per-stage spend, visible mid-run abort, slop-domain blocklist.

### Phase 2 — actual learning (only after ≥30 real decisions AND proven relevance)
Few-shot exemplars first (works at low N): last 4 accepts + 4 rejects-with-comment into the cacheable prefix. Then — only if exemplars aren't enough and N is genuinely ≥30 — bounded weight calibration (logistic blend + clamps + hold-out gate + baseline reset + audit row), treated with suspicion at low N (manual override stays primary). Preference cards (`approved_at NULL` gated). Learning dashboard panel.

### Cut / deferred indefinitely (bring back only against measured need)
category_bias, versioned exemplar sets + pin/ban, calibration narration, exploration slot,
per-lane diversity quotas + ≥4-lane rule (let lanes be empty — quotas manufacture mediocrity
when signal is lopsided), SimHash dedup, separate fetch_cache/signal_source tables,
evidence-hash KB drift detection, roadmap auto-flip, "Queue as mission → GitHub auto",
resurface-delta logic, embeddings/vector dedup, RLHF, hourly veille, cost forecaster.

## Honest cost notes
Daily sensing ~$1.75 (extract is the token-heaviest; Opus deep dives are the real exposure).
At 50€/mo the deep investigations must be gated to greenlit items — expect ~15-25 deep
concrete briefs/month, not unlimited. The biggest lever is how many deep dives/day; the second
is prompt-caching the static grounding prefix. The KB + learning layers are near-free code and
net cost-SAVING (they steer the expensive spend onto on-target opportunities).
