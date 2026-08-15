import { useCallback, useState } from "react";

/**
 * Chat density preference (spec §52, Phase 12-C). Per-user, not per-project -
 * persisted client-side only, same as useTheme.ts, since this is a rendering
 * concern the backend never needs to know about.
 *
 * Default is "developer" (show everything) so existing users see no silent
 * behavior change - the thread already renders every item kind unfiltered
 * today. Dialing down to "detailed" or "simple" is an opt-in trim, not a
 * new default.
 */
export type ChatDisplayMode = "simple" | "detailed" | "developer";
const KEY = "jarvis-chat-display-mode";

function currentMode(): ChatDisplayMode {
  if (typeof localStorage === "undefined") return "developer";
  try {
    const v = localStorage.getItem(KEY);
    if (v === "simple" || v === "detailed" || v === "developer") return v;
  } catch { /* ignore */ }
  return "developer";
}

export function useChatDisplayMode(): [ChatDisplayMode, (next: ChatDisplayMode) => void] {
  const [mode, setMode] = useState<ChatDisplayMode>(currentMode);

  const set = useCallback((next: ChatDisplayMode) => {
    setMode(next);
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  }, []);

  return [mode, set];
}
