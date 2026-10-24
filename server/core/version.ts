import { readdirSync, statSync } from "node:fs";
import path from "node:path";

// "Is the code on disk newer than the code this process loaded?" The server is started
// once and keeps running, so after an edit (or a git pull) an old process quietly keeps
// serving the old behaviour. Comparing the newest source mtime at boot with the newest
// one now tells the UI to ask for a restart.

/** Newest modification time (ms) of the server's source files; test files are ignored. */
export function newestSourceMtime(serverDir: string): number {
  let newest = 0;
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(abs);
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
        newest = Math.max(newest, statSync(abs).mtimeMs);
      }
    }
  };
  try {
    walk(serverDir);
  } catch {
    // a folder that cannot be read (e.g. a packaged build without sources) is simply never "stale"
  }
  return newest;
}

export class VersionWatch {
  private readonly bootMtime: number;
  private readonly startedAt = new Date().toISOString();
  private cache: { at: number; stale: boolean } | null = null;

  constructor(
    private readonly serverDir: string,
    private readonly ttlMs = 5_000,
  ) {
    this.bootMtime = newestSourceMtime(serverDir);
  }

  status(): { startedAt: string; pid: number; stale: boolean } {
    const now = Date.now();
    if (!this.cache || now - this.cache.at > this.ttlMs) this.cache = { at: now, stale: newestSourceMtime(this.serverDir) > this.bootMtime };
    return { startedAt: this.startedAt, pid: process.pid, stale: this.cache.stale };
  }
}
