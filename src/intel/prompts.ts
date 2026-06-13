import { SERVITIUM_DOSSIER } from './dossier';
import { FEATURE_KEYS } from './score/rubric';

// All SIE agents output STRICT JSON only (parsed with parseJsonLoose). They never pick the next
// stage and never compute the final score — the FSM/code does. Grounding is the dossier blob.

const GROUND = `--- SERVITIUM CONTEXT ---\n${SERVITIUM_DOSSIER}\n--- END CONTEXT ---`;

export function harvestPrompt(angle: string, label: string, queries: string[]): string {
  return [
    `You are the HARVEST agent for the "${label}" (${angle}) veille lane of Servitium's intelligence engine.`,
    `Use web search for EACH of these queries and collect the most relevant RECENT results:`,
    queries.map((q, i) => `  ${i + 1}. ${q}`).join('\n'),
    `Return ONLY real results you actually found via search. Do NOT invent URLs or titles.`,
    `Output ONLY JSON: {"hits":[{"title":string,"url":string,"snippet":string,"publishedHint":string}]} (max 12 hits, dedup obvious repeats).`,
    GROUND,
  ].join('\n\n');
}

export function extractPrompt(angle: string, pages: { url: string; text: string }[]): string {
  return [
    `You are the EXTRACT agent for Servitium's "${angle}" veille lane. For each page below, extract a structured signal.`,
    `Be skeptical: if a page is SEO marketing, a stale repost, or irrelevant to deep game-server admin, set "relevant": false.`,
    `Do NOT fabricate quantitative claims (counts, percentages). Only state what the text supports.`,
    `Pages:\n${pages.map((p, i) => `[#${i}] ${p.url}\n${p.text.slice(0, 5000)}`).join('\n\n')}`,
    `Output ONLY JSON: {"signals":[{"index":number,"title":string,"summary":string,"sourceType":string,"claimedDate":string,"relevant":boolean}]}.`,
    GROUND,
  ].join('\n\n');
}

export function ideatePrompt(signals: { id: number; angle: string; title: string; summary: string }[], openTitles: string[]): string {
  return [
    `You are the IDEATOR for Servitium's intelligence engine. From today's fresh signals, propose concrete OPPORTUNITIES`,
    `for Servitium: features, new-game integrations, Discord-bot evolutions, monetization, or new business lines.`,
    `Each opportunity MUST be grounded in >=1 signal id and map onto Servitium's real product/edges. Concrete, not vague:`,
    `prefer "Rust players want a shop, doable via RCON" over "integrate Rust". Let weak lanes be empty - quality over quota.`,
    `Avoid duplicating anything already open: ${openTitles.length ? openTitles.join('; ') : '(none)'}.`,
    `IMPORTANT: search and reason in English, but write the owner-facing fields (title, thesis, whyNow, fit) in FRENCH - the owner reads them. Keep dedupKey and kind in English.`,
    `Signals:\n${signals.map((s) => `[signal:${s.id}] (${s.angle}) ${s.title} - ${s.summary}`).join('\n')}`,
    `Output ONLY JSON: {"opportunities":[{"kind":"feature|game|business|integration|pricing|tech-enabler","title":string,"thesis":string,"whyNow":string,"fit":string,"dedupKey":string,"evidence":[signalId],"sources":[{"label":string,"url":string}]}]} (max 6).`,
    `dedupKey = a slugified canonical noun, e.g. "game:rust", "business:hosting", "discord:premium-tickets".`,
    GROUND,
  ].join('\n\n');
}

export function scorerPrompt(opp: { title: string; thesis: string; whyNow: string; fit: string }, evidenceList: string): string {
  return [
    `You are the SCORER for Servitium's intelligence engine. Rate this opportunity on 8 features, each in [0,1].`,
    `You EXTRACT features; you do NOT compute a final score. For each feature, cite the evidence ids that justify it`,
    `(market/demand claims MUST cite a signal id; an axis with no evidence will be capped by code).`,
    `Opportunity: ${opp.title}\nThesis: ${opp.thesis}\nWhy now: ${opp.whyNow}\nFit: ${opp.fit}`,
    `Evidence available: ${evidenceList}`,
    `Write the "justifications" values in FRENCH (the owner reads them); keep feature keys in English.`,
    `Features: ${FEATURE_KEYS.join(', ')}.`,
    `  strategic_fit: 0 off-mission (becoming a host) .. 1 dead-center deep-admin/compounds edges`,
    `  demand_evidence: 0 no signal .. 1 cited competitor gaps / forum pain (MUST cite)`,
    `  feasibility: 0 needs infra we lack .. 1 drops into an existing app/pattern`,
    `  effort_inv: 1 days .. 0 quarters   |   revenue_proximity: 0 free-only .. 1 clean Pro/new billable`,
    `  moat_or_diff: 0 copyable .. 1 leverages agent/Rust/Discord   |   reversibility: 0 irreversible .. 1 cheap to abandon`,
    `  freshness: 0 already-known .. 1 net-new`,
    `Output ONLY JSON: {"features":{${FEATURE_KEYS.map((k) => `"${k}":0.0`).join(',')}},"justifications":{"<feature>":"... [signal:N]"},"evidenceCount":{"<feature>":<int sources cited>}}.`,
    GROUND,
  ].join('\n\n');
}

export function feasibilityPrompt(opp: { title: string; thesis: string; whyNow: string; fit: string }, sources: string): string {
  return [
    `You are the FEASIBILITY investigator. Produce a DEEP, CONCRETE feasibility dossier for this Servitium opportunity.`,
    `The bar is an instruction dossier, never an idea. Gold standard: not "integrate Rust" but "Rust players want a shop;`,
    `doable via RCON; the .ini key that changes is X; get the player's SteamID via command Y; give an item via`,
    `inventory.giveto <id> <item>; limits: Z". Use web search to find REAL commands, config keys, APIs, mod options,`,
    `and real community demand WITH sources. If something is unknown, say so in "unknowns" - never bluff.`,
    `Opportunity: ${opp.title}\nThesis: ${opp.thesis}\nWhy now: ${opp.whyNow}\nFit: ${opp.fit}\nSources: ${sources}`,
    `IMPORTANT: search and reason in English, but write ALL owner-facing text in FRENCH (verdict, concreteFindings, unknowns, approachSteps, dataModel, outOfScope, acceptanceCriteria, testStrategy, reviewChecklist). Keep recommendation/targetApp enums and verifyCommands (shell) as-is.`,
    `Output ONLY JSON: {"recommendation":"build-now|incubate|park|drop","verdict":"2-3 phrases pour le proprietaire",`,
    `"targetApp":"servitium-api|center|portal|ui|electron-gui|new-app","concreteFindings":["real commands/config/API details, each specific"],`,
    `"unknowns":["what a spike must answer first"],"approachSteps":["step naming real files/dirs"],"dataModel":string,"outOfScope":string,`,
    `"acceptanceCriteria":["objectively checkable"],"testStrategy":string,"verifyCommands":["npm run build", "..."],"reviewChecklist":["..."]}.`,
    GROUND,
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
