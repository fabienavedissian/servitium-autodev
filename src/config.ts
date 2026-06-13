import { z } from 'zod';

const ConfigSchema = z.object({
  // Secrets: optional at parse time, asserted by assertRuntimeSecrets() before the loop runs.
  ANTHROPIC_API_KEY: z.string().optional(),
  GITHUB_PAT: z.string().optional(),
  GITHUB_ORG: z.string().default('fabienavedissian'),
  TARGET_REPOS: z.string().default('servitium-api'),

  // Spend caps (USD). Monthly is the primary kill-switch; daily only paces.
  MONTHLY_SPEND_CAP_USD: z.coerce.number().positive().default(100),
  DAILY_SPEND_CAP_USD: z.coerce.number().positive().default(10),
  PER_TASK_BUDGET_USD: z.coerce.number().positive().default(10),

  // Anti-loop backstops.
  MAX_LOOPS_PER_TASK: z.coerce.number().int().positive().default(4),
  MAX_OPUS_REENTRIES: z.coerce.number().int().nonnegative().default(1),
  MAX_TURNS_PER_STEP: z.coerce.number().int().positive().default(12),

  // Cadence.
  POLL_INTERVAL_MIN: z.coerce.number().int().positive().default(15),

  // Intelligence Engine (SIE): daily veille -> scored opportunities -> briefs. Separate budget scope
  // so the ~50 EUR intel lane can neither starve nor be starved by the build lane.
  SIE_ENABLED: z.coerce.boolean().default(true),
  SIE_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(5),
  SIE_MONTHLY_CAP_USD: z.coerce.number().positive().default(45), // ~50 EUR, headroom for Opus variance
  SIE_DAILY_CAP_USD: z.coerce.number().positive().default(3),
  SIE_RUN_BUDGET_USD: z.coerce.number().positive().default(2.2), // per-run hard abort (skips brief first)
  SIE_BRIEF_TOP_N: z.coerce.number().int().nonnegative().default(1),
  PER_BRIEF_BUDGET_USD: z.coerce.number().positive().default(1.2),

  // Paths.
  DB_PATH: z.string().default('./autodev.db'),
  WORK_ROOT: z.string().default('./.work'),
  MIRROR_ROOT: z.string().default('./.mirrors'),
  MONGOMS_DOWNLOAD_DIR: z.string().optional(),

  // Dashboard.
  DASH_SESSION_SECRET: z.string().optional(),
  DASH_USER: z.string().optional(),
  DASH_PASSWORD_SHA256: z.string().optional(),
  API_AUTH_URL: z.string().default('https://api.servitium.org/auth/login'),
  COOKIE_DOMAIN: z.string().default('.servitium.org'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Invalid AutoDev configuration: ${issues}`);
  }
  return parsed.data;
}

export function targetRepos(cfg: Config): string[] {
  return cfg.TARGET_REPOS.split(',').map((s) => s.trim()).filter(Boolean);
}

// The secrets that must be present before the orchestrator can do real work.
export function assertRuntimeSecrets(cfg: Config): void {
  const missing: string[] = [];
  if (!cfg.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
  if (!cfg.GITHUB_PAT) missing.push('GITHUB_PAT');
  if (missing.length) throw new Error(`Missing required secrets: ${missing.join(', ')}`);
}
