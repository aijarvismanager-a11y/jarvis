import type { Store } from "./store.ts";

// A bot check ("I am not a robot") is never bypassed. What the app does instead: the AI is left alone for a while, so the site is not
// hit again and again, and an AI that asks every single time drops out of the automatic choice until the person clears the check.

export const BOT_CHECK_REST_MS = 10 * 60 * 1000;
/** This many checks in a row (no answer in between) and the AI no longer takes part in the automatic choice. */
export const BOT_CHECK_ALWAYS_AFTER = 3;

type Entry = { count: number; restUntil: string };
export type BotCheckState = { kind: "rest"; until: string } | { kind: "always" };

const key = (aiId: string) => `bot_check:${aiId}`;

export function recordBotCheck(store: Store, aiId: string, now = Date.now()): void {
  const prev = store.getSetting<Entry | null>(key(aiId), null);
  store.setSetting(key(aiId), { count: (prev?.count ?? 0) + 1, restUntil: new Date(now + BOT_CHECK_REST_MS).toISOString() } satisfies Entry);
}

/** The AI answered by itself (or the person cleared the check): forget the history. */
export function clearBotCheck(store: Store, aiId: string): void {
  if (store.getSetting<Entry | null>(key(aiId), null)) store.setSetting(key(aiId), null);
}

export function botCheckState(store: Store, aiId: string, now = Date.now()): BotCheckState | null {
  const r = store.getSetting<Entry | null>(key(aiId), null);
  if (!r) return null;
  if (r.count >= BOT_CHECK_ALWAYS_AFTER) return { kind: "always" };
  return Date.parse(r.restUntil) > now ? { kind: "rest", until: r.restUntil } : null;
}

/** aiId -> why it is left out of the automatic choice right now (only the AIs that have a state). */
export function botCheckExclusions(store: Store, aiIds: string[], now = Date.now()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of aiIds) {
    const st = botCheckState(store, id, now);
    if (st?.kind === "always") out[id] = "毎回ボット確認が出るため、自動では使えません(設定で確認を済ませると戻ります)";
    else if (st) out[id] = "ボット確認が出たため、しばらく休ませています(10分ほど)";
  }
  return out;
}
