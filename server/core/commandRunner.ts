import { spawn, spawnSync } from "node:child_process";

// CommandRunner (spec Phase 3): the one place child processes are started.
// No command string is ever interpreted by a shell unless Windows forces it
// (.cmd shims); stdout/stderr are capped; timeout and abort kill the whole
// process tree (a plain child.kill() leaves grandchildren running on Windows).

export type CommandResult = { stdout: string; stderr: string; code: number | null; timedOut?: boolean };
export type CommandRunner = (
  command: string,
  args: string[],
  opts: { input?: string; cwd?: string; env?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number },
) => Promise<CommandResult>;

const MAX_OUTPUT_CHARS = 2_000_000;

/** True when the command must go through cmd.exe (Windows .cmd shims), where argument quoting is unreliable. */
export function needsShell(command: string, platform: string = process.platform): boolean {
  return platform === "win32" && !/\.exe$/i.test(command);
}

/** Kills a process and everything it started. */
export function killTree(pid: number | undefined, platform: string = process.platform): void {
  if (!pid) return;
  try {
    if (platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

export const spawnRunner: CommandRunner = (command, args, opts) =>
  new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env ? { ...process.env, ...opts.env } : undefined, shell: needsShell(command), windowsHide: true, detached: process.platform !== "win32" });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    const append = (cur: string, chunk: Buffer | string) => (cur.length >= MAX_OUTPUT_CHARS ? cur : cur + chunk);
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child.pid);
        }, opts.timeoutMs)
      : null;
    const onAbort = () => {
      aborted = true;
      killTree(child.pid);
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    };
    child.stdout.on("data", (d) => (stdout = append(stdout, d)));
    child.stderr.on("data", (d) => (stderr = append(stderr, d)));
    child.on("error", (e) => {
      cleanup();
      reject(e);
    });
    child.on("close", (code) => {
      cleanup();
      if (aborted) return reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      resolve({ stdout, stderr, code, timedOut });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(opts.input ?? "");
  });
