import { useCallback, useEffect, useState } from "react";

const POLL_INTERVAL_MS = 8000;

/**
 * Explicit non-real-data mode (Cinematic UI spec §79-80's anti-dummy-data
 * rule). Backed by `daemon.demo_mode` (config.yaml / `JARVIS_DEMO_MODE` env,
 * SYSTEM-owned — never toggled from the DB) surfaced on the existing
 * `GET /api/health` response as `demoMode`. `null` means "not yet loaded";
 * callers should render nothing in that case rather than assume `false`.
 */
export function useDemoMode() {
  const [demoMode, setDemoMode] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      const resp = await fetch("/api/health");
      if (resp.ok) {
        const data = (await resp.json()) as { demoMode?: boolean };
        setDemoMode(Boolean(data.demoMode));
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

  return demoMode;
}
