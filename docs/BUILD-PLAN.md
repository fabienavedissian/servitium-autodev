# AutoDev — v1 Build Plan (revised after adversarial review)

Target: an autonomous, chain-of-agents engineering loop that turns GitHub issues
labelled `auto` into merge-ready DRAFT PRs on **`servitium-api` only**, with near-zero
regression. No auto-merge, no prod deploy. Built on `@anthropic-ai/claude-agent-sdk`,
billed via a dedicated Anthropic Console API key. Budget ~90-100 EUR/month.

> **Revision note.** This is the post-red-team version. A 5-critic adversarial pass
> (which read the real servitium-api) corrected: gate runners are an RCE surface (now
> sandboxed); the cost estimate was ~3x optimistic (now re-stated as a measured range);
> the implementer could weaken TDD tests (now frozen); coverage was whole-repo aggregate
> (now changed-lines); and several false repo assumptions (tsconfig not strict, specs
> colocated under `src/`, no eslint config, jest already enforces 70% coverage,
> `env.production` is git-tracked). All are folded in below.

This document is the spec to validate BEFORE any code is written.

---

## 0. Scope & non-goals (v1)

**In scope**
- One target repo: `servitium-api` (the only repo with a trustworthy test gate).
- Full agent chain: triage -> spec -> TDD -> implement -> review -> challenger ->
  red-team -> security -> final-review -> validator -> draft PR.
- In-process gates run inside a **locked-down sandbox**: jest, tsc (repo config),
  eslint, coverage (changed-lines), npm audit, semgrep, gitleaks, scope-diff,
  test-immutability, revert-and-rerun relevance.
- Guardrails: no-raw-bash agents, multi-layer scope guard, test freeze, turn/loop caps,
  per-task budget, monthly kill-switch, git checkpoints, LESSONS.md.
- GitHub issues as the queue; draft PR as the output. Fine-grained PAT scoped to
  `servitium-api` only, without merge/workflow rights.
- Minimal IP-gated dashboard (phase 1.5): runs view + spec/PR approval + comment channel.

**In scope because the red-team required it (was wrongly deferred before)**
- A per-gate **sandbox** (no network, non-root, worktree-only mount). Concurrency-1 +
  SQLite does NOT provide process isolation; the test runner is hostile code.

**Explicit non-goals (deferred to v2/v3)**
- Cross-repo contract checks (v2). The 5 other repos, especially Angular/Karma (v3).
- Feature-proposal mode + Discord integration bot (v2).
- Real game-server provisioning, Windows VM (v3, behind `needs-game-env`).
- Postgres/Redis, full mutation/property testing (deferred; SQLite + worktrees + the
  single revert-and-rerun check suffice at concurrency 1).

**Host precondition (confirmed):** AutoDev runs on a dedicated, reformattable box that
is NOT the prod VPS and has no credentials or network route to prod Mongo/API.

---

## 1. Repository layout (`servitium-autodev`)

```
servitium-autodev/                # its own GitHub repo; CJS/NodeNext (not ESM) to avoid ts-jest+native friction
  package.json  tsconfig.json  .env.example  ecosystem.config.cjs  README.md
  src/
    index.ts                      # scheduler boot + single-flight lock
    config.ts                     # env load + validate (zod), price map
    log.ts                        # pino, per-task child logger
    db/ schema.sql db.ts repos.ts # better-sqlite3
    fsm/ states.ts machine.ts resume.ts
    agents/ roles.ts prompts/ run.ts
    sdk/ client.ts hooks.ts mcp/{runGate,git,github,spend,lessons}.ts
    gates/ index.ts jest.ts tsc.ts lint.ts coverageDiff.ts audit.ts semgrep.ts gitleaks.ts scopeDiff.ts immutability.ts relevance.ts
    sandbox/ run.ts               # bubblewrap/firejail (or container) wrapper for ALL gate subprocesses
    git/ worktree.ts mirror.ts scopeGuard.ts   # scopeGuard.ts is TCB (human-only)
    cost/ prices.ts ledger.ts
    context/ prefix.ts repoMap.ts
    github/ client.ts queue.ts
  dashboard/ api/ web/
  scripts/ sdk-smoketest.ts seed-baseline.ts
  test/                           # AutoDev's own jest suite
```

---

## 2. Runtime & processes

- Node 20, TypeScript, **CJS/NodeNext** (AutoDev itself is not ESM; avoids ts-jest +
  better-sqlite3 native-module friction flagged in review).
- Single orchestrator under PM2 (`autodev-orchestrator`), dashboard as a 2nd process.
- **Concurrency 1** with an explicit **single-flight lock** (a SQLite row or lockfile
  checked at the top of every poll): a cron tick while a task runs is a no-op.
- Scheduler: `node-cron`, poll every `POLL_INTERVAL_MIN` (default 15 min). No continuous loop.
- **Every gate subprocess runs inside the sandbox** (s9). The orchestrator process holds
  the secrets; the sandboxed children never see them.
- AutoDev ships with its own green jest suite (same rule as the API).

---

## 3. Configuration & secrets

`/srv/autodev/.env`, owner `autodev`, chmod 600, **outside any worktree-reachable path**.
Loaded once at boot, validated with zod. Never mounted into the gate sandbox.

| Key | Use | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | SDK auth | Dedicated Console key. Orchestrator process only; absent from sandbox. |
| `GITHUB_PAT` | octokit | Fine-grained, **servitium-api ONLY** (v1 least-privilege), **contents + pull_requests: write**, NO merge/admin/branch-protection, **workflows permission OFF**. |
| `GITHUB_ORG` | `fabienavedissian` | |
| `TARGET_REPOS` | `servitium-api` | v1. |
| `MONTHLY_SPEND_CAP_USD` | **primary** kill-switch | default 100. Set the SAME hard limit in the Console as an independent backstop. |
| `DAILY_SPEND_CAP_USD` | daily pacing | default **10** (must exceed one realistic task cost, else every task strands). |
| `PER_TASK_BUDGET_USD` | per-task budget | default **10** (corrected; old 3 was below real cost). |
| `MAX_LOOPS_PER_TASK` | anti-loop | default 4 |
| `MAX_OPUS_REENTRIES` | cost guard | default 1 (re-run Opus stages at most once, only on material diff change) |
| `MAX_TURNS_PER_STEP` | anti-loop | default 12 |
| `POLL_INTERVAL_MIN` | cadence | default 15 |
| `DASH_SESSION_SECRET` / `API_AUTH_URL` / `COOKIE_DOMAIN` | dashboard auth | reuse api creds; `.servitium.org` |
| `WORK_ROOT` / `MIRROR_ROOT` / `MONGOMS_DOWNLOAD_DIR` | worktrees + shared mongod cache | |

Secrets never reach an agent: every secret-bearing action is an MCP tool the agent
*calls*. The gate sandbox has no network and no secret files mounted, so even hostile
test code has nowhere to exfiltrate to. Env writes use LF, verified via `node -e dotenv`
(the prod CRLF gotcha). Note `env.production` is git-TRACKED in servitium-api, so it
ships into every worktree (see O7).

---

## 4. Data model (SQLite, `better-sqlite3`)

Single file `/srv/autodev/autodev.db`, outside any worktree. Source of truth for
resumable run state; GitHub stays the source of truth for the queue/approvals.

Tables: `task`, `step`, `checkpoint`, `gate_result`, `spend_ledger`, `lesson`, `comment`
(as before) with these additions from review:
- `task.allowed_paths_json` is **human-confirmed at SPEC_APPROVAL**, not LLM-final.
- `task.prefix_hash` — hash of the frozen context prefix built at SETUP (guard-integrity).
- `task.frozen_tests_json` — content hashes of TDD/red-team specs, set at the
  TESTS_FIRST -> IMPLEMENT transition (test-immutability).
- `step` keeps token columns incl. `cache_read_input_tokens` (correct SDK field name).
- `comment.consumed_at` — a pending comment is appended as a trailing untrusted user turn
  in the next step, never spliced into the prefix.

---

## 5. The FSM (the code owns the workflow)

The LLM only fills a step; it can never choose the next transition, **and no model
output, issue text, comment, or lesson may ever widen `allowed_paths`, flip draft->ready,
or relax a gate** (enforced in code, asserted in the FSM).

```
QUEUED
  -> PRE_GATE        (Haiku triage + deterministic dedupe)         -> SPEC | REJECTED
SPEC                 (spec-writer: spec_md + proposed allowed_paths)-> SPEC_APPROVAL
SPEC_APPROVAL        (parks; human approves spec AND allowed_paths) -> SETUP
SETUP                (mirror update + worktree + npm ci + build immutable prefix + checkpoint) -> TESTS_FIRST
TESTS_FIRST          (tdd-author; gate: tests-red; FREEZE specs)   -> IMPLEMENT
IMPLEMENT            (implementer; gates: tests-green + tsc + lint + immutability) -> CODE_REVIEW | IMPLEMENT(retry)
CODE_REVIEW          (code-reviewer)                               -> CHALLENGE | IMPLEMENT(bounce)
CHALLENGE            (challenger, Opus)                            -> RED_TEAM | IMPLEMENT(bounce)
RED_TEAM             (red-team, Opus, fresh separate session)      -> SECURITY | IMPLEMENT(bounce, +locked regression test)
SECURITY             (gates: audit+semgrep+gitleaks; agent triage) -> FINAL_REVIEW | IMPLEMENT(bounce)
FINAL_REVIEW         (final-reviewer; full gate matrix)            -> VALIDATE | IMPLEMENT(bounce)
VALIDATE             (validator; changed-lines coverage + relevance + scope-diff + outbound-scan) -> PR_READY
PR_READY             (draft PR opened; parks for human merge)      -> DONE
```

- **Test freeze:** at TESTS_FIRST -> IMPLEMENT, snapshot the TDD specs' content hashes.
  The `immutability` gate fails IMPLEMENT and every later stage if a frozen spec's
  assertions are removed/weakened or the file is deleted. Red-team regression tests are
  locked the instant they are committed. A test the implementer believes is wrong forces
  an explicit human bounce, never an in-band edit.
- **Late-bounce rule:** any IMPLEMENT bounce that changes production code re-runs the full
  locked-test + changed-lines-coverage + revert-and-rerun matrix before PR_READY. It
  re-enters CHALLENGE/RED_TEAM only on a material diff change, capped by `MAX_OPUS_REENTRIES`
  (bounds the dominant retry cost).
- **Resume model:** transitions persist after each step; on crash, roll the worktree to the
  last checkpoint sha for the current step and **re-run the step fresh** (idempotent, no SDK
  session resume needed). SDK session resume is a later cost optimization only.
- Backstops: `loop_count++` on IMPLEMENT re-entry; `loop_count > MAX_LOOPS_PER_TASK` or
  `spent_usd > budget_usd` -> `NEEDS_HUMAN`. Any uncaught error -> `FAILED`, worktree kept.
  Teardown runs in `finally`. Checkpoints are driven by the FSM at transition boundaries
  (NOT from PostToolUse, which fires per tool call).

---

## 6. Agent roles & SDK wiring

Each role = one `query()` with a role prompt, a tight tool allowlist, a model, and
`MAX_TURNS_PER_STEP`. **Agents get NO raw Bash and NO raw Edit/Write**; mutation and
commands go through self-checking MCP tools (s7/s11). There is **no per-`query()` effort
knob** in the agent SDK (review-confirmed: effort is a raw Messages-API `output_config`
param, not a `query()` option), so routing is by model only; a future raw-Messages-API
path for non-tool roles is the only way to add effort control and is called out, not assumed.

| Role | Model | Tools | Purpose |
|---|---|---|---|
| triage | `claude-haiku-4-5` | read | actionable? in-scope? dedupe |
| spec | `claude-sonnet-4-6` | read | spec_md + acceptance criteria + proposed allowed_paths |
| tdd | `claude-sonnet-4-6` | read, write(*.spec.ts within allowed_paths) | failing tests first |
| implement | `claude-sonnet-4-6` (-> `claude-opus-4-8` after 2 failed loops or `hard` label) | read, write(non-spec within allowed_paths), runGate | minimal green diff |
| review | `claude-sonnet-4-6` | read | conventions/correctness |
| challenger | `claude-opus-4-8` | read, runGate | deep refactor/bug/vuln hunt |
| redteam | `claude-opus-4-8` (**fresh separate session**, not fork) | read, runGate | break it; repro -> locked regression test |
| security | `claude-sonnet-4-6` | read, runGate | triage audit/semgrep/gitleaks |
| final | `claude-sonnet-4-6` | read, runGate | confirm clean / bounce |
| validator | `claude-sonnet-4-6` | read, runGate, githubCreateDraftPr | open the draft PR |

- Red-team is a fresh, separate `query()` (curated context) rather than a forked session:
  trivially gives the isolation, and avoids the most version-fragile SDK surface (V2 session
  API removed at 0.3.142).
- Cost shape: Sonnet default, **Opus confined to Challenger + Red-Team**, Haiku triage.
  Opus stages are output-dominated (thinking tokens billed as output) and are NOT re-run on
  every bounce (s5 late-bounce rule + `MAX_OPUS_REENTRIES`).

---

## 7. MCP tools (in-process, host-side, secret-bearing)

The agent calls these; never sees secrets; never gets raw Bash. `runGate` shells fixed
commands **inside the sandbox**, not agent-composed shell.

```ts
fsWrite(input: { taskId: number; path: string; content: string })   // realpath-checks allowed_paths atomically; denies symlinks + config/package files
runGate(input: { taskId: number; gate: GateName }) : { status: 'pass'|'fail'; details: object }  // sandboxed
gitCheckpoint(input: { taskId: number; label: string }) : { sha: string }
gitRollback(input:   { taskId: number; sha: string })   : { ok: true }
githubCreateDraftPr(input: { taskId: number; summary: string }) : { url: string; number: number }  // host composes the body from structured fields; agent supplies only a scanned summary; ALWAYS draft
githubLabel(input: { issueNumber: number; add?: string[]; remove?: string[] }) : { ok: true }
spendCheck() : { dailyUsd: number; monthlyUsd: number; capUsd: number; paused: boolean }
lessonsAppend(input: { taskId; category; title; body }) : { ok: true }   // queued for human approval before it joins any prefix
```

Every agent-authored OUTBOUND string (PR summary, lesson, branch, labels) is
gitleaks/entropy-scanned before it leaves the box (not just the staged diff). Deferred
tools (v2/v3): `contractMatrix`, `provisionGameServer`, `discordReport`.

---

## 8. Hooks

- **SessionStart** — returns the task's **immutable context prefix** (built once at SETUP:
  CLAUDE.md + human-approved LESSONS.md + sorted repo map + spec + file slices), byte-stable
  across the task's steps. The SDK manages prompt caching internally; we **observe**
  `usage.cache_read_input_tokens`, we do not place `cache_control`. We assert the prefix
  **hash** matches the task's `prefix_hash` (guard integrity), and alert if the realized
  cache-read ratio falls below an empirically-derived floor (Opus min cacheable prefix is
  4096 tokens; measured separately in M4).
- **PreToolUse** (load-bearing, can hard-deny — the one assumption M0 verifies first):
  1. No raw Bash/Edit/Write is exposed; mutation only via `fsWrite`, which realpath-checks
     `allowed_paths` atomically at write time, denies symlink creation, and denies writes to
     `package.json`, `package-lock.json`, `patches/**`, `jest.config.js`, `tsconfig.json`,
     `.github/workflows/**`, and any `*.config.{js,ts,cjs,mjs}` (dependency/config changes
     need a human PR in v1).
  2. Spend check: if `paused`, deny any model-spending tool.
  3. TDD phase: writes restricted to `*.spec.ts` within `allowed_paths`.
- **PostToolUse** — append the audit trail only (file write + sandboxed command + exit code),
  sanitized before dashboard display. Checkpoints are driven by the FSM, not here.

Fallback if the installed SDK cannot hard-deny from PreToolUse: the no-raw-mutator design
above IS already the safer posture and is the primary design, not a fallback.

---

## 9. Gates (deterministic, token-free, **sandboxed** — the runner is hostile code)

All gate subprocesses run via `sandbox/run.ts`: no network, non-root, the worktree as the
only mount, with `/srv/autodev`, the `.env`, `~/.ssh`, and any prod tree NOT mounted, and
`npm_config_ignore_scripts=true`.

| Gate | Command (sandboxed, in worktree) | Pass criteria |
|---|---|---|
| tests-red | `jest <added/modified spec files>` (same runInBand scope as green) | the NEW specs EXIST and FAIL |
| tests-green | `jest --runInBand --ci`, **2x consecutive green** | all green twice; a flip -> NEEDS_HUMAN |
| immutability | hash-compare frozen specs | no frozen assertion removed/weakened/deleted |
| relevance | revert ONLY the production diff in a throwaway worktree, rerun frozen+new specs | they FAIL again (proves green depends on the impl) |
| coverage-diff | jest `--coverage` intersected with `git diff origin/main` line ranges | high floor (target 100%) on ADDED/MODIFIED lines+branches |
| coverage-aggregate | jest `--coverage` vs `coverage-baseline.json` | secondary floor; ratchet only moves up |
| tsc | `tsc --noEmit -p tsconfig.json` (repo's own config), vs error baseline | no NEW errors (repo is NOT strict; baseline captured) |
| lint | `eslint --no-fix --config <confirmed/authored in M1>` | 0 errors (no config exists today; M1 authors one or lint is a warning) |
| audit | `npm audit --json` vs **merge-base** baseline + any high/crit from a dep change in the diff | no new high/critical |
| semgrep | `semgrep ...` vs merge-base baseline | no new ERROR-severity |
| gitleaks | `gitleaks detect` over the **full worktree** + every outbound string | 0 secrets |
| scope-diff | `git diff --name-only origin/main` | every path inside `allowed_paths`; no new symlinks (mode 120000) |

Baselines (`tsc` errors, coverage, audit/semgrep) are derived from the task's actual
**merge-base** at SETUP, not a one-time snapshot. `seed-baseline.ts` overrides the repo's
existing flat 70% jest `coverageThreshold` so the changed-lines ratchet governs, not the
static 70%. mongodb-memory-server determinism: pinned binary version + shared
`MONGOMS_DOWNLOAD_DIR` + fixed RNG/date seed + fresh in-memory DB per spec file.

---

## 10. Per-task lifecycle (concrete walkthrough)

1. Issue `#123` labelled `auto` (label restricted to the owner). `triage` (Haiku) confirms
   actionable + not a dupe (open issues + LESSONS.md).
2. `spec` writes a short spec + acceptance criteria + **proposed** `allowed_paths` (globs over
   `src/` feature dirs, e.g. `src/shop/**` — specs are colocated under `src/`, there is no
   `test/` tree). Posts to the issue, parks in `SPEC_APPROVAL`.
3. You approve the spec **and the allowed_paths** on the dashboard (code-side cap also rejects
   globs broader than N dirs / the repo root). -> `SETUP`: `git remote update` the mirror,
   `git worktree add work/123/servitium-api -b autodev/123 main`, `npm ci`, build the immutable
   prefix, first checkpoint.
4. `TESTS_FIRST`: `tdd` writes failing specs (mongodb-memory-server pattern mandatory).
   `tests-red` confirms red; specs are FROZEN.
5. `IMPLEMENT`: `implement` writes the minimal non-spec diff via `fsWrite`. `tests-green` +
   `tsc` + `lint` + `immutability` must pass to advance; else retry (loop_count++).
6. `CODE_REVIEW` -> `CHALLENGE` (Opus) -> `RED_TEAM` (Opus, fresh session). Any repro is
   committed as a LOCKED regression test and bounces to IMPLEMENT.
7. `SECURITY`: audit+semgrep+gitleaks; agent triages. Critical -> bounce.
8. `FINAL_REVIEW` runs the full matrix. -> `VALIDATE` (coverage-diff + relevance + scope-diff +
   outbound-scan) -> `PR_READY`: host composes the PR body from structured fields, opens a
   **draft** PR. You merge with your own click; the PAT cannot.
9. `finally`: worktree pruned, lessons queued for your approval, spend rolled up.

---

## 11. Scope guard & isolation (multi-layer, never trusted to a prompt)

1. No raw Bash/Edit/Write exposed to agents (primary design). Mutation via `fsWrite` only.
2. `fsWrite` realpath-checks `allowed_paths` **atomically at write time**, rejects symlink
   creation and config/package/workflow files.
3. Post-step `scope-diff` gate (`git diff --name-only` + symlink-mode scan) backstops it.
4. **Sandbox**: every gate runs no-network, non-root, worktree-only mount, `--ignore-scripts`.
5. Guard code is TCB: `src/git/scopeGuard.ts`, `src/sdk/hooks.ts`, `src/cost/ledger.ts`,
   `src/sandbox/**`, and config are **hard-excluded** from any agent-writable `allowed_paths`,
   even under self-modify. They change only via a fully human-authored PR.
6. The red-team pen-tests the guard against itself; any escape -> human-reviewed lesson + fix.

---

## 12. Cost control (corrected by review)

- Routing as s6 (Sonnet default, Opus only Challenger/Red-Team, Haiku triage).
- **Budget target ~90-100 EUR/month (~100 USD).** The monthly cap is the primary kill-switch;
  the daily cap (~10 USD) only paces. Both backed by an independent Console hard limit.
- Kill-switch: `ledger.monthlyUsd()` vs `MONTHLY_SPEND_CAP_USD` (primary), `dailyUsd()` vs
  `DAILY_SPEND_CAP_USD` (pacing). On breach: no new task starts; the in-flight task parks
  after its current step (PreToolUse denies further spend). Daily resets at midnight, monthly
  on the 1st.
- **Honest per-task cost (to be re-measured empirically in M4, not assumed):** optimistic
  ~2 USD, central ~5-6 USD (zero-retry), realistic ~10-15 USD with 1-2 retry loops. The
  dominant line item is the two Opus stages' **output** (thinking tokens at 25 USD/MTok),
  which prompt caching does NOT reduce. So expected throughput is **~8-20 tasks/month**, not
  40-60; the "1-2/day" claim is dropped.
- Cost levers, highest-first: (1) trivial-diff **size-gate is default-on** — small/low-risk
  diffs skip at least one Opus stage; (2) Red-Team defaults to Opus and is NOT re-run per
  bounce (`MAX_OPUS_REENTRIES`); (3) demote Red-Team to Sonnet entirely if needed;
  (4) shorter cached prefix (fewer file slices). The cache-health alert remains, but a cache
  void is ~1.5-2x of task total (not 6x), and it is also a **guard-integrity** signal (the
  prefix hash assertion catches a changed security context).

---

## 13. GitHub integration

- Labels: `auto` -> `auto:spec` -> `auto:wip` -> `auto:pr`; `auto:blocked`.
- Queue: poll `is:issue is:open label:auto` every `POLL_INTERVAL_MIN`, oldest first, one at a
  time (single-flight lock).
- Output: **draft** PR via the PAT scoped to **servitium-api only**, contents +
  pull_requests:write, **workflows OFF**, no merge/admin. Verify `servitium-api/main` branch
  protection is ON (require PR, no direct push) so even contents:write cannot bypass review.
- The `auto` label is owner-restricted; a human approves the spec + allowed_paths. Issue
  title/body are treated as **untrusted data**, never as instructions that can change a gate
  or scope.

---

## 14. Dashboard (`autodev.servitium.org`) — FLAGSHIP, professional-grade

A first-class product, not an afterthought: the owner's single pane of glass to direct AutoDev
across ALL projects. Built to a high bar; we take the time to make it solid and ultra-detailed.

- **Stack.** Back: NestJS service co-located with the orchestrator (reads the same SQLite +
  SSE/WebSocket for live updates). Front: Angular 20 standalone on the `servitium-ui` design
  system (svt-* components, lucide, localize, **no emoji, no alert/confirm**). Researched against
  best-in-class control planes (Vercel, Linear, GitHub, Datadog, AWS/Azure/GCP consoles).
- **Auth.** Public vhost + TLS terminate on the prod VPS (nginx `allow <ip>; deny all;`),
  reverse-proxied to the dashboard service on the agent box over the private link (s21). Login
  validates against `API_AUTH_URL` via a dedicated read-limited service account (O2); httpOnly
  cookie scoped `.servitium.org`.
- **What it must show (the bar the owner set):**
  - **Done / Doing / Planned** per project and globally: a live board of every task's FSM state,
    with the agent's current step and decision streaming in.
  - **What was analysed**: per file/service, the findings (perf/security/refactor), with
    **percentages** (coverage, % files analysed per service, % i18n keys present per language).
  - **Visual blocks touched**: the diff, the components/services/routes a task changed, the
    cross-repo blast radius.
  - **Cost & throughput**: $/task, $/day, monthly burn vs the cap, tokens, cache hit-rate.
  - **Proposals & control**: feature/mission proposals (problem/solution/feasibility/impact) with
    Approve / Reject / Comment; spec + allowed_paths + draft-PR approvals (deep-linked to GitHub,
    never merges); a free-text channel to feed the agent (consumed as a trailing untrusted user
    turn, never a system message).
- Security invariants live in code, never in the prompt; nothing the dashboard displays or the
  owner types can widen scope or relax a gate.

---

## 15. LESSONS.md

A committed file + the `lesson` index. Because the prefix loads it (s8), an agent-authored
`lessonsAppend` that re-enters context is a self-poisoning vector: every append is **queued
for human approval** before it joins the prefix. Format: `## <date> <category> <title>` + body.

---

## 16. Observability

pino structured logs, one child per task, rotated. Every agent decision, tool call (args
sanitized), gate result, and spend row is queryable; the dashboard reads them.

---

## 17. Milestones (each ends green and demoable)

- **M0a Scaffold.** Repo compiles (CJS), empty jest suite green, SQLite opens, config validates.
- **M0b SDK smoke-test (s18).** Split into (A) binding confirmations and (B) capability +
  mandatory fallback BUILT. M0b is done only when each (B) fallback is wired and exercised.
- **M1 Worktree + sandbox + gates.** Mirror lifecycle (`clone --mirror` once, `remote update`
  per task, `worktree add -b autodev/<n> main`), `npm ci` + shared `MONGOMS_DOWNLOAD_DIR`, the
  sandbox wrapper, all gates run real on the API. Scope-guard accept = a unit test of the
  realpath/allowlist function (live-hook denial deferred to M3). *Accept:* gates give correct
  pass/fail on known-good and known-bad diffs; sandbox blocks network + secret access.
- **M2 Spec + TDD on a real issue.** triage + spec post a spec; allowed_paths human-approved;
  tests-red enforced; specs frozen. *Accept:* spec on the issue, red gate blocks premature impl,
  immutability gate trips on a weakened test.
- **M3 Full chain to draft PR.** All roles wired, model routing, loop + Opus-reentry caps;
  a trivial real API task goes end-to-end. *Accept:* draft PR opened, never merged, full matrix
  green incl. coverage-diff + relevance.
- **M4 Cost + caps + LESSONS.** Ledger, **empirical per-task cost measured** on a real issue,
  Opus cache-read ratio measured separately (>=4096-token prefix confirmed), monthly cap pauses
  the queue, lessons human-approval flow. *Accept:* induced cap pauses mid-queue; real cost
  documented; throughput re-estimated from actuals.
- **M5 Dashboard v1.5.** IP-gated, api-creds login, Runs/Approvals/Comments, comment as
  trailing user turn. *Accept:* reachable only from your IP; approve a spec + allowed_paths.
- **M6 Deploy + unattended run.** Deploy to the box via PM2, poll real issues for a day.
  *Accept:* correct draft PRs unattended within the monthly cap.

---

## 18. SDK smoke-test checklist (mitigates risk #1)

Pinned `@anthropic-ai/claude-agent-sdk` version. **(A) Binding confirmations** (symbol exists,
right shape): `query()`, per-`query()` `model`, `maxTurns`, hook registration
(SessionStart/PreToolUse/PostToolUse), **PreToolUse hard-deny**, in-process MCP via
`createSdkMcpServer`/`tool()`, `usage.cache_read_input_tokens`. **(B) Capability + mandatory
fallback built** (the milestone is the working fallback, not a green checkbox):
- Per-role effort control — **expected absent** in the SDK; fallback = model-only routing now,
  raw Messages API later if needed.
- Deterministic cache placement — **not exposed**; fallback = observe cache-read ratio, keep the
  prefix byte-stable, never place `cache_control`.
- Session fork/resume — **not load-bearing**; red-team uses a fresh separate session; crash
  resume uses rollback-to-checkpoint + re-run (no SDK resume needed).

Re-run on every SDK bump (V2 session API removed at 0.3.142; drift is real).

---

## 19. Open questions for you (O1-O7)

- **O1 Box access.** SSH IP + user for the dedicated box (M6 deploy). Confirmed: not the prod
  VPS, no prod creds/route.
- **O2 Dashboard identity.** Dedicated read-limited api.servitium service account, or your
  personal login? Recommend a service account.
- **O3 Coverage policy.** Confirm changed-lines coverage at a high floor (target 100% of
  added/modified lines) + aggregate as secondary; `allow-coverage-dip` restricted to
  human-applied, deletion-only, logged to LESSONS.md.
- **O4 Self-modify.** AutoDev's own repo via the chain: PRs flagged `self-modify`, manual review
  + manual `pm2 reload`, never hot-patched, guard/TCB files excluded from allowed_paths. Confirm.
- **O5 i18n waiver.** Ship the internal dashboard EN-only?
- **O6 Sandbox tech.** Confirm the box can run a no-network non-root sandbox (bubblewrap/firejail
  or a container runtime). If not, gates run unisolated and that blocks v1 safety. (One check on
  the box settles it.)
- **O7 Tracked secret.** `env.production` is git-tracked in servitium-api and ships into every
  worktree. Should we (a) scrub it from history, (b) accept it given the sandbox makes it inert,
  or (c) add a task to move it to a gitignored file? Recommend (b) now + (c) as an `auto` task.

---

## 20. Definition of Done (v1)

A PR is "merge-ready" only when, for a `servitium-api` task: tests-green (2x), tsc (no new
errors), lint, **coverage-diff** (high floor on changed lines), coverage-aggregate, **immutability**
(no frozen test weakened), **relevance** (revert-and-rerun fails), npm-audit, semgrep, gitleaks
(full tree + outbound), scope-diff (in `allowed_paths`, no new symlinks) are ALL green; the
red-team found nothing or its repros are locked passing regression tests; the diff is atomic and
inside human-approved `allowed_paths`; and the run stayed inside its turn/loop/Opus-reentry/budget
caps. The PR is a DRAFT and waits for your manual merge. AutoDev never merges and never deploys.

---

## 21. Deployment topology (two boxes, confirmed with the owner)

- **Box A — prod VPS (`51.75.119.93`)**: hosts api/center/portal AND the public
  `autodev.servitium.org` vhost (TLS + IP-allow + login). Does NOT run agents.
- **Box B — the dedicated "servitium linux server" host (reformattable)**: runs the orchestrator
  + all role agents + the gate sandbox + SQLite. Compute and state live here.
- **Link.** Box A's nginx reverse-proxies `autodev.servitium.org` to the dashboard service on
  Box B over the existing private link (WireGuard/vRack). The dashboard URL is thus served from the
  same server as the API (owner's requirement) while data/compute stay on Box B. The orchestrator
  may also call the public API read-only for context.
- **Isolation.** Box B holds the Anthropic key + the GitHub PAT (servitium-api only) + the
  worktrees; it has NO prod Mongo/API write creds. Agents never touch prod; output is a draft PR a
  human merges.

---

## 22. Mission backlog (initial AutoDev roadmap, owner-set)

These become feature-proposals / `auto` issues once the engine runs (M3+). v1 acts on
servitium-api; broader items need v2 (other repos), but research/planning can start earlier.

**v1 (servitium-api):**
1. Service-by-service, file-by-file audit for PERFORMANCE, SECURITY, refactoring — analyse every
   file, take the time; each finding becomes an atomic, TDD-backed PR.
2. API performance savings (hot paths, queries/indexes, payloads, N+1, caching).
3. Make ALL tests pass and reinforce app security (security gate + red-team feed this).
4. `env.production` secret migration (O7).

**v2 (all projects):**
5. UI/UX overhaul to an "ultimate" bar: continuous research of top dashboards + Amazon/Microsoft/
   Google, propose and apply improvements (center/portal).
6. Missing-i18n tracker across all repos (6 languages): report + fill, shipped with each screen.
7. Finish `discord.servitium.org`: the ultimate promo Discord bot; analyse market + recommend free
   vs partly-paid, or pure promo tool.
8. New-games groundwork: **Rust (priority)**, then ARK Survival Evolved + ARK Survival Ascended,
   later ARK 2, then candidates (Minecraft, V-Rising, ...). For each: learn RCON, map feasibility +
   user needs, get to know the game, expand cleanly like Conan/Soulmask, ask the owner when blocked.
9. Market/competition study for adjacent, monetizable expansions: daily research + analysis.

**Standing:**
10. Feature-proposer + a daily research agent (WebSearch) propose new missions; the owner
    approves/rejects/deprioritises via the dashboard. AutoDev is autonomous but asks before deep-
    diving or abandoning a mission. (Claude may also seed proposals.)
