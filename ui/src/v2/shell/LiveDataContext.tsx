import React, { createContext, useContext } from "react";
import type {
  AgentActivityEvent,
  ContentEvent,
  EmergencyStateValue,
  HandoffEvent,
  PendingApproval,
  PendingClarifier,
  PendingRepeatBack,
  SettingsAppliedEvent,
  SystemNotice,
  TaskEvent,
} from "../../hooks/useWebSocket";

/**
 * Live event streams from useWebSocket, lifted into context so deeply
 * nested Room bodies (mounted by RoomBodyRegistry, far below AppShell)
 * can read them without duplicating WS connections or prop-drilling.
 *
 * Only event arrays that more than one Room consumes belong here. Pages
 * that need a single, narrow slice should still pull directly from props
 * — context exists to avoid prop drilling, not to replace props.
 */
export interface LiveData {
  approvals: PendingApproval[];
  clarifiers: PendingClarifier[];
  repeatBacks: PendingRepeatBack[];
  notices: SystemNotice[];
  taskEvents: TaskEvent[];
  contentEvents: ContentEvent[];
  agentActivity: AgentActivityEvent[];
  /**
   * Phase 33 — live AI Manager Handoffs (`handoff_event`), newest last, same
   * convention as the other WS-derived arrays here. `AIManagerRoom`'s
   * `HandoffCard` list still polls (unchanged); this is for surfaces that
   * want the transition live — currently only the Cinematic Shell's
   * animated handoff packet (`AgentOrbit.tsx`), but per this file's own
   * "more than one Room" rule it lives here rather than a second
   * `useWebSocket()` call, since only one WS connection is ever opened
   * (in `useLiveThread.ts`, consumed by `AppShell.tsx`).
   */
  handoffEvents: HandoffEvent[];
  /**
   * Phase 34-B — global Emergency Stop state, pushed live. Null until the
   * first `emergency_state` push arrives on this connection (the WS only
   * broadcasts on *change*, not current state on connect) — `EmergencyChip`
   * combines this with its own one-time `GET /api/authority/status` fetch
   * for the value at mount, same "poll once for initial + live push for
   * updates" shape as `useEmergencyStatus.ts` documents.
   */
  emergencyState: EmergencyStateValue | null;
  /**
   * Settings hot-apply results broadcast by the daemon (`settings_applied`).
   * The Settings Room reads the latest entry for its status card and toasts
   * failures from applies that finish after the save request returned
   * (debounced channel restarts, SIGHUP / reload-endpoint runs).
   */
  settingsEvents: SettingsAppliedEvent[];
  /**
   * Phase 6.5.5 — most-recent assistant reply, used by the RailReplyPreview
   * so users in a Room can see Jarvis's response without leaving. Null when
   * no assistant message exists yet. `isStreaming` lets the rail show a
   * caret/spinner while the reply is in-progress.
   */
  latestAssistantReply: { text: string; isStreaming: boolean; ts: number } | null;
}

const LiveDataContext = createContext<LiveData | null>(null);

export function LiveDataProvider({
  value,
  children,
}: {
  value: LiveData;
  children: React.ReactNode;
}) {
  return <LiveDataContext.Provider value={value}>{children}</LiveDataContext.Provider>;
}

/**
 * Read live event streams. Returns a stable empty default outside the
 * provider so Room bodies opened via direct URL on a fresh shell don't
 * crash before the provider mounts.
 */
export function useLiveData(): LiveData {
  const ctx = useContext(LiveDataContext);
  if (ctx) return ctx;
  return EMPTY;
}

const EMPTY: LiveData = {
  approvals: [],
  clarifiers: [],
  repeatBacks: [],
  notices: [],
  taskEvents: [],
  contentEvents: [],
  agentActivity: [],
  handoffEvents: [],
  emergencyState: null,
  settingsEvents: [],
  latestAssistantReply: null,
};
