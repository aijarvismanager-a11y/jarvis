/**
 * Shared subprocess-exec helper for the CLI-based Workers (ClaudeCodeWorker,
 * GeminiWorker, CommandWorker) - spawn, timeout/kill, and stdout/stderr
 * accumulation, previously copy-pasted verbatim in each of them.
 */

import type { SpawnFn } from './claude-code.ts';

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
