/**
 * CommandWorker - a generic CLI-subprocess Worker, configurable at
 * runtime instead of hardcoded like ClaudeCodeWorker/GeminiWorker. Backs
 * user-added "custom" Workers (spec section 10: `workers/custom/`,
 * completion checklist "Workerを追加できる") - any CLI the user already
 * has installed can be wired in without a code change.
 */

import spawn from 'cross-spawn';
import type { Worker, WorkerCapability, WorkerDefinition, WorkerRunRequest, WorkerRunResult } from './types.ts';
import type { SpawnFn } from './claude-code.ts';
import { checkBinaryAvailable, execCli, withWorkerRetries } from './exec-cli.ts';

export type CommandWorkerConfig = {
  name: string;
  /** Binary/command on PATH, e.g. "codex", "aider", "my-tool". */
  binary: string;
  /** Argv template. "{prompt}" is replaced with the task prompt verbatim; args without it are passed as-is. */
  args: string[];
  capabilities: WorkerCapability[];
  timeout_ms?: number;
  retry?: number;
  enabled?: boolean;
};

export type CommandWorkerOptions = CommandWorkerConfig & {
  workspace: string;
  spawnFn?: SpawnFn;
};

function substitutePrompt(args: string[], prompt: string): string[] {
  return args.some((a) => a.includes('{prompt}')) ? args.map((a) => a.replaceAll('{prompt}', prompt)) : [...args, prompt];
}

export class CommandWorker implements Worker {
  readonly definition: WorkerDefinition;
  private readonly binary: string;
  private readonly argsTemplate: string[];
  private readonly spawnFn: SpawnFn;

  constructor(opts: CommandWorkerOptions) {
    this.binary = opts.binary;
    this.argsTemplate = opts.args;
    this.spawnFn = opts.spawnFn ?? spawn;
    this.definition = {
      name: opts.name,
      type: 'custom',
      status: 'ready',
      capabilities: opts.capabilities,
      input_method: 'cli',
      output_method: 'stdout',
      workspace: opts.workspace,
      timeout_ms: opts.timeout_ms ?? 10 * 60 * 1000,
      retry: opts.retry ?? 0,
      enabled: opts.enabled ?? false,
    };
  }

  async run(request: WorkerRunRequest): Promise<WorkerRunResult> {
    if (!this.definition.enabled) {
      return { status: 'failed', summary: 'worker disabled', output: '', files: [], error: 'disabled' };
    }
    return withWorkerRetries(this.definition.retry, () => this.runOnce(request), (attempt, result) =>
      console.warn(`[CommandWorker:${this.binary}] attempt ${attempt} failed (${result.error}), retrying...`));
  }

  checkAvailable(): Promise<boolean> {
    return checkBinaryAvailable(this.spawnFn, this.binary);
  }

  private async runOnce(request: WorkerRunRequest): Promise<WorkerRunResult> {
    const cwd = request.cwd ?? this.definition.workspace;
    const args = substitutePrompt(this.argsTemplate, request.prompt);

    try {
      const { code, stdout, stderr } = await execCli(this.spawnFn, this.binary, args, cwd, this.definition.timeout_ms, `${this.binary} worker`);
      if (code !== 0) {
        return {
          status: 'failed',
          summary: `${this.binary} exited with code ${code}`,
          output: stdout,
          files: [],
          error: stderr.trim() || stdout.trim() || `exit ${code}`,
        };
      }
      return {
        status: 'completed',
        summary: stdout.split('\n').find((l) => l.trim().length > 0)?.slice(0, 200) ?? 'done',
        output: stdout,
        files: [],
      };
    } catch (err) {
      return {
        status: 'failed',
        summary: `${this.binary} worker threw`,
        output: '',
        files: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
