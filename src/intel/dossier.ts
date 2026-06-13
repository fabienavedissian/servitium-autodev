// Phase 0 grounding: a hand-seeded "what Servitium is" blob (from CLAUDE.md + MEMORY.md). Every
// sensing prompt is anchored on this so opportunities map onto the REAL product, not a generic SaaS,
// and so the ideator does not re-propose features that already exist. Phase 1 auto-refreshes this
// weekly from the real CLAUDE.md / MEMORY.md / app READMEs; for now, re-paste when it feels stale.
export const SERVITIUM_DOSSIER = `
SERVITIUM - what it is
- A deep-admin platform for game-server COMMUNITIES. NOT a server hoster. The value is deep
  administration + community tooling, not renting boxes. No anti-DDoS as a selling point.
- Positioning: deep-admin platform for survival/RCON games (Conan Exiles + Soulmask today).
- Five apps: servitium-api (NestJS + Mongoose + MongoDB + Socket.IO), servitium-center (Angular 20
  admin panel, standalone components + signals, 6 languages), servitium-portal (Angular player site),
  servitium-ui (shared design system, svt-* components), and a servitium agent (Electron + a Rust
  game_db_reader) installed on game-server hosts (Windows AND Linux), piloted entirely from Center.
- Two-collection model: Server (the community/brand: name, shop, donations, raid protection, wars,
  quests, Discord config, banner, players, wipes - one is billable) and GameInstance (the runtime the
  agent pilots: ip/ports/passwords, mods, gameMode, heartbeat, desiredState, install paths).

FEATURES THAT ALREADY EXIST (do NOT re-propose these; only deepen/extend them)
- Shop + donations (0% commission; manual-donation friction is the upsell), raid protection, wars,
  bounty hunt, wipe management, live map, quests/missions (daily/weekly, snapshot progress, auto-claim).
- A Discord bot: tickets, gifts (items DB with real icons; ticket gift buttons), per-guild onboarding.
- Host management (each VPS = a Host with a fingerprint UUID, 60s heartbeat; setup wizard shipped).
- Items DB + admin-gift send; game-update tracking (Conan/Soulmask auto-update via SteamCMD).
- A standalone Servitium-for-Discord product (discord.servitium.org): free bot to advertise Servitium,
  httpOnly-cookie Discord OAuth, per-guild onboarding; agent-free = free / agent = paid.

BUSINESS MODEL
- Freemium: a free tier + Pro. Manual donation friction = the upsell; 0% commission; cashback is Pro.
- Revenue lives in the Pro tier and the Discord product. Retention lives in admin power + community.

TECH EDGES TO LEVERAGE (a real moat)
- The Rust game_db_reader (reads game DBs directly), the RCON layer, the shared Discord lib (parity
  Center <-> Discord app), a cross-platform headless agent. Conan is on UE5 since May 2026.

ROADMAP / DIRECTION (what we WANT)
- More games (Rust is a priority candidate, then ARK and other survival/RCON titles).
- Refactor/optimize/secure the API; harmonize CSS across Center/UI; close i18n gaps (6 langs).
- Finish + grow the Discord product; explore Discord-bot monetization.
- Possibly entirely new business lines if a strong one appears.

CONVENTIONS (respect in any proposal)
- 6 languages (en/fr/de/es/pt/ru); no emoji in UI (svt-icon/lucide); never expose internal infra
  names (OVH, OPNsense, WireGuard, PM2, nginx, vRack) in user-visible copy; no em-dashes in copy;
  security-first; every API change ships a green mongodb-memory-server integration test.

STRATEGIC LENS for scoring opportunities
- Dead-center = deepens admin/community tooling for survival/RCON games, OR strengthens the freemium
  upsell, OR leverages the agent/Rust/Discord edges. Off-mission = becoming a generic host.
`.trim();
