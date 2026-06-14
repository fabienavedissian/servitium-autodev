import { CONVENTIONS } from '../../agents/prompts';
import { getAppContext, testRuleFor } from '../appContext';
import { kindPlaybook, kindLabel } from '../kindPlaybooks';

// The hybrid deep-investigation output: a deterministic concrete brief (no extra LLM call) + a
// ready-to-paste Max prompt (the economic linchpin: the human runs it on the flat-rate plan) + an
// optional "go deeper on Max" investigation prompt. SIE emits TEXT, never code.

// One repo a change touches: rough effort share + the app-local spec + the app-CORRECT test rule.
export interface ImpactedApp {
  app: string;
  pct: number;
  why: string;
  spec: string;
  test: string;
}

export interface Feasibility {
  recommendation: 'build-now' | 'incubate' | 'park' | 'drop';
  verdict: string;
  targetApp: string;
  impactedApps?: ImpactedApp[]; // every repo touched (impactedApps[0].app === targetApp); pct sums ~100
  concreteFindings: string[];
  unknowns: string[]; // BLOCKING: must be resolved by more research before building
  fieldUnknowns?: string[]; // only confirmable on a live server during dev — NOT blockers, validate while building
  approachSteps: string[];
  dataModel?: string;
  outOfScope?: string;
  acceptanceCriteria: string[];
  testStrategy?: string;
  verifyCommands: string[];
  reviewChecklist: string[];
}

// The impacted-apps list, or a single-row fallback on the targetApp so renders never go empty.
function impactedOf(f: Feasibility): ImpactedApp[] {
  if (f.impactedApps && f.impactedApps.length) return f.impactedApps;
  return [{ app: f.targetApp, pct: 100, why: f.verdict, spec: '(voir approche)', test: testRuleFor(f.targetApp) }];
}

export interface OppLite {
  title: string;
  thesis?: string;
  whyNow?: string;
  fit?: string;
  sources: { label: string; url: string }[];
}

const list = (arr?: string[]): string => (arr && arr.length ? arr.map((s) => `- ${s}`).join('\n') : '- (none)');
const numbered = (arr?: string[]): string => (arr && arr.length ? arr.map((s, i) => `${i + 1}. ${s}`).join('\n') : '1. (derive the steps from the approach + file map above)');
const sourceList = (s: { label: string; url: string }[]): string => (s.length ? s.map((x) => `${x.label} (${x.url})`).join(' | ') : '(none)');

// Shipped features the executor must EXTEND, never rebuild. Kept in sync with the dossier's feature list.
const EXISTING_FEATURES = [
  'Auth/RBAC: httpOnly-cookie JWT + Bearer, Discord OAuth, ServerRole OWNER/ADMIN + a 14-namespace PermissionSet, SUPERADMIN.',
  'Economy: per-server 3-bucket wallet (balance/donationBalance/cashback), shop (ITEM/KIT/WILDCARD/RAID_ALERT), paycheck cron, atomic transfers.',
  'Donations: 0%-commission player donations via the admin\'s own PayPal; manual crediting is free, auto-credit is the Pro upsell.',
  'Items DB + admin-gifts: canonical game_items catalogue with self-hosted icons, RCON gift bundles, Discord ticket gift buttons.',
  'Raid protection, clan wars, bounty hunt, quests (daily/weekly, auto-claim), raid-alerts (Web Push/VAPID + Discord), tickets.',
  'Wipe management (6-step, scheduled) + season history; live tactical map (Leaflet, both Conan maps); chat logs + RCON live chat.',
  'Players: roster, kick/ban (RCON), VPN/multi-account detection, leaderboards, anti-cheat kill filtering.',
  'Billing: single Pro tier 9.99 EUR/mo via Stripe Checkout flipping Server.plan; entitlements gate (27 keys) via EntitlementGuard.',
  'Discord bot: 20+ channel features (killfeed, status voice, leaderboards, war board, wipe announcements) + the free discord.servitium.org product.',
  'Agent: cross-platform headless Electron + Rust game_db_reader, RCON pool (Conan rcon-client / Soulmask rcon-srcds), SteamCMD install/update, WS control plane keyed by gameInstanceId.',
];

// The concrete brief, rendered deterministically from the feasibility JSON (stable tone + cost).
export function renderBriefMd(opp: OppLite, f: Feasibility, score: number): string {
  return [
    `# ${opp.title}`,
    `**Verdict (${f.recommendation}, faisabilite ${score}/100) :** ${f.verdict}`,
    `**App cible :** ${f.targetApp}`,
    ``,
    `## Apps impactees`,
    `| App | % | Ce qui change | Tests |`,
    `| --- | --- | --- | --- |`,
    impactedOf(f).map((a) => `| ${a.app} | ${a.pct} | ${a.why} | ${a.test} |`).join('\n'),
    ``,
    `## Pourquoi maintenant`,
    opp.whyNow ?? '(n/a)',
    `Sources : ${sourceList(opp.sources)}`,
    ``,
    `## Constats concrets (le detail actionnable)`,
    list(f.concreteFindings),
    ``,
    (f.unknowns ?? []).length ? `## Inconnues bloquantes a lever EN PREMIER` : '',
    (f.unknowns ?? []).length ? list(f.unknowns) : '',
    (f.unknowns ?? []).length ? `` : '',
    (f.fieldUnknowns ?? []).length ? `## A valider sur le terrain pendant le dev (normal, non bloquant)` : '',
    (f.fieldUnknowns ?? []).length ? list(f.fieldUnknowns) : '',
    (f.fieldUnknowns ?? []).length ? `` : '',
    `## Approche proposee`,
    list(f.approachSteps),
    f.dataModel ? `\n**Donnees/modele :** ${f.dataModel}` : '',
    f.outOfScope ? `**Hors scope :** ${f.outOfScope}` : '',
    ``,
    `## Criteres d'acceptation`,
    list(f.acceptanceCriteria),
  ]
    .filter((l) => l !== '')
    .join('\n');
}

// The ready-to-paste Max prompt. Hard-constraints block imported VERBATIM from agents/prompts.ts
// CONVENTIONS so the manual prompt can never drift from the autonomous one.
export function renderMaxPrompt(opp: OppLite, f: Feasibility, score: number, opts: { kind?: string } = {}): string {
  const apps = impactedOf(f);
  const appCtx = getAppContext(f.targetApp);
  const playbook = kindPlaybook(opts.kind);
  const verify = (f.verifyCommands && f.verifyCommands.length ? f.verifyCommands : ['npm run build']);
  return [
    `# Role`,
    `You are a world-class senior software engineer and the acting technical lead on Servitium. You are a TypeScript expert`,
    `with deep, current mastery of: NestJS + Mongoose + MongoDB + Socket.IO (backend); Angular 20 — standalone components,`,
    `signals, the @if/@for/@switch control flow, inject(), input()/output()/model(), the localize i18n pipe, and the in-house`,
    `svt-* design system (frontend); the Source RCON protocol; SteamCMD and dedicated game-server operations; and a`,
    `cross-platform headless Electron + Rust (NAPI) agent. You write production-grade, secure, fully-internationalized`,
    `(en/fr/de/es/pt/ru), test-backed code, and you deliver COMPLETE, atomic, reviewable work — never a half-finished`,
    `feature, never a red build, never a TODO left for someone else.`,
    ``,
    `# Your mission`,
    `${f.verdict}`,
    `Primary (target) app: ${f.targetApp}. Opportunity grade: ${f.recommendation}, feasibility ${score}/100.`,
    `Deliver this END TO END in this session: fully implemented, tested with each app's own harness, i18n-complete in all 6`,
    `languages, building green, and ready to commit. Treat this prompt as a complete, authoritative spec — everything you`,
    `need to finish is below. When you are done, there should be almost nothing left for me to do.`,
    ``,
    `# How you work (apply throughout — do NOT skip)`,
    `- Execute AUTONOMOUSLY to 100%. Do not hand back a plan and wait, and do not ask for confirmation — implement it. Only`,
    `  stop for a GENUINE blocker (an item under "Resolve first" you truly cannot settle from the code/docs, or a field`,
    `  validation that strictly needs the live game server). If you hit one, do ALL other work first, then report exactly`,
    `  what is blocked, why, and what you would do once unblocked.`,
    `- Read before you write. Open the real files named in the file map below and mirror the surrounding code's patterns,`,
    `  naming, structure, and conventions exactly. Do not re-derive flows from scratch.`,
    `- Stay atomic and in scope. Touch only what the task needs; do not refactor unrelated code.`,
    `- Internationalize everything: every user-visible string goes through the localize pipe with keys added to ALL 6`,
    `  language files at creation. No emoji (svt-icon/lucide only). Never leak internal infra names or raw filenames into`,
    `  UI/copy. No em-dashes in user-facing copy.`,
    `- Match each app's OWN test harness + TypeScript strictness (see "Tests" below). NEVER write a mongodb-memory-server`,
    `  test outside servitium-api.`,
    `- Finish GREEN: run the verification commands and fix everything until they pass before you declare done.`,
    ``,
    `Work in the Servitium monorepo (E:\\Servitium Project). Read CLAUDE.md and the memory index at`,
    `C:\\Users\\Fabien\\.claude\\projects\\e--Servitium-Project\\memory\\MEMORY.md first, then the README of the app you touch.`,
    ``,
    `# Servitium architecture (extend, never reinvent)`,
    `- 7 apps + shared/: servitium-api (NestJS + Mongoose + MongoDB + Socket.IO), servitium-center (Angular 20 admin panel),`,
    `  servitium-portal (Angular player site), servitium-ui (shared svt-* design system + @servitium/discord lib), the agent`,
    `  (headless Electron + a Rust game_db_reader, on the game host, piloted from Center), servitium-discord (the free Discord`,
    `  product), and servitium-autodev (this engine). Cross-process WS types + the entitlements matrix live in /shared.`,
    `- Two-collection model: Server = the community/brand (name, shop, donations, raid protection, wars, quests, wipes,`,
    `  banner, players — one Server is billable) vs GameInstance = the runtime the agent pilots (ip/ports/passwords, mods,`,
    `  gameMode, heartbeat, desiredState, install paths). Server.gameInstanceId links them; the agent WS room is keyed by gameInstanceId.`,
    ``,
    `# Features that already SHIP (extend them — do NOT rebuild any of these)`,
    list(EXISTING_FEATURES),
    ``,
    `# Context (the opportunity + what the investigation already established)`,
    `- Opportunity: ${opp.title}`,
    opp.thesis ? `- Thesis: ${opp.thesis}` : '',
    opp.whyNow ? `- Why now: ${opp.whyNow}` : '',
    opp.fit ? `- Fit with Servitium: ${opp.fit}` : '',
    `- Concrete, verified findings to build on:`,
    list(f.concreteFindings),
    `- Sources: ${sourceList(opp.sources)}`,
    ``,
    appCtx ? `# Concrete file map for ${f.targetApp} (the primary app — open exactly these, do NOT re-derive the layout)` : '',
    appCtx,
    appCtx ? `` : '',
    `# Apps impacted (open each repo you touch; respect each app's OWN test + strictness rule)`,
    apps.map((a) => `- ${a.app} (~${a.pct}%): ${a.spec} | Test: ${a.test}`).join('\n'),
    ``,
    playbook ? `# ${kindLabel(opts.kind)} (apply this — your concrete, Servitium-grounded backbone for THIS kind of change)` : '',
    playbook,
    playbook ? `` : '',
    (f.unknowns ?? []).length ? `# Resolve these BLOCKING unknowns first (quick spike; if one is truly unresolvable, do everything else, then report it)` : '',
    (f.unknowns ?? []).length ? list(f.unknowns) : '',
    (f.fieldUnknowns ?? []).length ? `` : '',
    (f.fieldUnknowns ?? []).length ? `# Validate against the live environment as you build (NOT blockers — confirm during implementation, adjust if they differ)` : '',
    (f.fieldUnknowns ?? []).length ? list(f.fieldUnknowns) : '',
    ``,
    `# Implementation plan — execute in this order, to completion`,
    numbered(f.approachSteps),
    f.dataModel ? `\nData & model touchpoints: ${f.dataModel}` : '',
    f.outOfScope ? `Out of scope (do NOT do): ${f.outOfScope}` : '',
    ``,
    `# Non-negotiable conventions`,
    CONVENTIONS,
    ``,
    `# Acceptance criteria (the task is DONE only when every one of these is objectively met)`,
    list(f.acceptanceCriteria),
    ``,
    `# Tests (mandatory — per app; the mongodb-memory-server rule is API-ONLY, never write one in an Angular/Electron repo)`,
    apps.map((a) => `- ${a.app}: ${a.test}`).join('\n'),
    f.testStrategy ? `Notes: ${f.testStrategy}` : '',
    ``,
    `# Verify before you finish (run these — all must pass; fix until green)`,
    verify.map((c) => `- ${c}`).join('\n'),
    ``,
    `# Definition of done (self-check before you declare complete)`,
    list([
      'Every acceptance criterion is met and you can point to the code that satisfies it.',
      'Tests are written with each touched app\'s correct harness and are GREEN.',
      'New user-visible strings are localized in all 6 languages; no emoji; no leaked internals/filenames.',
      'The verification commands all pass (build green).',
      ...(f.reviewChecklist ?? []),
    ]),
    ``,
    `Now begin and carry it through to completion. At the end, give me a concise, file-by-file summary of what you changed,`,
    `which acceptance criteria are met, what you validated against the live server (if anything), and anything still open.`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

// The hybrid "go deeper on Max" prompt: when the owner wants the maximal 50-prompt treatment run on
// his flat-rate plan instead of spending more API. Frames a deep autonomous investigation.
export function renderDeeperPrompt(opp: OppLite, f: Feasibility, opts: { kind?: string } = {}): string {
  const appCtx = getAppContext(f.targetApp);
  const playbook = kindPlaybook(opts.kind);
  return [
    `You are a world-class senior engineer and technical lead on Servitium (TypeScript expert: NestJS, Angular 20, MongoDB,`,
    `Socket.IO, RCON, SteamCMD, a cross-platform Electron + Rust agent). Run a DEEP, exhaustive feasibility investigation for`,
    `this opportunity, then produce a complete, build-ready implementation plan. Be relentless about concrete detail — real`,
    `RCON commands, exact .ini/config keys, real API/mod options, real community demand with sources. Leave nothing assumed.`,
    ``,
    `Opportunity: ${opp.title}`,
    opp.thesis ? `Thesis: ${opp.thesis}` : '',
    `Starting findings (verify and go FAR beyond these):`,
    list(f.concreteFindings),
    `Known unknowns to fully resolve: ${(f.unknowns ?? []).join('; ') || '(discover them)'}`,
    `Sources so far: ${sourceList(opp.sources)}`,
    ``,
    appCtx ? `Concrete file map for ${f.targetApp} (build on this, do not re-derive it):\n${appCtx}` : '',
    appCtx ? `` : '',
    playbook ? `${kindLabel(opts.kind)} (use as the backbone; verify each point against the live code):\n${playbook}` : '',
    playbook ? `` : '',
    `Deliver: (1) a verified feasibility verdict, (2) the exact technical mechanism end-to-end, (3) a phased build plan`,
    `naming real files in the Servitium monorepo with the per-app test harness for each, (4) risks + edge cases, (5) a test`,
    `strategy, (6) the apps impacted with a rough effort split. Read CLAUDE.md and MEMORY.md first. Use as many`,
    `search/verification steps as needed — do not stop at the first answer. The end state is a plan so concrete that pasting`,
    `it into a fresh session would finish the feature with almost no further decisions.`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}
