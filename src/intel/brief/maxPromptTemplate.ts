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
    `Tu travailles dans le monorepo Servitium (E:\\Servitium Project). Lis CLAUDE.md et l'index memoire`,
    `C:\\Users\\Fabien\\.claude\\projects\\e--Servitium-Project\\memory\\MEMORY.md EN PREMIER, puis le README de l'app`,
    `que tu vas toucher. Ne re-derive pas les flux depuis le code source.`,
    ``,
    `# Objectif`,
    `${f.verdict}`,
    `App cible : ${f.targetApp}. Opportunite ${f.recommendation} (faisabilite ${score}/100).`,
    ``,
    `# Contexte`,
    `- Opportunite : ${opp.title}`,
    opp.thesis ? `- These : ${opp.thesis}` : '',
    opp.whyNow ? `- Pourquoi maintenant : ${opp.whyNow}` : '',
    opp.fit ? `- Lien avec Servitium : ${opp.fit}` : '',
    `- Constats concrets de l'investigation :`,
    list(f.concreteFindings),
    `- Sources : ${sourceList(opp.sources)}`,
    ``,
    `# Leve ces inconnues EN PREMIER (spike rapide, STOP et signale si l'une est bloquante)`,
    list(f.unknowns),
    ``,
    `# Approche proposee`,
    list(f.approachSteps),
    f.dataModel ? `Donnees/modele touches : ${f.dataModel}` : '',
    f.outOfScope ? `Hors scope (a NE PAS faire) : ${f.outOfScope}` : '',
    ``,
    `# Contraintes dures (conventions Servitium - non negociables)`,
    CONVENTIONS,
    ``,
    `# Criteres d'acceptation (chacun doit etre verifiable objectivement)`,
    list(f.acceptanceCriteria),
    ``,
    `# Strategie de test`,
    f.testStrategy ?? 'API : test d integration mongodb-memory-server vert. Angular : spec + cles i18n dans les 6 langues.',
    ``,
    `# Plan de build pour CETTE session`,
    `1. Confirme les inconnues ci-dessus par un spike rapide ; STOP et signale si l'une est bloquante.`,
    `2. Implemente selon l'approche, en commits atomiques.`,
    `3. Lance : ${(f.verifyCommands ?? ['npm run build']).join(' && ')}`,
    `4. Auto-revue contre les criteres d'acceptation et les conventions avant de declarer termine.`,
    ``,
    `# Checklist de revue avant de declarer termine`,
    list(f.reviewChecklist),
    ``,
    `Si quelque chose est ambigu, pose-moi une seule serie de questions groupees, puis avance.`,
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
