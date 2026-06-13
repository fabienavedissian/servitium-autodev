import type { CommandResult, RunOptions, SandboxRunner } from '../../src/sandbox/run';

type Responder = (command: string, args: string[], opts: RunOptions) => CommandResult | undefined;

// Test double for SandboxRunner: scripts command output so gate logic can be unit-tested
// deterministically without the real tools (jest/tsc/npm) or a network.
export class FakeRunner implements SandboxRunner {
  readonly kind = 'fake';
  readonly calls: { command: string; args: string[] }[] = [];

  constructor(private readonly responder: Responder) {}

  run(command: string, args: string[], opts: RunOptions): CommandResult {
    this.calls.push({ command, args });
    return this.responder(command, args, opts) ?? result({});
  }
}

export function result(partial: Partial<CommandResult>): CommandResult {
  return { exitCode: 0, stdout: '', stderr: '', timedOut: false, ...partial };
}
