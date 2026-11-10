import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// A server that is ended from outside (taskkill /F, a closed window) writes nothing to its log, and the next start could not say
// when it had stopped. This keeps a small file the running server touches every few seconds and marks on a normal exit, so the
// next start can tell "ended by itself" from "ended from outside" and say when it was last seen alive.

export type AliveMarker = { pid: number; startedAt: string; aliveAt: string; exited: boolean };

export function readMarker(file: string): AliveMarker | null {
  try {
    const m = JSON.parse(readFileSync(file, "utf8")) as Partial<AliveMarker>;
    return typeof m.pid === "number" && typeof m.aliveAt === "string" && typeof m.startedAt === "string" ? { pid: m.pid, startedAt: m.startedAt, aliveAt: m.aliveAt, exited: m.exited === true } : null;
  } catch {
    return null;
  }
}

/** One log line about the previous server, or null when it ended normally (or there was none). */
export function describePrevious(prev: AliveMarker | null): string | null {
  if (!prev || prev.exited) return null;
  return `the previous server (pid ${prev.pid}, started ${prev.startedAt}) did not exit normally: it was last seen alive at ${prev.aliveAt}. It was ended from outside (a forced kill, a closed window or a power loss); a crash would have left a message in the log`;
}

export function startAliveMarker(file: string, intervalMs = 15_000): void {
  const startedAt = new Date().toISOString();
  const write = (exited: boolean) => {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      const m: AliveMarker = { pid: process.pid, startedAt, aliveAt: new Date().toISOString(), exited };
      writeFileSync(file, JSON.stringify(m));
    } catch {
      /* a marker that cannot be written must never stop the server */
    }
  };
  write(false);
  setInterval(() => write(false), intervalMs).unref();
  process.once("exit", () => write(true));
}
