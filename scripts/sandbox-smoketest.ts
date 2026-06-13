/**
 * Proves the bubblewrap gate sandbox on Linux (Box B): no network, worktree writable, and the host
 * home / ~/.ssh / the orchestrator .env are NOT visible inside. Run on the box: node dist/scripts/sandbox-smoketest.js
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BubblewrapRunner } from '../src/sandbox/run';

function main(): void {
  if (process.platform !== 'linux') {
    console.error('Sandbox smoke-test must run on Linux (Box B).');
    process.exit(1);
  }
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'autodev-sbx-'));
  const runner = new BubblewrapRunner([]);

  const net = runner.run(
    'node',
    ['-e', "const t=setTimeout(()=>{console.log('NET_BLOCKED');process.exit(0)},4000);require('https').get('https://example.com',()=>{clearTimeout(t);console.log('NET_OPEN');process.exit(0)}).on('error',()=>{clearTimeout(t);console.log('NET_BLOCKED');process.exit(0)})"],
    { cwd: wt, timeoutMs: 8000 },
  );
  const write = runner.run('sh', ['-c', 'echo hi > probe.txt && cat probe.txt'], { cwd: wt });
  const secrets = runner.run(
    'sh',
    ['-c', 'echo "HOME=$HOME"; ls -a "$HOME" | tr "\\n" " "; echo; echo "ssh:"; ls ~/.ssh 2>&1 | head -1; echo "env:"; cat /home/ubuntu/autodev/.env 2>&1 | head -1'],
    { cwd: wt },
  );

  console.log('\n=== bubblewrap sandbox verification (Box B) ===');
  console.log('network    :', net.stdout.trim(), net.stdout.includes('NET_BLOCKED') ? 'PASS' : 'FAIL');
  console.log('worktree rw:', write.stdout.trim() === 'hi' ? 'PASS (hi)' : `FAIL (${write.stdout.trim()})`);
  console.log('secrets    :');
  console.log(secrets.stdout.split('\n').map((l) => '   ' + l).join('\n'));
  const secretsOk = !secrets.stdout.includes('ANTHROPIC') && !/id_ed25519|id_rsa|authorized_keys/.test(secrets.stdout) && secrets.stdout.includes(`HOME=${wt}`);
  console.log('secrets isolated:', secretsOk ? 'PASS (home=worktree, no .ssh, .env unreadable)' : 'CHECK output above');

  fs.rmSync(wt, { recursive: true, force: true });
  const allPass = net.stdout.includes('NET_BLOCKED') && write.stdout.trim() === 'hi' && secretsOk;
  console.log(allPass ? '\nSANDBOX OK' : '\nSANDBOX: review above');
  process.exit(allPass ? 0 : 2);
}

main();
