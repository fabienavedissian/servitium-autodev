import { getActiveDossier } from './dossier';
import { FEATURE_KEYS } from './score/rubric';

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
): string {
  const priorBlock = prior && (prior.findings.length || prior.unknowns.length)
    ? `A PRIOR investigation already established these findings (treat them as known, build on them, do NOT redo):\n${prior.findings.map((f) => `- ${f}`).join('\n')}\n\nFOCUS this pass on RESOLVING these still-open unknowns - dig hard until each is answered, then move it into concreteFindings and shrink the unknowns list:\n${prior.unknowns.map((u) => `- ${u}`).join('\n')}`
    : '';
  const steerBlock = steer && steer.trim() ? `THE OWNER EXPLICITLY ASKS YOU TO ALSO INVESTIGATE/VERIFY THIS - make it a TOP priority of this pass and report concrete findings on it:\n"${steer.trim()}"` : '';
  return [
    `You are the FEASIBILITY investigator. Produce a DEEP, EXHAUSTIVE, CONCRETE feasibility dossier for this Servitium opportunity.`,
    steerBlock,
    priorBlock,
    `Be RELENTLESS: run MANY web searches (aim for 10+), open and read the ACTUAL docs, RCON command references, .ini/config`,
    `references, mod/plugin pages, API docs, and real community threads. Cross-check every claim against a real source.`,
    `Do NOT stop at the first answer - dig until the technical mechanism is fully pinned end to end.`,
    `The bar is an instruction dossier, never an idea. Gold standard: not "integrate Rust" but "Rust players want a shop;`,
    `doable via RCON; the .ini key that changes is X; get the player's SteamID via command Y; give an item via`,
    `inventory.giveto <id> <item>; limits: Z". Every "concreteFindings" entry must be a SPECIFIC, verified technical fact`,
    `(a real command, config key, API endpoint, version constraint) with enough detail to act on. List 6-12 of them.`,
    `If something is genuinely unknown after searching, put it in "unknowns" - never bluff or invent.`,
    `Opportunity: ${opp.title}\nThesis: ${opp.thesis}\nWhy now: ${opp.whyNow}\nFit: ${opp.fit}\nSources: ${sources}`,
    `Work entirely in English for max quality; a separate step translates the brief for display.`,
    `Output ONLY JSON: {"recommendation":"build-now|incubate|park|drop","verdict":"2-3 sentences owner-facing",`,
    `"targetApp":"servitium-api|center|portal|ui|electron-gui|new-app","concreteFindings":["real commands/config/API details, each specific"],`,
    `"unknowns":["what a spike must answer first"],"approachSteps":["step naming real files/dirs"],"dataModel":string,"outOfScope":string,`,
    `"acceptanceCriteria":["objectively checkable"],"testStrategy":string,"verifyCommands":["npm run build", "..."],"reviewChecklist":["..."]}.`,
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
