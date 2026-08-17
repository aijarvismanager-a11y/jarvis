/**
 * ClaudeCodeWorker - runs a task through the Claude Code CLI the user
 * already has installed, in headless mode (`claude -p`). No API key: this
 * shells out to the same `claude` binary as an interactive session, so it
 * inherits whatever auth the user already has (spec section 1.1, 11).
 */

import { spawn } from 'node:child_process';
import type { Worker, WorkerDefinition, WorkerRunRequest, WorkerRunResult } from './types.ts';

export type SpawnFn = typeof spawn;

export type ClaudeCodeWorkerOptions = {
  workspace: string;
  /** Binary name/path for the CLI. Defaults to `claude` on PATH. */
  binary?: string;
  timeout_ms?: number;
  retry?: number;
  enabled?: boolean;
  /** Injected for tests; defaults to node:child_process.spawn. */
  spawnFn?: SpawnFn;
};

export class ClaudeCodeWorker implements Worker {
  readonly definition: WorkerDefinition;
  private readonly binary: string;
  private readonly spawnFn: SpawnFn;

  constructor(opts: ClaudeCodeWorkerOptions) {
    this.binary = opts.binary ?? 'claude';
    this.spawnFn = opts.spawnFn ?? spawn;
    this.definition = {
      name: 'claude_code',
      type: 'claude_code',
      status: 'ready',
      capabilities: ['code', 'plan', 'general'],
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
    const args = ['-p', request.prompt, '--output-format', 'text'];

    try {
      const { code, stdout, stderr } = await this.exec(args, cwd, this.definition.timeout_ms);
      if (code !== 0) {
        // The CLI often writes its actual failure reason (e.g. "Not logged
        // in - Please run /login") to stdout rather than stderr, so prefer
        // stdout over a generic "exit N" when stderr has nothing useful.
        return {
          status: 'failed',
          summary: `claude exited with code ${code}`,
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
        summary: 'claude worker threw',
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
      // stdin: 'ignore' - an open-but-empty pipe makes some CLIs (Claude
      // Code included) wait several seconds "in case" stdin data arrives.
      // This worker never pipes input, so close stdin immediately.
      const child = this.spawnFn(this.binary, args, {
        cwd,
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`claude worker timed out after ${timeoutMs}ms`));
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
