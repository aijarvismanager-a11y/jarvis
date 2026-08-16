import { useCallback, useEffect, useState } from "react";

const POLL_INTERVAL_MS = 8000;

/**
 * Phase 34-C — Awareness/Privacy live toggle (spec §39). The backend
 * (`AwarenessService.toggle()`/`.isEnabled()`, `src/awareness/service.ts`)
 * already has a real on/off switch and REST surface
 * (`GET /api/awareness/status`, `POST /api/awareness/toggle`) — this is
 * genuinely zero new backend work, per the Phase 34 research: the audit's
 * "no positive active state anywhere" gap was a missing UI consumer, not a
 * missing capability. `enabled: null` means "not yet loaded"; `available:
 * false` means the daemon has no `awarenessService` configured at all
 * (`GET` 503) — the caller should render nothing rather than a fake "off"
 * chip in that case, since "off" implies a real toggle that isn't there.
 */
export function useAwareness() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const resp = await fetch("/api/awareness/status");
      if (resp.status === 503) {
        setAvailable(false);
        return;
      }
      if (resp.ok) {
        const data = (await resp.json()) as { enabled?: boolean };
        setEnabled(Boolean(data.enabled));
        setAvailable(true);
      }
    } catch {
      // Best-effort, same as every other poll hook in this app.
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const toggle = useCallback(async (): Promise<void> => {
    if (enabled === null || busy) return;
    const next = !enabled;
    setBusy(true);
    try {
      const resp = await fetch("/api/awareness/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (resp.ok) setEnabled(next);
    } catch {
      // Leave `enabled` unchanged on failure — the chip reflects the last
      // confirmed state, not an optimistic guess.
    } finally {
      setBusy(false);
    }
  }, [enabled, busy]);

  return { enabled, available, busy, toggle };
}
