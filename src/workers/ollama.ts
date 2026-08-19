/**
 * OllamaWorker - runs a task through the `ollama` CLI the user already has
 * installed, entirely on the user's own machine. This is the "Local LLM"
 * Provider Adapter the spec lists alongside Claude/Gemini/ChatGPT (section
 * 22/36 Phase 6, section 41's architecture diagram's "Future Provider
 * Adapters") - a generalist fallback that costs nothing and needs no
 * network connection, distinct from src/llm/ollama.ts (which wires Ollama
 * in as an internal LLM *tier* provider for JARVIS's own reasoning, not as
 * an external AI the Router hands a whole task to).
 */

import { spawn } from 'node:child_process';
import type { Worker, WorkerDefinition, WorkerRunRequest, WorkerRunResult } from './types.ts';
import type { SpawnFn } from './claude-code.ts';
import { checkBinaryAvailable, execCli, withWorkerRetries } from './exec-cli.ts';

export type OllamaWorkerOptions = {
  workspace: string;
  /** Binary name/path for the CLI. Defaults to `ollama` on PATH. */
  binary?: string;
  /** Model to run, e.g. "llama3.1", "qwen2.5". Defaults to "llama3". */
  model?: string;
  timeout_ms?: number;
  retry?: number;
  enabled?: boolean;
  spawnFn?: SpawnFn;
};

export class OllamaWorker implements Worker {
  readonly definition: WorkerDefinition;
  private readonly binary: string;
  private readonly model: string;
  private readonly spawnFn: SpawnFn;

  constructor(opts: OllamaWorkerOptions) {
    this.binary = opts.binary ?? 'ollama';
    this.model = opts.model ?? 'llama3';
    this.spawnFn = opts.spawnFn ?? spawn;
    this.definition = {
      name: 'ollama',
      type: 'ollama',
      status: 'ready',
      capabilities: ['general', 'write', 'research'],
      input_method: 'cli',
      output_method: 'stdout',
      workspace: opts.workspace,
      timeout_ms: opts.timeout_ms ?? 5 * 60 * 1000,
      retry: opts.retry ?? 0,
      enabled: opts.enabled ?? false,
    };
  }

  async run(request: WorkerRunRequest): Promise<WorkerRunResult> {
    if (!this.definition.enabled) {
      return { status: 'failed', summary: 'worker disabled', output: '', files: [], error: 'disabled' };
    }
    return withWorkerRetries(this.definition.retry, () => this.runOnce(request), (attempt, result) =>
      console.warn(`[OllamaWorker] attempt ${attempt} failed (${result.error}), retrying...`));
  }

  checkAvailable(): Promise<boolean> {
    return checkBinaryAvailable(this.spawnFn, this.binary);
  }

  private async runOnce(request: WorkerRunRequest): Promise<WorkerRunResult> {
    const cwd = request.cwd ?? this.definition.workspace;
    // `ollama run <model> <prompt>` streams the reply to stdout and exits
    // once generation finishes - no server-side session, no API key.
    const args = ['run', this.model, request.prompt];

    try {
      const { code, stdout, stderr } = await execCli(this.spawnFn, this.binary, args, cwd, this.definition.timeout_ms, 'ollama worker');
      if (code !== 0) {
        return {
          status: 'failed',
          summary: `ollama exited with code ${code}`,
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
        summary: 'ollama worker threw',
        output: '',
        files: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
