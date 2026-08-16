import { useCallback, useEffect, useState } from "react";
import { useLiveData } from "./LiveDataContext";
import type { EmergencyState } from "../rooms/authority/useAuthorityData";

/**
 * Phase 34-B — global Emergency Stop (spec §32), promoted out of
 * `AuthorityRoom.tsx`'s `EmergencyBand` (Room-scoped only) to shell chrome.
 * Reuses the existing backend as-is: `GET /api/authority/status` for the
 * value at mount (the WS only pushes on *change*, per
 * `WebSocketService.broadcastEmergencyState()` — nothing tells a freshly
 * mounted client the CURRENT state without an initial fetch), then
 * `LiveDataContext.emergencyState` (fed by `useWebSocket.ts`'s
 * `emergency_state` case, added this same phase) for live updates after
 * that — same "poll once + live push" shape `JarvisStateContext` already
 * established for its own fields.
 *
 * Deliberately its own light hook rather than reusing `useAuthorityData()`
 * (which polls 5 endpoints every render cycle) — the shell only needs this
 * one field, following the same "don't drag in a Room's whole mutation
 * surface for one value" precedent Phase 29 set for `useAIManagerData`.
 */
export function useEmergencyStatus() {
  const { emergencyState: pushed } = useLiveData();
  const [state, setState] = useState<EmergencyState | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/authority/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { emergency_state?: EmergencyState } | null) => {
        if (!cancelled && d?.emergency_state) setState(d.emergency_state);
      })
      .catch(() => {
        // Best-effort, same as every other poll hook in this app — a chip
        // that never resolves an initial state just stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (pushed) setState(pushed);
  }, [pushed]);

  const setEmergency = useCallback(async (transition: "pause" | "resume" | "kill" | "reset"): Promise<boolean> => {
    try {
      const resp = await fetch(`/api/authority/emergency/${transition}`, { method: "POST" });
      if (!resp.ok) return false;
      const data = (await resp.json()) as { state?: EmergencyState };
      if (data.state) setState(data.state);
      return true;
    } catch {
      return false;
    }
  }, []);

  return { state, setEmergency };
}
