import type { Store } from "./store.ts";

// A web AI that says "you have reached the limit" is left alone until its allowance comes back (the sites do not publish their quota,
// so the answer itself is the only signal). The AI drops out of the automatic choice meanwhile and the settings say why.

export const USAGE_LIMIT_REST_MS = 3 * 60 * 60 * 1000;
const MIN_REST_MS = 30 * 60 * 1000;
const MAX_REST_MS = 24 * 60 * 60 * 1000;
/** A real deliverable can mention limits; a refusal is short. */
const MAX_LIMIT_ANSWER_CHARS = 700;

const LIMIT_PATTERNS: RegExp[] = [
  /(利用|使用|送信|メッセージ|リクエスト|生成|回数|チャット)[^\n。]{0,12}(上限|制限)[^\n。]{0,10}(達|超|到達)/,
  /上限に(達|到達)/,
  /(制限|上限)に(達|到達|かかり)/,
  /(無料|フリー)[^\n。]{0,10}(枠|プラン)[^\n。]{0,10}(上限|使い切|終了)/,
  /(reached|hit|exceeded)[^\n.]{0,30}(usage|message|chat|daily|hourly|free|rate|request)[^\n.]{0,20}(limit|cap|quota)/i,
  /(usage|message|daily|rate|request) (limit|cap|quota)[^\n.]{0,20}(reached|exceeded|hit)/i,
  /you(?:'|’)ve (run out|used up)[^\n.]{0,30}(messages|requests|free)/i,
  /(too many requests|rate limit(ed)?)/i,
  // Perplexity-style: free queries / Pro searches used up
  /(pro|free|daily|無料|クエリ|検索)[^\n.。]{0,25}(searches|queries|クエリ|検索|回数)[^\n.。]{0,30}(limit|left|remaining|reached|used|上限|制限|使い切|なくなり|残り\s*0)/i,
  /(0|no) (pro )?(searches|queries) (left|remaining)/i,
  /(クエリ|検索)[^\n。]{0,12}(上限|制限|使い切)/,
  /(come back|try again|resets?|available again)[^\n.]{0,25}(later|tomorrow|in \d+|at \d)/i,
];

export function looksLikeUsageLimit(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > MAX_LIMIT_ANSWER_CHARS) return false;
  return LIMIT_PATTERNS.some((re) => re.test(t));
}

/** How long to rest: "3時間後" / "in 2 hours" / "45分後" when the site says so, else three hours. */
export function restFromText(text: string): number {
  const h = /(\d+(?:\.\d+)?)\s*時間/.exec(text)?.[1] ?? /in (\d+(?:\.\d+)?)\s*hours?/i.exec(text)?.[1];
  const m = /(\d+)\s*分/.exec(text)?.[1] ?? /in (\d+)\s*min/i.exec(text)?.[1];
  const ms = h ? Number(h) * 3_600_000 + (m ? Number(m) * 60_000 : 0) : m ? Number(m) * 60_000 : USAGE_LIMIT_REST_MS;
  return Math.min(MAX_REST_MS, Math.max(MIN_REST_MS, ms));
}

type Entry = { until: string; at: string };
const key = (aiId: string) => `usage_limit:${aiId}`;

export function recordUsageLimit(store: Store, aiId: string, text = "", now = Date.now()): string {
  const until = new Date(now + restFromText(text)).toISOString();
  store.setSetting(key(aiId), { until, at: new Date(now).toISOString() } satisfies Entry);
  return until;
}

export function clearUsageLimit(store: Store, aiId: string): void {
  if (store.getSetting<Entry | null>(key(aiId), null)) store.setSetting(key(aiId), null);
}

/** When the AI may be used again (null = not at its limit). */
export function usageLimitUntil(store: Store, aiId: string, now = Date.now()): string | null {
  const r = store.getSetting<Entry | null>(key(aiId), null);
  return r && Date.parse(r.until) > now ? r.until : null;
}

export function usageLimitExclusions(store: Store, aiIds: string[], now = Date.now()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of aiIds) {
    const until = usageLimitUntil(store, id, now);
    if (until) out[id] = `利用上限に達したため、${new Date(until).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}ごろまで休ませています`;
  }
  return out;
}
