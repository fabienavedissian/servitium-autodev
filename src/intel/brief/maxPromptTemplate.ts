import { CONVENTIONS } from '../../agents/prompts';

// The hybrid deep-investigation output: a deterministic concrete brief (no extra LLM call) + a
// ready-to-paste Max prompt (the economic linchpin: the human runs it on the flat-rate plan) + an
// optional "go deeper on Max" investigation prompt. SIE emits TEXT, never code.

export interface Feasibility {
  recommendation: 'build-now' | 'incubate' | 'park' | 'drop';
  verdict: string;
  targetApp: string;
  concreteFindings: string[];
  unknowns: string[];
  approachSteps: string[];
  dataModel?: string;
  outOfScope?: string;
  acceptanceCriteria: string[];
  testStrategy?: string;
  verifyCommands: string[];
  reviewChecklist: string[];
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
    `## Pourquoi maintenant`,
    opp.whyNow ?? '(n/a)',
    `Sources : ${sourceList(opp.sources)}`,
    ``,
    `## Constats concrets (le detail actionnable)`,
    list(f.concreteFindings),
    ``,
    `## Inconnues a lever EN PREMIER`,
    list(f.unknowns),
    ``,
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
export function renderMaxPrompt(opp: OppLite, f: Feasibility, score: number): string {
  return [
    `You are working in the Servitium monorepo (E:\\Servitium Project). Read CLAUDE.md and the memory index`,
    `at C:\\Users\\Fabien\\.claude\\projects\\e--Servitium-Project\\memory\\MEMORY.md FIRST, then the README of the app`,
    `you will touch. Do not re-derive flows from source.`,
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
    `# Resolve these unknowns FIRST (quick spike, STOP and report if any is a blocker)`,
    list(f.unknowns),
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
    `# Test strategy`,
    f.testStrategy ?? 'API: green mongodb-memory-server integration test. Angular: spec + i18n keys in all 6 languages.',
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
    `Deliver: (1) a verified feasibility verdict, (2) the exact technical mechanism end-to-end, (3) a phased build`,
    `plan naming real files in the Servitium monorepo, (4) risks + edge cases, (5) a test strategy. Read CLAUDE.md`,
    `and MEMORY.md first. Use as many search/verification steps as needed - do not stop at the first answer.`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}
