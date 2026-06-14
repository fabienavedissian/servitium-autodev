import { CONVENTIONS } from '../../agents/prompts';
import { getAppContext, testRuleFor, NEW_GAME_PLAYBOOK } from '../appContext';

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
const sourceList = (s: { label: string; url: string }[]): string => (s.length ? s.map((x) => `${x.label} (${x.url})`).join(' | ') : '(none)');

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
export function renderMaxPrompt(opp: OppLite, f: Feasibility, score: number, opts: { isGame?: boolean } = {}): string {
  const apps = impactedOf(f);
  const appCtx = getAppContext(f.targetApp);
  return [
    `# Who you are`,
    `You are a SENIOR FULL-STACK ENGINEER and the technical lead on Servitium — a deep-admin platform for survival/RCON`,
    `game communities (Conan Exiles + Soulmask today). You are a master of the exact stack you will touch: Angular 20`,
    `(standalone components, signals, @if/@for control flow, inject(), the localize i18n pipe, the svt-* design system),`,
    `NestJS + Mongoose + MongoDB + Socket.IO, TypeScript strict, the RCON protocol, and a cross-platform Electron + Rust`,
    `agent. You write production-grade, secure, fully-internationalized code (6 languages: en/fr/de/es/pt/ru), never expose`,
    `internal infra or raw filenames in UI, use no emoji (svt-icon/lucide only), and you ship every API change with a green`,
    `mongodb-memory-server integration test. You work in small, atomic, reviewable commits and you never leave a build red.`,
    ``,
    `You are working in the Servitium monorepo (E:\\Servitium Project). Read CLAUDE.md and the memory index`,
    `at C:\\Users\\Fabien\\.claude\\projects\\e--Servitium-Project\\memory\\MEMORY.md FIRST, then the README of the app`,
    `you will touch. Do not re-derive flows from source.`,
    ``,
    `# Servitium architecture (respect it — extend, never reinvent)`,
    `- 7 apps + shared/: servitium-api (NestJS + Mongoose + MongoDB + Socket.IO), servitium-center (Angular 20 admin panel),`,
    `  servitium-portal (Angular player site), servitium-ui (shared svt-* design system + @servitium/discord lib), the agent`,
    `  (headless Electron + a Rust game_db_reader, on the game host, piloted from Center), servitium-discord (the free Discord`,
    `  product), and servitium-autodev (this engine). Cross-process WS types + the entitlements matrix live in /shared.`,
    `- Two-collection model: Server = the community/brand (name, shop, donations, raid protection, wars, quests, wipes,`,
    `  banner, players — one Server is billable) vs GameInstance = the runtime the agent pilots (ip/ports/passwords, mods,`,
    `  gameMode, heartbeat, desiredState, install paths). Server.gameInstanceId links them; the agent WS room is keyed by gameInstanceId.`,
    `- These features ALREADY EXIST — extend them, do NOT rebuild: shop + 0%-commission donations, raid protection, wars,`,
    `  bounty hunt, wipe management, live map (handles both Conan maps), quests/missions, a Discord bot (tickets + item gifts`,
    `  with a real items DB), host management. Reuse the existing services and Server features.`,
    `- Adding a new game reuses the pattern: a game_db_reader flavor that reads the game's DB, the RCON command layer for`,
    `  kick/ban/give/teleport, then wiring the EXISTING Server features (shop, economy, wipes, map) onto the new game's model.`,
    ``,
    `# Goal`,
    `${f.verdict}`,
    `Target app: ${f.targetApp}. This is a ${f.recommendation} opportunity (feasibility ${score}/100).`,
    ``,
    `# Context you need`,
    `- Opportunity: ${opp.title}`,
    opp.thesis ? `- Thesis: ${opp.thesis}` : '',
    opp.whyNow ? `- Why now: ${opp.whyNow}` : '',
    opp.fit ? `- Fit with Servitium: ${opp.fit}` : '',
    `- Concrete findings from the investigation:`,
    list(f.concreteFindings),
    `- Sources: ${sourceList(opp.sources)}`,
    ``,
    appCtx ? `# Concrete file map for ${f.targetApp} (the primary app — open these, do NOT re-derive the layout)` : '',
    appCtx,
    appCtx ? `` : '',
    `# Apps impacted (open each repo you touch; respect each app's OWN test + strictness rule)`,
    apps.map((a) => `- ${a.app} (~${a.pct}%): ${a.spec} | Test: ${a.test}`).join('\n'),
    ``,
    opts.isGame ? `# New-game integration playbook (this opportunity adds a game — follow the per-repo wiring + gotchas)` : '',
    opts.isGame ? NEW_GAME_PLAYBOOK : '',
    opts.isGame ? `` : '',
    (f.unknowns ?? []).length ? `# Resolve these unknowns FIRST (quick spike, STOP and report if any is a blocker)` : '',
    (f.unknowns ?? []).length ? list(f.unknowns) : '',
    (f.fieldUnknowns ?? []).length ? `` : '',
    (f.fieldUnknowns ?? []).length ? `# Validate on the real environment as you build (NOT blockers — confirm during implementation, adjust if they differ)` : '',
    (f.fieldUnknowns ?? []).length ? list(f.fieldUnknowns) : '',
    ``,
    `# Proposed approach`,
    list(f.approachSteps),
    f.dataModel ? `Data/model touchpoints: ${f.dataModel}` : '',
    f.outOfScope ? `Out of scope (do NOT do): ${f.outOfScope}` : '',
    ``,
    `# Hard constraints (Servitium conventions - non-negotiable)`,
    CONVENTIONS,
    ``,
    `# Acceptance criteria (each must be objectively checkable)`,
    list(f.acceptanceCriteria),
    ``,
    `# Test strategy (per app — the mongodb-memory-server rule is API-ONLY; never write one in an Angular repo)`,
    apps.map((a) => `- ${a.app}: ${a.test}`).join('\n'),
    f.testStrategy ? `Notes: ${f.testStrategy}` : '',
    ``,
    `# Build plan for THIS session`,
    `1. Confirm the unknowns above with a quick spike; STOP and report if any is a blocker.`,
    `2. Implement per the approach in atomic commits.`,
    `3. Run: ${(f.verifyCommands ?? ['npm run build']).join(' && ')}`,
    `4. Self-review against the acceptance criteria and conventions before declaring done.`,
    ``,
    `# Review checklist before you call it done`,
    list(f.reviewChecklist),
    ``,
    `If anything here is ambiguous, ask me one consolidated round of questions, then proceed.`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

// The hybrid "go deeper on Max" prompt: when the owner wants the maximal 50-prompt treatment run on
// his flat-rate plan instead of spending more API. Frames a deep autonomous investigation.
export function renderDeeperPrompt(opp: OppLite, f: Feasibility): string {
  return [
    `Run a DEEP, exhaustive feasibility investigation for this Servitium opportunity, then produce a complete`,
    `implementation plan. Be relentless about concrete detail - real RCON commands, exact .ini/config keys, real`,
    `API/mod options, and real community demand with sources. Leave nothing assumed.`,
    ``,
    `Opportunity: ${opp.title}`,
    opp.thesis ? `Thesis: ${opp.thesis}` : '',
    `Starting findings (verify and go FAR beyond these):`,
    list(f.concreteFindings),
    `Known unknowns to fully resolve: ${(f.unknowns ?? []).join('; ') || '(discover them)'}`,
    `Sources so far: ${sourceList(opp.sources)}`,
    ``,
    getAppContext(f.targetApp) ? `Concrete file map for ${f.targetApp} (build on this, do not re-derive it):\n${getAppContext(f.targetApp)}` : '',
    ``,
    `Deliver: (1) a verified feasibility verdict, (2) the exact technical mechanism end-to-end, (3) a phased build`,
    `plan naming real files in the Servitium monorepo, (4) risks + edge cases, (5) a test strategy. Read CLAUDE.md`,
    `and MEMORY.md first. Use as many search/verification steps as needed - do not stop at the first answer.`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}
