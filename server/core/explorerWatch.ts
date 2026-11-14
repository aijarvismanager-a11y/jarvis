import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Store } from "./store.ts";

// Windows Explorer has been crashing on this PC and the cause is not known. This watches the Windows Application log for Explorer crashes
// and writes each one as an EXPLORER_CRASH event, together with what the orchestra was doing around that second (screen-check commands from
// tools/ui-probe, running tasks), so a repeating link can be read from the records instead of guessed.

export type ProbeEntry = { cmd: string; startMs: number; endMs: number | null };
export type Crash = { atMs: number; module: string; offset: string };

export const NEAR_MS = 120_000;

/** Parse the one-JSON-per-line probe log; bad lines are skipped. */
export function parseProbeLog(text: string): ProbeEntry[] {
  const out: ProbeEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line) as { cmd?: unknown; start?: unknown; end?: unknown };
      const startMs = typeof j.start === "string" ? Date.parse(j.start) : NaN;
      if (typeof j.cmd !== "string" || Number.isNaN(startMs)) continue;
      const endMs = typeof j.end === "string" ? Date.parse(j.end) : NaN;
      out.push({ cmd: j.cmd, startMs, endMs: Number.isNaN(endMs) ? null : endMs });
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Screen-check commands that were running at, or ended/started within `windowMs` before, the crash. Seconds are relative to the crash (negative = before). */
export function nearbyProbes(crashMs: number, log: ProbeEntry[], windowMs = NEAR_MS): { cmd: string; startSec: number; endSec: number | null; during: boolean }[] {
  return log
    .filter((p) => p.startMs <= crashMs && (p.endMs ?? p.startMs) >= crashMs - windowMs)
    .map((p) => ({
      cmd: p.cmd,
      startSec: Math.round((p.startMs - crashMs) / 1000),
      endSec: p.endMs === null ? null : Math.round((p.endMs - crashMs) / 1000),
      during: p.endMs === null || p.endMs >= crashMs,
    }));
}

/** Application Error events for Explorer.EXE newer than `sinceMs`, oldest first. */
export function fetchExplorerCrashes(sinceMs: number): Promise<Crash[]> {
  const ps = `$s=[DateTimeOffset]::FromUnixTimeMilliseconds(${Math.floor(sinceMs)}).LocalDateTime;` +
    `Get-WinEvent -FilterHashtable @{LogName='Application';ProviderName='Application Error';StartTime=$s} -ErrorAction SilentlyContinue | ` +
    `Where-Object { $_.Properties.Count -ge 8 -and $_.Properties[0].Value -eq 'Explorer.EXE' } | ForEach-Object { ` +
    `[pscustomobject]@{ at=$_.TimeCreated.ToUniversalTime().ToString('o'); module=[string]$_.Properties[3].Value; offset=[string]$_.Properties[7].Value } } | ConvertTo-Json -Compress`;
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve([]);
    execFile("powershell", ["-NoProfile", "-Command", ps], { timeout: 30_000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve([]);
      try {
        const j = JSON.parse(stdout) as unknown;
        const rows = (Array.isArray(j) ? j : [j]) as { at: string; module: string; offset: string }[];
        resolve(rows.map((r) => ({ atMs: Date.parse(r.at), module: r.module, offset: r.offset })).filter((c) => !Number.isNaN(c.atMs)).sort((a, b) => a.atMs - b.atMs));
      } catch {
        resolve([]);
      }
    });
  });
}

/** Writes EXPLORER_CRASH events for crashes not seen before. Returns how many were recorded. */
export async function recordNewCrashes(store: Store, stateFile: string, probeLogFile: string, now = Date.now()): Promise<number> {
  let last = 0;
  try { last = (JSON.parse(readFileSync(stateFile, "utf8")) as { lastMs?: number }).lastMs ?? 0; } catch { /* first run */ }
  if (!last) last = now - 7 * 86_400_000; // first run: the last week
  const crashes = (await fetchExplorerCrashes(last + 1)).filter((c) => c.atMs > last);
  if (!crashes.length) return 0;
  let log: ProbeEntry[] = [];
  try { log = parseProbeLog(readFileSync(probeLogFile, "utf8")); } catch { /* no probe has ever run */ }
  for (const c of crashes) {
    const running = (store.db.prepare("SELECT id, role FROM tasks WHERE status = 'running'").all() as { id: string; role: string }[]).map((r) => `${r.id}:${r.role}`);
    const probes = nearbyProbes(c.atMs, log);
    store.appendEvent({
      projectId: null,
      type: "EXPLORER_CRASH",
      payload: { at: new Date(c.atMs).toISOString(), module: c.module, offset: c.offset, probesNear: probes, probeDuring: probes.some((p) => p.during), runningTasksAtCheck: running },
    });
    last = c.atMs;
  }
  try { mkdirSync(path.dirname(stateFile), { recursive: true }); writeFileSync(stateFile, JSON.stringify({ lastMs: last })); } catch { /* retry next time */ }
  return crashes.length;
}

export function startExplorerWatch(store: Store, dataDir: string, intervalMs = 60_000): void {
  const stateFile = path.join(dataDir, "explorer-watch.json");
  const probeLog = path.join(dataDir, "ui-probe-log.jsonl");
  const tick = () => void recordNewCrashes(store, stateFile, probeLog).catch(() => undefined);
  setTimeout(tick, 15_000).unref();
  setInterval(tick, intervalMs).unref();
}

/** Used by tools/ui-probe.mjs (same format): one line when a command starts and one when it ends. */
export function probeLogLine(entry: { cmd: string; start: string; end?: string }): string {
  return JSON.stringify(entry) + "\n";
}
