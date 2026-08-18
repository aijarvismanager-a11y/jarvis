/**
 * Shared subprocess-exec helper for the CLI-based Workers (ClaudeCodeWorker,
 * GeminiWorker, CommandWorker) - spawn, timeout/kill, and stdout/stderr
 * accumulation, previously copy-pasted verbatim in each of them.
 */

import type { SpawnFn } from './claude-code.ts';
import type { WorkerRunResult } from './types.ts';

/**
 * Re-run `attempt` up to `1 + retries` times, stopping at the first non-
 * 'failed' result. `WorkerDefinition.retry` was previously plumbed all the
 * way from the API (routes.ts) into every Worker's definition but never
 * actually consumed anywhere - setting it had zero effect on behavior.
 */
export async function withWorkerRetries(
  retries: number,
  attempt: (attemptNumber: number) => Promise<WorkerRunResult>,
  onRetry?: (attemptNumber: number, result: WorkerRunResult) => void,
): Promise<WorkerRunResult> {
  const maxAttempts = 1 + Math.max(0, retries);
  let result: WorkerRunResult;
  for (let i = 1; i <= maxAttempts; i++) {
    result = await attempt(i);
    if (result.status !== 'failed' || i === maxAttempts) return result;
    onRetry?.(i, result);
  }
  return result!;
}

export function execCli(
  spawnFn: SpawnFn,
  binary: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  label: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // stdin: 'ignore' - an open-but-empty pipe makes some CLIs (Claude
    // Code included) wait several seconds "in case" stdin data arrives.
    // These workers never pipe input, so close stdin immediately.
    const child = spawnFn(binary, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
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
