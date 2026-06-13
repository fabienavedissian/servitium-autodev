import { tscGate } from './tsc';
import { testsGreenGate, testsRedGate } from './jest';
import { coverageDiffGate } from './coverageDiff';
import { immutabilityGate } from './immutability';
import { relevanceGate } from './relevance';
import { auditGate, semgrepGate, gitleaksGate } from './security';
import { scopeDiffGate } from './scopeDiff';
import type { Gate, GateName } from './index';

// Only implemented gates are registered (lint/coverage-aggregate land with their config later).
export const GATES: Partial<Record<GateName, Gate>> = {
  tsc: tscGate,
  'tests-green': testsGreenGate,
  'tests-red': testsRedGate,
  'coverage-diff': coverageDiffGate,
  immutability: immutabilityGate,
  relevance: relevanceGate,
  audit: auditGate,
  semgrep: semgrepGate,
  gitleaks: gitleaksGate,
  'scope-diff': scopeDiffGate,
};
