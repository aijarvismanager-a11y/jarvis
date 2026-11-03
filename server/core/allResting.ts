import type { Store } from "./store.ts";
import { botCheckState } from "./botCheck.ts";
import { claudeLimitUntil } from "./claudeQuota.ts";
import { usageLimitUntil } from "./usageLimit.ts";

// "Every AI is resting": when a task has nobody to run on only because each AI is resting (its allowance is used up, a bot check
// is waiting, or the Claude plan is used up), the task waits and goes on by itself when the first one is back. This keeps the
// state the screen shows; nothing here fails a task or spends a retry.

export type RestingAi = { aiId: string; name: string; until: string; reason: "limit" | "botcheck" | "claude" };
export type AllResting = { since: string; until: string; tasks: number; ais: RestingAi[] };

const KEY = "allResting.v1";

/** The AIs that are resting right now and when each is back (the time a site did not state is an estimate made when the rest began). */
export function restingList(store: Store, now = Date.now()): RestingAi[] {
  const claude = claudeLimitUntil(store, now);
  const out: RestingAi[] = [];
  for (const s of store.listAiServices()) {
    const limit = usageLimitUntil(store, s.id, now);
    if (limit) {
      out.push({ aiId: s.id, name: s.name, until: limit, reason: "limit" });
      continue;
    }
    const bot = botCheckState(store, s.id, now);
    if (bot?.kind === "rest") {
      out.push({ aiId: s.id, name: s.name, until: bot.until, reason: "botcheck" });
      continue;
    }
    if (claude && s.id.startsWith("claude")) out.push({ aiId: s.id, name: s.name, until: claude, reason: "claude" });
  }
  return out;
}

export const readAllResting = (store: Store): AllResting | null => store.getSetting<AllResting | null>(KEY, null);
export const saveAllResting = (store: Store, state: AllResting): void => store.setSetting(KEY, state);
export const clearAllResting = (store: Store): void => store.setSetting(KEY, null);
