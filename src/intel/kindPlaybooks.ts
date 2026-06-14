import { NEW_GAME_PLAYBOOK } from './generatedContext';

// Per-opportunity-KIND guidance, injected into the feasibility + Max prompts so EVERY kind of change
// (not just new-game) carries concrete, Servitium-grounded rigor: what to reuse, the real gotchas, the
// mandatory checks + tests for THAT kind. The 'game' entry is the exhaustive corpus playbook; the rest
// are curated from the deep audit (the entitlements gate, the known security debt, the patch-package
// patches, the cross-platform agent rules, the live commercial model).

const FEATURE = [
  'FEATURE / INTEGRATION playbook:',
  '- Reuse, do NOT rebuild: check the existing services + Server features first (shop, economy/wallets, raid protection, wars, bounty, quests, live map, wipes, Discord bot, tickets, host mgmt) and EXTEND them.',
  '- Free vs Pro: decide the tier up front. If Pro, add the key to shared/entitlements/index.ts (Entitlement enum + ENTITLEMENT_MIN_PLAN), gate the API route with @RequiresEntitlement(...) + EntitlementGuard, and gate Center UI via EntitlementsService.has()/svt-pro-gate. If free, no gate. Anything NOT in the enum is free.',
  '- Data: respect the two-collection model (Server = community/brand vs GameInstance = runtime). A new RUNTIME field on Server MUST be added to RUNTIME_FIELD_NAMES (servers.service.ts) or PATCH /servers/:id silently drops it.',
  '- Real-time: new agent<->API events go in shared/ws-events with a typed payload (imported by both API + agent); the agent WS room is keyed by gameInstanceId, not serverId.',
  '- UI: standalone components + signals + @if/@for + inject(); svt-* design system; guards order ServerRoleGuard BEFORE RoleGuard/PermissionGuard/EntitlementGuard; every user-visible string localized in all 6 languages at creation.',
  '- Integration with an external API: use the ports/adapters pattern (like @servitium/discord); raw body + signature verification for webhooks (Stripe); idempotency keys.',
].join('\n');

const SECURITY = [
  'SECURITY playbook (treat as sensitive — authorize server-side, never trust the client):',
  '- Guard EVERY new endpoint: confirm it is not accidentally @Public; apply JwtAuthGuard + RolesGuard / ServerRoleGuard / EntitlementGuard in the correct order (ServerRoleGuard FIRST — the others read request.userServerRole). OWNER derives from Server.ownerId, not server_roles. SUPERADMIN bypasses entitlements only.',
  '- Never trust client-supplied authority flags (a real bug trusted ticket isStaff from the client). Re-derive roles/ownership/entitlements on the server.',
  '- Known real debt in the codebase — do NOT regress, and cite if your opp touches it: OwnerGuard returning true (authz bypass), the game-updates controller being unauthenticated, RCON SQL injection via giveLeadGuild (parameterize), PayPal clientSecret logged plaintext, an over-broad @Public DDoS whitelist, the 2 agent-intake endpoints accepting any Bearer (run as userId:system), the portal RegistrationModalComponent writing tokens to localStorage (should be httpOnly cookie only), buildExecutor SPEC_APPROVAL auto-approving.',
  '- Validate + sanitize all input (the global ValidationPipe is whitelist + forbidNonWhitelisted); rate-limit; no secrets in logs; never leak internal infra names or raw filenames in errors/UI.',
  '- Ship a regression test that FAILS before the fix and passes after (mongodb-memory-server for API). A security change is sensitive: prefer the smallest, most surgical diff.',
].join('\n');

const BUGFIX = [
  'BUG-FIX / REFACTOR / TEST-GAP playbook:',
  '- Reproduce FIRST: write the smallest FAILING test that pins the bug (mongodb-memory-server for API, TestBed for Center, jest with stubbed IO for the agent), then fix until it goes green. For a test-gap, the test IS the deliverable.',
  '- Keep the change atomic and behavior-preserving beyond the targeted fix; cite the exact file:line you change.',
  '- Refactor: prefer Angular signals + @if/@for/@switch + inject() + input()/output()/model() over legacy *ngIf/*ngFor/NgModules/constructor-only DI; do not change a public API without need.',
  '- Cross-platform agent: never hardcode .exe / WindowsServer / Win64 / backslashes — use platform.ts + path-resolver.ts helpers (the agent runs on Windows AND Linux).',
  '- Re-run the FULL build + test suite; a refactor must not drop coverage or change behavior.',
].join('\n');

const PERFORMANCE = [
  'PERFORMANCE playbook (measure, do not guess):',
  '- State the metric and the before/after. Profile the real hot path first.',
  '- Mongo: add/verify the index the query needs; kill N+1s in the dashboard aggregates; project only the fields used; paginate large reads.',
  '- Real-time: shrink WS payloads, debounce, and cache hot reads via the @Global CacheService (Redis); offload heavy work to the BullMQ QueueService (note: workers are not wired yet).',
  '- Agent: the Rust game_db_reader streams incrementally (query_new_events by last_row_id, bounded limit) — keep batches bounded and never block the event loop.',
  '- Lock the new behavior with a test; finish with a green production build.',
].join('\n');

const EVOLUTION = [
  'EVOLUTION / LIBRARY-UPGRADE / TECH-ENABLER playbook:',
  '- Read the target version CHANGELOG for breaking changes; upgrade incrementally, one major at a time.',
  '- PRESERVE the patch-package patches — patches/rcon-client+4.2.5.patch is applied in BOTH servitium-api and servitium-electron-gui; without it Conan RCON dies ("Timeout for packet id 1"). Re-run npx patch-package after install.',
  '- Angular bumps: follow ng update; a lucide bump needs the svt-icon rename table rechecked (Loader2/Edit2/Filter/Grid were renamed). servitium-ui changes need a tgz rebuild (npm run build:pack) + reinstall in Center/Portal.',
  '- Run the FULL test suite + a production build for every touched app before declaring done.',
].join('\n');

const COMMERCIAL = [
  'BUSINESS / PRICING playbook (respect the LIVE model, never the dead one):',
  '- LIVE model: a single Pro tier at 9.99 EUR/mo, billed per game server via Server.plan + Stripe Checkout (one STRIPE_PRICE_ID, webhook flips the plan). PayPal is player-donations only (the admin\'s own account); donation auto-credit is THE Pro upsell; 0% commission always.',
  '- Gating lives in shared/entitlements (27 keys, all currently "pro") enforced by EntitlementGuard; anything not in the enum is FREE. A new billable feature = add the key, gate it, keep the Stripe (platform) and PayPal (donations) rails separate.',
  '- Do NOT resurrect the DEAD model: the old multi-plan subscriptions + anti-DDoS-as-a-product (was 15 EUR) + API plan (was 30 EUR) are obsolete (~39 files flagged for removal). The scorer\'s revenue_proximity must not reward reviving them.',
].join('\n');

const KIND_PLAYBOOKS: Record<string, string> = {
  game: NEW_GAME_PLAYBOOK,
  feature: FEATURE,
  security: SECURITY,
  bugfix: BUGFIX,
  performance: PERFORMANCE,
  evolution: EVOLUTION,
  commercial: COMMERCIAL,
};

// Map every kind string the engine emits (ideator + code scan) onto one playbook family.
const KIND_ALIAS: Record<string, string> = {
  game: 'game',
  feature: 'feature', integration: 'feature',
  security: 'security',
  performance: 'performance', perf: 'performance',
  refactor: 'bugfix', 'test-gap': 'bugfix', bug: 'bugfix', bugfix: 'bugfix',
  'lib-upgrade': 'evolution', 'tech-enabler': 'evolution',
  business: 'commercial', pricing: 'commercial',
};

const KIND_TITLE: Record<string, string> = {
  game: 'New-game integration playbook',
  feature: 'Feature delivery playbook',
  security: 'Security playbook',
  bugfix: 'Bug-fix / refactor playbook',
  performance: 'Performance playbook',
  evolution: 'Evolution / upgrade playbook',
  commercial: 'Business / pricing playbook',
};

function familyOf(kind?: string | null): string {
  return KIND_ALIAS[(kind ?? '').toLowerCase().trim()] ?? '';
}

// The kind-specific guidance block (empty string when the kind has no dedicated playbook).
export function kindPlaybook(kind?: string | null): string {
  const fam = familyOf(kind);
  return fam ? KIND_PLAYBOOKS[fam] ?? '' : '';
}

// A header label for the injected block, e.g. "Security playbook".
export function kindLabel(kind?: string | null): string {
  const fam = familyOf(kind);
  return fam ? KIND_TITLE[fam] ?? 'Playbook' : 'Playbook';
}
