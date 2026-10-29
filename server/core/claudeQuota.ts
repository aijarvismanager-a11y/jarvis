import { spawnRunner, type CommandRunner } from "./commandRunner.ts";
import type { Store } from "./store.ts";

// How much of the Claude plan is used. Claude Code reports it itself in a "rate_limit_event" line of its stream-json output
// (the same plan that claude.ai chat uses), so nothing is guessed: every run, and the "check now" button, refresh it.

export type QuotaWindow = { utilization: number | null; resetsAt: string | null };
export type ClaudeQuota = { fiveHour: QuotaWindow | null; sevenDay: QuotaWindow | null; status: string; checkedAt: string };

const KEY = "claude_quota";

const windowOf = (w: unknown): QuotaWindow | null => {
  if (!w || typeof w !== "object") return null;
  const o = w as { utilization?: unknown; resetsAt?: unknown };
  const utilization = typeof o.utilization === "number" ? o.utilization : null;
  const resetsAt = typeof o.resetsAt === "number" ? new Date(o.resetsAt * 1000).toISOString() : null;
  return utilization === null && resetsAt === null ? null : { utilization, resetsAt };
};

/** The newest rate_limit_event in Claude Code's stream-json output (null when there is none). */
export function parseRateLimit(stdout: string, at = new Date()): ClaudeQuota | null {
  if (!stdout.includes("rate_limit_event")) return null;
  for (const line of stdout.trim().split("\n").reverse()) {
    if (!line.includes("rate_limit_event")) continue;
    try {
      const o = JSON.parse(line) as { type?: string; rate_limit_info?: { status?: string; resetsAt?: number; rateLimitType?: string; unifiedWindows?: Record<string, unknown> } };
      if (o.type !== "rate_limit_event" || !o.rate_limit_info) continue;
      const info = o.rate_limit_info;
      const w = info.unifiedWindows ?? {};
      let fiveHour = windowOf(w.five_hour);
      let sevenDay = windowOf(w.seven_day);
      // an older CLI reports only the window that applies right now
      if (!fiveHour && info.rateLimitType === "five_hour") fiveHour = windowOf({ resetsAt: info.resetsAt });
      if (!sevenDay && info.rateLimitType === "seven_day") sevenDay = windowOf({ resetsAt: info.resetsAt });
      if (!fiveHour && !sevenDay) continue;
      return { fiveHour, sevenDay, status: info.status ?? "unknown", checkedAt: at.toISOString() };
    } catch {
      /* not a JSON line */
    }
  }
  return null;
}

export const readClaudeQuota = (store: Store): ClaudeQuota | null => store.getSetting<ClaudeQuota | null>(KEY, null);
export const saveClaudeQuota = (store: Store, q: ClaudeQuota) => store.setSetting(KEY, q);

/** Asks Claude Code for one tiny answer just to read the usage it reports (costs a few tokens). */
export async function probeClaudeQuota(store: Store, run: CommandRunner = spawnRunner, command = "claude"): Promise<ClaudeQuota | null> {
  const res = await run(command, ["-p", "ok", "--output-format", "stream-json", "--verbose"], { timeoutMs: 90_000 });
  const q = parseRateLimit(res.stdout);
  if (q) saveClaudeQuota(store, q);
  return q;
}
