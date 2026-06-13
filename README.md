# servitium-autodev

Autonomous chain-of-agents engineering loop for Servitium. Turns GitHub issues
labelled `auto` into **merge-ready DRAFT PRs** on `servitium-api` (v1), with the
prime directive of near-zero regression. It never merges and never deploys to prod.

Full design: `../AUTODEV-BUILD-PLAN-v1.md`.

## Status

Milestone **M0** (scaffold + SDK smoke-test). The FSM scheduler and agent chain are
wired in later milestones (M1-M6).

## Develop

```bash
npm install
npm run build       # tsc
npm test            # jest (config, db, prices)
npm run smoketest   # builds, then probes the agent SDK surface (live checks need ANTHROPIC_API_KEY in .env)
npm start           # boots config + db (M0 scaffold)
```

Copy `.env.example` to `.env` (gitignored) and fill in secrets.

## Conventions

- CommonJS + strict TypeScript. ESM-only deps (the agent SDK, octokit) are loaded via
  the `src/esm.ts` dynamic-import seam.
- The `@anthropic-ai/claude-agent-sdk` version is pinned EXACTLY; re-run `npm run smoketest`
  on every bump (the V2 session API was removed at 0.3.142, so drift is real).
- Secrets are never handed to an agent and never committed. Gate subprocesses run sandboxed
  (M1+).
