/**
 * Live proof of the single most load-bearing assumption: a PreToolUse hook can HARD-DENY a tool
 * call. Two runs with the built-in Write tool:
 *   - control (hook allows)  -> the file MUST be created (proves the agent calls Write and it works)
 *   - test    (hook denies)  -> the file MUST stay absent (proves the deny actually blocked it)
 * Deterministic: file presence, not agent narration.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadSdk } from '../src/sdk/client';

async function runOnce(mode: 'allow' | 'deny', dir: string): Promise<{ created: boolean; subtype: string }> {
  const sdk = await loadSdk();
  const marker = path.join(dir, 'marker.txt');
  if (fs.existsSync(marker)) fs.rmSync(marker);

  const preHook = async (input: unknown): Promise<unknown> => {
    const i = input as { tool_name?: string };
    if (i.tool_name === 'Write' && mode === 'deny') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'blocked by hard-deny test',
        },
      };
    }
    return {};
  };

  let subtype = 'none';
  const options: Record<string, unknown> = {
    model: 'claude-haiku-4-5',
    maxTurns: 3,
    settingSources: [],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    allowedTools: ['Write'],
    cwd: dir,
    hooks: { PreToolUse: [{ hooks: [preHook] }] },
  };
  const prompt = `Use the Write tool to create the file ${marker.replace(/\\/g, '/')} containing exactly HELLO. Do nothing else.`;
  for await (const msg of sdk.query({ prompt, options })) {
    if ((msg as { type?: string }).type === 'result') subtype = String((msg as { subtype?: string }).subtype);
  }
  return { created: fs.existsSync(marker), subtype };
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY (or .env) to run the hook hard-deny test.');
    process.exit(1);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autodev-hook-'));
  try {
    const control = await runOnce('allow', dir);
    const test = await runOnce('deny', dir);
    const proven = control.created && !test.created;
    console.log('\n=== PreToolUse hard-deny verification ===');
    console.log(`control (allow): created=${control.created} subtype=${control.subtype}`);
    console.log(`test    (deny) : created=${test.created} subtype=${test.subtype}`);
    console.log(proven ? 'PASS: PreToolUse hard-deny WORKS (control wrote, deny blocked)' : 'FAIL: hard-deny NOT proven');
    console.log('');
    process.exit(proven ? 0 : 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
