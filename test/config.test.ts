import { loadConfig, assertRuntimeSecrets, targetRepos } from '../src/config';

describe('config', () => {
  it('applies sensible defaults', () => {
    const cfg = loadConfig({});
    expect(cfg.MONTHLY_SPEND_CAP_USD).toBe(100);
    expect(cfg.DAILY_SPEND_CAP_USD).toBe(10);
    expect(cfg.PER_TASK_BUDGET_USD).toBe(10);
    expect(cfg.TARGET_REPOS).toBe('servitium-api');
    expect(cfg.GITHUB_ORG).toBe('fabienavedissian');
    expect(cfg.MAX_LOOPS_PER_TASK).toBe(4);
    expect(cfg.MAX_OPUS_REENTRIES).toBe(1);
  });

  it('coerces numeric env strings', () => {
    const cfg = loadConfig({ MONTHLY_SPEND_CAP_USD: '50', POLL_INTERVAL_MIN: '5' } as NodeJS.ProcessEnv);
    expect(cfg.MONTHLY_SPEND_CAP_USD).toBe(50);
    expect(cfg.POLL_INTERVAL_MIN).toBe(5);
  });

  it('rejects invalid numbers', () => {
    expect(() => loadConfig({ DAILY_SPEND_CAP_USD: 'abc' } as NodeJS.ProcessEnv)).toThrow(/Invalid AutoDev configuration/);
  });

  it('parses TARGET_REPOS into a list', () => {
    const cfg = loadConfig({ TARGET_REPOS: 'servitium-api, servitium-ui' } as NodeJS.ProcessEnv);
    expect(targetRepos(cfg)).toEqual(['servitium-api', 'servitium-ui']);
  });

  it('asserts runtime secrets are present', () => {
    const cfg = loadConfig({});
    expect(() => assertRuntimeSecrets(cfg)).toThrow(/ANTHROPIC_API_KEY/);
  });
});
