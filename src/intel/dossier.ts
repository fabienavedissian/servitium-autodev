// Phase 0 grounding: a hand-seeded "what Servitium is" blob (from CLAUDE.md + MEMORY.md). Every
// sensing prompt is anchored on this so opportunities map onto the REAL product, not a generic SaaS.
// Phase 1 replaces the manual blob with a weekly auto-refresh; for now, re-paste when it feels stale.
export const SERVITIUM_DOSSIER = `
SERVITIUM — what it is today
- A deep-admin platform for game-server communities. NOT a server hoster. The value is deep
  administration tooling, not renting boxes.
- Games supported today: Conan Exiles and Soulmask (survival/crafting, dedicated servers, RCON).
- Five apps: servitium-api (NestJS + MongoDB + Socket.IO), servitium-center (Angular admin panel),
  servitium-portal (Angular player-facing site), servitium-ui (shared design system), and a
  servitium agent (Electron + a Rust game_db_reader) installed on game-server hosts (Win + Linux).
- Owned features: shop/donations (0% commission, manual-donation friction is the upsell), raid
  protection, wars, bounty hunt, wipe management, live map, quests/missions, a Discord bot
  (tickets, gifts, onboarding), items DB with real icons, host management.
- Business model: freemium. Free tier + Pro. Manual donation friction = the upsell; cashback is Pro.
- A standalone Servitium-for-Discord product exists (discord.servitium.org): free bot to advertise
  Servitium, Discord OAuth, agent-free = free / agent = paid.
- Tech edges to leverage: the Rust game_db_reader (reads game DBs directly), the RCON layer, the
  shared Discord lib (parity Center <-> Discord app), a cross-platform headless agent.
- Conventions: 6 languages (en/fr/de/es/pt/ru); no emoji in UI; never expose internal infra names
  (OVH, OPNsense, WireGuard, PM2, nginx) in user copy; security-first.

STRATEGIC LENS for scoring opportunities
- Dead-center = deepens admin/community tooling for survival/RCON games, or strengthens the
  freemium upsell, or leverages the agent/Rust/Discord edges. Off-mission = becoming a generic host.
- Revenue lives in the Pro tier and the Discord product. Retention lives in admin power + community.
`.trim();
