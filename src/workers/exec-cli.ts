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

/**
 * Cheap presence check for a CLI binary - spawns it with `--version` and
 * watches for spawn failure specifically (ENOENT = binary not found on
 * PATH). Any other outcome (clean exit, non-zero exit because `--version`
 * isn't a recognized flag, even a timeout) means the OS successfully found
 * and started the binary, so it's treated as present. This is a presence
 * check, not a health/auth check - a binary that exists but isn't logged
 * in still counts as "available" here, matching the existing pattern
 * elsewhere in this codebase of not issuing a real (possibly costed) probe
 * just to report status.
 */
export function checkBinaryAvailable(spawnFn: SpawnFn, binary: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(available);
    };

    let child: ReturnType<SpawnFn>;
    try {
      child = spawnFn(binary, ['--version'], { stdio: 'ignore' });
    } catch (err: unknown) {
      finish((err as NodeJS.ErrnoException)?.code !== 'ENOENT');
      return;
    }

    timer = setTimeout(() => {
      child.kill();
      finish(true);
    }, timeoutMs);

    child.once('error', (err: NodeJS.ErrnoException) => finish(err?.code !== 'ENOENT'));
    child.once('exit', () => finish(true));
  });
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
