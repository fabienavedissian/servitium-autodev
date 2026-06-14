import { PER_APP_CONTEXT, NEW_GAME_PLAYBOOK, TARGET_APP_ENUM, FEATURE_CATALOG } from './generatedContext';

// The injectable per-app grounding the engine hands to the feasibility + Max prompts: once the
// brief knows its targetApp, the concrete file map / patterns / test rule for THAT app go into the
// prompt verbatim, so "name real files" becomes grounded fact instead of a hope. From the corpus.
export { NEW_GAME_PLAYBOOK, FEATURE_CATALOG };

// The 8 valid target apps (7 repos + new-app). Single source for the feasibility enum + verify mapping.
export const TARGET_APPS: readonly string[] = TARGET_APP_ENUM;

// Short aliases the LLM tends to emit -> canonical repo name.
const ALIAS: Record<string, string> = {
  api: 'servitium-api',
  center: 'servitium-center',
  portal: 'servitium-portal',
  ui: 'servitium-ui',
  'electron-gui': 'servitium-electron-gui',
  agent: 'servitium-electron-gui',
  discord: 'servitium-discord',
  autodev: 'servitium-autodev',
};

export function canonicalApp(app?: string | null): string {
  const a = (app ?? '').trim();
  if (!a) return '';
  if (PER_APP_CONTEXT[a]) return a;
  if (ALIAS[a]) return ALIAS[a];
  const withPrefix = a.startsWith('servitium-') ? a : `servitium-${a}`;
  return PER_APP_CONTEXT[withPrefix] ? withPrefix : a;
}

// The concrete file-map / patterns / test+strictness block for one app (empty for new-app / unknown).
export function getAppContext(app?: string | null): string {
  return PER_APP_CONTEXT[canonicalApp(app)] ?? '';
}

// The per-repo test requirement (impactedAppsDesign s2): a mongodb-memory-server test is API-ONLY;
// every other repo has its own harness (or none). Never demand a memory-server test on an Angular repo.
const APP_TEST_RULE: Record<string, string> = {
  'servitium-api': 'green mongodb-memory-server integration test (real models, stubbed IO); coverage holds >= 70%',
  'servitium-center': 'Angular TestBed + HttpTestingController spec (expectOne url+method+body, flush, http.verify) — NOT mongodb-memory-server',
  'servitium-portal': 'NO unit-test harness exists; verify by `ng build` (production) + manual/visual check against prod. Do NOT fabricate a test harness',
  'servitium-ui': 'ng test (karma/jasmine) component spec if behaviour is non-trivial; rebuild the tgz (npm run build:pack) + note the consumer reinstall',
  'servitium-electron-gui': 'jest spec colocated with the source, stub IO + real classes (mirror the nearest *.spec.ts) — NOT mongodb-memory-server',
  'servitium-discord': 'ng test (karma/jasmine); fix the stale app.spec.ts if touched; any backend change ships the API memory-server test',
  'servitium-autodev': 'jest + ts-jest unit test in test/*.test.ts mirroring the house rule',
  'new-app': 'state the chosen test harness explicitly in the spec',
};

export function testRuleFor(app?: string | null): string {
  return APP_TEST_RULE[canonicalApp(app)] ?? APP_TEST_RULE['servitium-api'];
}

// True when an opportunity is a new-game integration (kind 'game' or a "game:" dedupKey) — the cue to
// inject the exhaustive new-game playbook so the brief enumerates the real per-repo wiring + gotchas.
export function isGameOpp(kind?: string | null, dedupKey?: string | null): boolean {
  return (kind ?? '').toLowerCase() === 'game' || (dedupKey ?? '').toLowerCase().startsWith('game:');
}
