import type { ChatDisplayMode } from "../shell/useChatDisplayMode";
import type { ThreadItem, ThreadItemKind } from "./types";

/**
 * Phase 12-C (spec §52) density filter. Kinds always kept regardless of
 * mode are the essentials a user can't opt out of: their own messages,
 * Jarvis's spoken replies, and anything requiring a decision (approval,
 * clarifier, repeat-back). Everything else is "chatter" of increasing
 * verbosity that gets trimmed as the mode tightens.
 */
const ALWAYS_VISIBLE: ReadonlySet<ThreadItemKind> = new Set<ThreadItemKind>([
  "user-voice",
  "user-text",
  "jarvis-speech",
  "approval",
  "clarifier",
  "repeat-back",
  "room-window",
]);

/** Task/tool bookkeeping - object cards and tool-result summaries. */
const DETAIL_KINDS: ReadonlySet<ThreadItemKind> = new Set<ThreadItemKind>(["card", "result"]);

/** Raw internal reasoning - only ever shown in "developer" mode. */
const DEVELOPER_ONLY_KINDS: ReadonlySet<ThreadItemKind> = new Set<ThreadItemKind>(["jarvis-thought"]);

export function filterThreadItems(items: ThreadItem[], mode: ChatDisplayMode): ThreadItem[] {
  if (mode === "developer") return items;
  return items.filter((item) => {
    if (ALWAYS_VISIBLE.has(item.kind)) return true;
    if (DETAIL_KINDS.has(item.kind)) return mode === "detailed";
    if (DEVELOPER_ONLY_KINDS.has(item.kind)) return false;
    return true;
  });
}
