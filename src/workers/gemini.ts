/**
 * GeminiWorker - runs a task through the Gemini CLI the user already has
 * installed, in non-interactive mode. Same shape as ClaudeCodeWorker
 * (spec section 12): research, summarizing, idea organization.
 */

import { spawn } from 'node:child_process';
import type { Worker, WorkerDefinition, WorkerRunRequest, WorkerRunResult } from './types.ts';
import type { SpawnFn } from './claude-code.ts';

export type GeminiWorkerOptions = {
  workspace: string;
  binary?: string;
  timeout_ms?: number;
  retry?: number;
  enabled?: boolean;
  spawnFn?: SpawnFn;
};

export class GeminiWorker implements Worker {
  readonly definition: WorkerDefinition;
  private readonly binary: string;
  private readonly spawnFn: SpawnFn;

  constructor(opts: GeminiWorkerOptions) {
    this.binary = opts.binary ?? 'gemini';
    this.spawnFn = opts.spawnFn ?? spawn;
    this.definition = {
      name: 'gemini',
      type: 'gemini',
      status: 'ready',
      capabilities: ['research', 'write', 'general'],
      input_method: 'cli',
      output_method: 'stdout',
      workspace: opts.workspace,
      timeout_ms: opts.timeout_ms ?? 10 * 60 * 1000,
      retry: opts.retry ?? 0,
      enabled: opts.enabled ?? true,
    };
  }

  async run(request: WorkerRunRequest): Promise<WorkerRunResult> {
    if (!this.definition.enabled) {
      return { status: 'failed', summary: 'worker disabled', output: '', files: [], error: 'disabled' };
    }

    const cwd = request.cwd ?? this.definition.workspace;
    const args = ['-p', request.prompt];

    try {
      const { code, stdout, stderr } = await this.exec(args, cwd, this.definition.timeout_ms);
      if (code !== 0) {
        return {
          status: 'failed',
          summary: `gemini exited with code ${code}`,
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
        summary: 'gemini worker threw',
        output: '',
        files: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private exec(
    args: string[],
    cwd: string,
    timeoutMs: number
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = this.spawnFn(this.binary, args, {
        cwd,
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`gemini worker timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });
  }
}
