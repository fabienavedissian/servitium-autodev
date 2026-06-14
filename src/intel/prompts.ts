import { getActiveDossier } from './dossier';
import { FEATURE_KEYS } from './score/rubric';
import { TARGET_APPS, testRuleFor } from './appContext';
import { kindPlaybook, kindLabel } from './kindPlaybooks';

// All SIE agents output STRICT JSON only (parsed with parseJsonLoose). They never pick the next
// stage and never compute the final score — the FSM/code does. Grounding is the dossier blob.

const ground = (): string => `--- SERVITIUM CONTEXT ---\n${getActiveDossier()}\n--- END CONTEXT ---`;

export function harvestPrompt(angle: string, label: string, queries: string[]): string {
  return [
    `You are the HARVEST agent for the "${label}" (${angle}) veille lane of Servitium's intelligence engine.`,
    `Each line below is a TOPIC or REQUEST to research - it may be loosely phrased or in French. For EACH,`,
    `extract the key entities (game names, products, frameworks like DayZ, Oxide, Carbon...) and run the most`,
    `EFFECTIVE English web searches to find recent, on-topic results. Reformulate freely into good search terms;`,
    `run several searches per topic if needed to truly cover it.`,
    queries.map((q, i) => `  ${i + 1}. ${q}`).join('\n'),
    `Return ONLY real results you actually found via search. Do NOT invent URLs or titles.`,
    `Output ONLY JSON: {"hits":[{"title":string,"url":string,"snippet":string,"publishedHint":string}]} (max 12 hits, dedup obvious repeats).`,
    ground(),
  ].join('\n\n');
}

export function extractPrompt(angle: string, pages: { url: string; text: string }[]): string {
  return [
    `You are the EXTRACT agent for Servitium's "${angle}" veille lane. For each page below, extract a structured signal.`,
    `Be skeptical: if a page is SEO marketing, a stale repost, or irrelevant to deep game-server admin, set "relevant": false.`,
    `Do NOT fabricate quantitative claims (counts, percentages). Only state what the text supports.`,
    `Pages:\n${pages.map((p, i) => `[#${i}] ${p.url}\n${p.text.slice(0, 5000)}`).join('\n\n')}`,
    `Output ONLY JSON: {"signals":[{"index":number,"title":string,"summary":string,"sourceType":string,"claimedDate":string,"relevant":boolean}]}.`,
    ground(),
  ].join('\n\n');
}

export function ideatePrompt(
  signals: { id: number; angle: string; title: string; summary: string }[],
  openTitles: string[],
  avoid: string[] = [],
  wants: string[] = [],
): string {
  return [
    `You are the IDEATOR for Servitium's intelligence engine. From today's fresh signals, propose concrete OPPORTUNITIES`,
    `for Servitium: features, new-game integrations, Discord-bot evolutions, monetization, or new business lines.`,
    `Each opportunity MUST be grounded in >=1 signal id and map onto Servitium's real product/edges. Concrete, not vague:`,
    `prefer "Rust players want a shop, doable via RCON" over "integrate Rust". Let weak lanes be empty - quality over quota.`,
    wants.length
      ? `The owner EXPLICITLY WANTS these directions - actively look for signals that serve them and propose concrete opportunities for them when the evidence supports it:\n${wants.map((w) => `- ${w}`).join('\n')}`
      : '',
    `Avoid duplicating anything already open: ${openTitles.length ? openTitles.join('; ') : '(none)'}.`,
    avoid.length
      ? `DO NOT propose anything that already EXISTS or the owner already REJECTED (these are corrections from the owner - respect them):\n${avoid.map((a) => `- ${a}`).join('\n')}`
      : '',
    `Work entirely in English (best search/veille quality); a separate step translates for display.`,
    `Signals:\n${signals.map((s) => `[signal:${s.id}] (${s.angle}) ${s.title} - ${s.summary}`).join('\n')}`,
    `Output ONLY JSON: {"opportunities":[{"kind":"feature|game|business|integration|pricing|tech-enabler","title":string,"thesis":string,"whyNow":string,"fit":string,"dedupKey":string,"evidence":[signalId],"sources":[{"label":string,"url":string}]}]} (max 6).`,
    `dedupKey = a slugified canonical noun, e.g. "game:rust", "business:hosting", "discord:premium-tickets".`,
    ground(),
  ].join('\n\n');
}

export function scorerPrompt(opp: { title: string; thesis: string; whyNow: string; fit: string }, evidenceList: string): string {
  return [
    `You are the SCORER for Servitium's intelligence engine. Rate this opportunity on 8 features, each in [0,1].`,
    `You EXTRACT features; you do NOT compute a final score. For each feature, cite the evidence ids that justify it`,
    `(market/demand claims MUST cite a signal id; an axis with no evidence will be capped by code).`,
    `Opportunity: ${opp.title}\nThesis: ${opp.thesis}\nWhy now: ${opp.whyNow}\nFit: ${opp.fit}`,
    `Evidence available: ${evidenceList}`,
    `Features: ${FEATURE_KEYS.join(', ')}.`,
    `  strategic_fit: 0 off-mission (becoming a host) .. 1 dead-center deep-admin/compounds edges`,
    `  demand_evidence: 0 no signal .. 1 cited competitor gaps / forum pain (MUST cite)`,
    `  feasibility: 0 needs infra we lack .. 1 drops into an existing app/pattern`,
    `  effort_inv: 1 days .. 0 quarters   |   revenue_proximity: 0 free-only .. 1 clean Pro/new billable`,
    `  moat_or_diff: 0 copyable .. 1 leverages agent/Rust/Discord   |   reversibility: 0 irreversible .. 1 cheap to abandon`,
    `  freshness: 0 already-known .. 1 net-new`,
    `Output ONLY JSON: {"features":{${FEATURE_KEYS.map((k) => `"${k}":0.0`).join(',')}},"justifications":{"<feature>":"... [signal:N]"},"evidenceCount":{"<feature>":<int sources cited>}}.`,
    ground(),
  ].join('\n\n');
}

export function feasibilityPrompt(
  opp: { title: string; thesis: string; whyNow: string; fit: string },
  sources: string,
  prior?: { findings: string[]; unknowns: string[] },
  steer?: string,
  opts: { appContext?: string; kind?: string } = {},
): string {
  const priorBlock = prior && (prior.findings.length || prior.unknowns.length)
    ? `A PRIOR investigation already established these findings (treat them as known, build on them, do NOT redo):\n${prior.findings.map((f) => `- ${f}`).join('\n')}\n\nFOCUS this pass on RESOLVING these still-open unknowns - dig hard until each is answered, then move it into concreteFindings and shrink the unknowns list:\n${prior.unknowns.map((u) => `- ${u}`).join('\n')}`
    : '';
  const steerBlock = steer && steer.trim() ? `THE OWNER EXPLICITLY ASKS YOU TO ALSO INVESTIGATE/VERIFY THIS - make it a TOP priority of this pass and report concrete findings on it:\n"${steer.trim()}"` : '';
  const appBlock = opts.appContext ? `THE TARGET APP'S CONCRETE FILE MAP (dig in THESE real files, cite them in approachSteps/impactedApps, do NOT re-derive the layout):\n${opts.appContext}` : '';
  const playbook = kindPlaybook(opts.kind);
  const kindBlock = playbook ? `${kindLabel(opts.kind).toUpperCase()} — use this as the backbone of approachSteps + acceptanceCriteria + impactedApps; verify each point against the real code:\n${playbook}` : '';
  return [
    `You are the FEASIBILITY investigator. Produce a DEEP, EXHAUSTIVE, CONCRETE feasibility dossier for this Servitium opportunity.`,
    `Tailor the dossier to the opportunity KIND: a SECURITY opp names the exact vuln class + the guard/decorator to add + a failing regression test; a BUG-FIX/REFACTOR opens with a failing test then the minimal fix; a PERFORMANCE opp states the metric + the index/query/cache change; a FEATURE reuses existing services + decides the free/Pro entitlement gate; an EVOLUTION checks breaking changes + the patch-package patches; a BUSINESS opp respects the live 9.99 EUR Pro/Stripe model. The injected playbook below is your backbone.`,
    steerBlock,
    appBlock,
    kindBlock,
    priorBlock,
    `Be RELENTLESS: run MANY web searches (aim for 10+), open and read the ACTUAL docs, RCON command references, .ini/config`,
    `references, mod/plugin pages, API docs, and real community threads. Cross-check every claim against a real source.`,
    `Do NOT stop at the first answer - dig until the technical mechanism is fully pinned end to end.`,
    `The bar is an instruction dossier, never an idea. Gold standard: not "integrate Rust" but "Rust players want a shop;`,
    `doable via RCON; the .ini key that changes is X; get the player's SteamID via command Y; give an item via`,
    `inventory.giveto <id> <item>; limits: Z". Every "concreteFindings" entry must be a SPECIFIC, verified technical fact`,
    `(a real command, config key, API endpoint, version constraint) with enough detail to act on. List 6-12 of them.`,
    `If the opportunity adds a NEW GAME or a data-driven feature (shop, item economy, live map), make approachSteps`,
    `end-to-end and SITUATIONAL: (1) state what already exists for the current games (Conan/Soulmask) that will be REUSED,`,
    `(2) the concrete target - which existing Server features to bring to the new game, (3) the real sub-tasks WITH sources,`,
    `e.g. "scrape the full Rust item list + numeric IDs + icons from <name the real wiki/API/repo>, store them in the items`,
    `DB like the existing Conan items, then wire the shop give via RCON inventory.give <id>". Name real data sources, endpoints,`,
    `and files so the owner never has to guess HOW.`,
    `Classify every open question. If MORE RESEARCH (docs, references, threads, mod pages) could answer it, it is a BLOCKING`,
    `"unknowns" item - dig until you resolve it, then move it into concreteFindings. If it can ONLY be confirmed by running`,
    `the real game server / live RCON / the actual runtime, it is a "fieldUnknowns" item - NOT a blocker, validated during the`,
    `dev itself. AIM TO LEAVE "unknowns" EMPTY: the prompt is READY when zero blocking unknowns remain (only fieldUnknowns may`,
    `stay). Only keep a blocker if it is genuinely unresolvable from research. Never bluff or invent.`,
    `ENUMERATE EVERY APP THIS CHANGE TOUCHES. Servitium changes are usually cross-cutting (a new game touches 6 of 7 repos; an`,
    `entitlement change touches servitium-api + center + portal + shared). For EACH impacted app give: a rough effort PERCENTAGE`,
    `(the impactedApps array sums to ~100), one line of WHY, an explicit app-local SPEC line, and the CORRECT test requirement for`,
    `THAT app - the API uses a mongodb-memory-server integration test; servitium-center/servitium-discord/servitium-ui use Angular`,
    `TestBed/karma; servitium-portal has NO test harness (verify by build + visual); servitium-electron-gui uses jest with stubbed`,
    `IO; servitium-autodev uses jest+ts-jest. NEVER assign a mongodb-memory-server test to a non-API app. Set targetApp to the`,
    `PRIMARY repo (the one holding the central change) and make impactedApps[0] that same app.`,
    `Opportunity: ${opp.title}\nThesis: ${opp.thesis}\nWhy now: ${opp.whyNow}\nFit: ${opp.fit}\nSources: ${sources}`,
    `Work entirely in English for max quality; a separate step translates the brief for display.`,
    `Output ONLY JSON: {"recommendation":"build-now|incubate|park|drop","verdict":"2-3 sentences owner-facing",`,
    `"targetApp":"${TARGET_APPS.join('|')}",`,
    `"impactedApps":[{"app":"<one of ${TARGET_APPS.join('|')}>","pct":0,"why":"one line","spec":"explicit app-local spec","test":"the app-correct test rule"}],`,
    `"concreteFindings":["real commands/config/API details, each specific"],`,
    `"unknowns":["BLOCKING - keep ONLY if unresolvable by research"],"fieldUnknowns":["confirm on a live server during dev - not a blocker"],"approachSteps":["step naming real files/dirs"],"dataModel":string,"outOfScope":string,`,
    `"acceptanceCriteria":["objectively checkable"],"testStrategy":string,"verifyCommands":["npm run build", "..."],"reviewChecklist":["..."]}.`,
    ground(),
  ].join('\n\n');
}

// Post-integration audit: read the SHIPPED code and judge completeness vs the brief's acceptance criteria.
export function verifyIntegrationPrompt(
  opp: { title: string; targetApp: string },
  brief: { acceptanceCriteria: string[]; approachSteps: string[]; concreteFindings: string[] },
  prior?: { done: string[]; missing: string[] },
): string {
  const priorBlock = prior && (prior.done.length || prior.missing.length)
    ? `A PRIOR audit already verified these as DONE (re-confirm quickly, then focus on the rest):\n${prior.done.map((x) => `- ${x}`).join('\n')}\n\nThese were MISSING/incorrect last time - check whether they are now fixed:\n${prior.missing.map((x) => `- ${x}`).join('\n')}`
    : '';
  return [
    `You are a STRICT senior code reviewer. The owner says they have IMPLEMENTED this Servitium feature. Read the ACTUAL`,
    `code in this repo (you are in the repo root with read-only tools) and judge HONESTLY how complete and correct the`,
    `implementation is against the acceptance criteria. Do NOT trust claims - verify in the real files (grep/read).`,
    priorBlock,
    `Feature: ${opp.title}\nTarget app: ${opp.targetApp}`,
    `Acceptance criteria (each must be objectively met in the code):\n${(brief.acceptanceCriteria ?? []).map((x) => `- ${x}`).join('\n') || '- (none specified - infer from the approach)'}`,
    `Intended approach (reference):\n${(brief.approachSteps ?? []).map((x) => `- ${x}`).join('\n')}`,
    `For EACH acceptance criterion, find the code that satisfies it (cite file:line) or mark it missing. Also check Servitium`,
    `conventions: i18n in all 6 languages for new UI strings, no emoji, no internal infra/filenames leaked in UI, and the`,
    `CORRECT test for this app — ${opp.targetApp || 'servitium-api'}: ${testRuleFor(opp.targetApp)} (do NOT demand a`,
    `mongodb-memory-server test on a non-API app). "done" ONLY if you actually saw the code; else "missing" with the file to fix.`,
    `Output ONLY JSON: {"integrationScore":0-100,"isComplete":boolean (true ONLY if everything is met and you would ship it),`,
    `"verdict":"2-3 sentences owner-facing","done":["criterion met - file:line"],"missing":["what is missing/wrong, specifically, with the file"],`,
    `"followupPrompt":"a ready-to-paste Max prompt to finish/fix ONLY the remaining gaps; empty string if complete"}.`,
    `Work in English; a separate step translates for display.`,
    ground(),
  ].join('\n\n');
}

// Display-only translation (the veille reasoned in English; this just renders FR for the owner).
export function translateOppsPrompt(items: { id: number; title: string; thesis: string; whyNow: string; fit: string }[]): string {
  return [
    `Translate the owner-facing text of these product opportunities into natural, fluent FRENCH.`,
    `Keep proper nouns, game names, product names and technical terms (RCON, .ini, API, Pro, Discord, SteamID) intact.`,
    `Items:\n${JSON.stringify(items)}`,
    `Output ONLY JSON: {"items":[{"id":number,"title":string,"thesis":string,"whyNow":string,"fit":string}]}.`,
  ].join('\n\n');
}

export function translateFeasibilityPrompt(f: Record<string, unknown>): string {
  return [
    `Translate the owner-facing fields of this feasibility brief into natural, fluent FRENCH.`,
    `Keep proper nouns, exact commands, config keys, file paths and technical terms intact.`,
    `Fields:\n${JSON.stringify(f)}`,
    `Output ONLY JSON with the SAME keys; translate string and string[] values to French; keep array shapes.`,
  ].join('\n\n');
}

export function codeAuditPrompt(repo: string, area: string, fileList: string): string {
  return [
    `You are a senior engineer auditing the "${repo}" repo, area "${area}". Use your file tools (read, grep, glob)`,
    `to inspect the real code, then propose CONCRETE, high-value improvements. Each MUST cite a real file path`,
    `(and line if possible) as evidence - no vague advice. Cover: security flaws, performance, refactor/dead code,`,
    `missing tests, best-practice violations, risky patterns, and small feature gaps.`,
    `ALSO flag FRAMEWORK MODERNIZATION (kind "refactor"): Angular -> prefer signals + the @if/@for/@switch control flow`,
    `over *ngIf/*ngFor, standalone components, inject(), the new input()/output()/model(); flag legacy NgModules,`,
    `constructor-injection-only, or *ngIf still in templates. NestJS -> current patterns, avoid deprecated APIs.`,
    `Note version-specific best practices for the framework versions the repo actually uses. Skip trivial/cosmetic nits.`,
    `Files in scope (a sample):\n${fileList}`,
    `Work in English. Output ONLY JSON: {"opportunities":[{"kind":"security|performance|refactor|test-gap|feature|lib-upgrade","title":string,"thesis":string,"whyNow":string,"fit":string,"dedupKey":string,"evidence":["src/x/y.ts:42"],"severity":"high|medium|low"}]} (max 6, only the genuinely worthwhile).`,
    `dedupKey = "code:${repo}:<short-slug>". ${ground()}`,
  ].join('\n\n');
}

// Informational research report (compte-rendu) on an owner question - NOT an actionable opportunity.
export function reportPrompt(question: string): string {
  return [
    `You are a RESEARCH analyst for Servitium. The owner asks: "${question}".`,
    `Research it THOROUGHLY via web search (run many searches, read real pages, cross-check facts). Then write a`,
    `clear, factual report in FRENCH (markdown). Cover whatever is genuinely relevant, typically: what it is, which`,
    `games/contexts it is used on, how it works at a high level, its relationship to Servitium (direct competitor?`,
    `complementary? something we could reproduce or beat?), strengths/weaknesses, performance implications, and`,
    `concrete takeaways for Servitium. Be specific, cite real sources, never invent.`,
    `Output ONLY JSON: {"report_md": string (French markdown with ## sections), "sources": [{"label":string,"url":string}]}.`,
    ground(),
  ].join('\n\n');
}

export function promptsmithPrompt(filledTemplate: string): string {
  return [
    `You are the PROMPTSMITH. Below is a near-final ready-to-paste prompt for a Claude Code Max session.`,
    `Tighten wording, ensure every acceptance criterion is testable and ties to the test strategy, ensure allowed paths`,
    `point at plausible real dirs, and that NO internal infra names leak. Do not add fluff. Return the FINAL prompt text only`,
    `(no JSON, no preamble), ready to paste verbatim.`,
    `--- DRAFT ---\n${filledTemplate}`,
  ].join('\n\n');
}
