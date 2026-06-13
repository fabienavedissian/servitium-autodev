# servitium-autodev

Autonomous chain-of-agents engineering loop for Servitium. Turns GitHub issues labelled
`auto` into **merge-ready DRAFT PRs** (v1: `servitium-api`), with the prime directive of
near-zero regression. It never merges and never deploys to prod. Built on
`@anthropic-ai/claude-agent-sdk` (pinned `0.3.177`), billed via a dedicated Anthropic
Console API key. Full design: `docs/BUILD-PLAN.md`.

## Status

The engine is **assembled and tested** (100 unit tests green) with the load-bearing
behaviours **verified live** against the real SDK:

- agent runner round-trip + usage/cost capture (`scripts/agent-smoketest.ts`),
- **PreToolUse hard-deny PROVEN** — a hook blocks a tool call deterministically
  (`scripts/hook-smoketest.ts`): the #1 risk is retired,
- chain head producing real, convention-respecting, parseable specs on a servitium-api task
  (`scripts/chain-demo.ts`).

Built, in `src/`:

| Area | Modules |
|---|---|
| Config / state | `config` (zod), `db` (better-sqlite3 schema), `cost` (price map + `Ledger` with daily/monthly kill-switch) |
| Isolation | `sandbox/run` (LocalRunner + Bubblewrap placeholder), `git/scopeGuard` (TCB: realpath + glob), `git/mirror`+`worktree` |
| Gates | `tsc`, `jest` (green 2x / red), `coverageDiff` (changed-lines), `immutability`, `relevance`, `security` (audit/semgrep/gitleaks), `scopeDiff`, `runner`, `registry` |
| Agents | `sdk/client` (ESM seam), `agents/run` (`runRole`), `agents/roles` (routing), `agents/prompts` |
| Tool boundary | `sdk/mcpTools` (fsWrite/runGate/spendCheck/lessonsAppend), `sdk/hooks` (PreToolUse hard-deny + audit) |
| Orchestration | `fsm/states`+`machine`+`executor`+`outcomes`, `orchestrator/runTask` (full assembly, drives to DONE), `orchestrator/poll` |
| Queue / output | `github/client` (octokit), `github/pr` (structured draft-PR body + outbound secret scan), `tasks/local` |

## What remains (needs inputs or live integration)

1. **The concrete `process()`** for the poll loop: mirror -> worktree -> `npm ci` -> `runTask`
   -> draft PR. Best run with the gate sandbox on the agent box.
2. **Agent box (Box B)**: wire `BubblewrapRunner` (no-network, non-root) and deploy under PM2.
   Needs SSH access.
3. **GitHub PAT** scoped to `servitium-api` (contents + pull_requests:write, no merge/workflows)
   to run the live queue + PRs.
4. **Baselines** (`scripts/seed-baseline.ts`): tsc errors, coverage, audit/semgrep at merge-base.
5. **Dashboard** `autodev.servitium.org` (flagship; see BUILD-PLAN s14).

## Develop

```bash
npm install
npm run build       # tsc (strict)
npm test            # jest (100 tests, offline)
npm run smoketest   # live: probe the agent SDK surface (needs ANTHROPIC_API_KEY in .env)
node --env-file-if-exists=.env dist/scripts/hook-smoketest.js   # live: prove PreToolUse hard-deny
node --env-file-if-exists=.env dist/scripts/chain-demo.js       # live: triage + spec on a real task
```

Copy `.env.example` to `.env` (gitignored) and fill in secrets.

## Conventions

- CommonJS + strict TypeScript. ESM-only deps (the agent SDK, octokit) load via `src/esm.ts`.
- The SDK version is pinned EXACTLY; re-run `npm run smoketest` on every bump.
- Secrets never reach an agent and never get committed. Gate subprocesses run sandboxed (on Box B).
- The FSM owns the workflow; an agent's output only maps to an Outcome, never picks the next state.
  Guard/TCB files (`scopeGuard`, `hooks`, `ledger`) change only via human-authored PRs.
