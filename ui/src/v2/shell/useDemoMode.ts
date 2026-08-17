import { useEffect, useState } from "react";

/**
 * Explicit non-real-data mode (Cinematic UI spec §79-80's anti-dummy-data
 * rule). Backed by `daemon.demo_mode` (config.yaml / `JARVIS_DEMO_MODE` env,
 * SYSTEM-owned — never toggled from the DB) surfaced on the existing
 * `GET /api/health` response as `demoMode`. `null` means "not yet loaded";
 * callers should render nothing in that case rather than assume `false`.
 *
 * Fetched once on mount, not polled: `demoMode` is fixed at daemon boot and
 * never changes for the lifetime of the process, so a recurring poll would
 * only add load (the health endpoint does a synchronous DB check) without
 * ever observing a change.
 */
const RETRY_DELAY_MS = 3000;
const MAX_ATTEMPTS = 3;

export function useDemoMode() {
  const [demoMode, setDemoMode] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const attempt = (n: number) => {
      fetch("/api/health")
        .then((resp) => (resp.ok ? resp.json() : null))
        .then((data: { demoMode?: boolean } | null) => {
          if (cancelled) return;
          if (data) {
            setDemoMode(Boolean(data.demoMode));
          } else if (n < MAX_ATTEMPTS) {
            // A transient failure (page loaded but the daemon's HTTP
            // server briefly not accepting connections yet) shouldn't
            // permanently hide the anti-dummy-data badge for the rest of
            // the session - retry a few times, bounded, then give up.
            timer = window.setTimeout(() => attempt(n + 1), RETRY_DELAY_MS);
          }
        })
        .catch(() => {
          if (!cancelled && n < MAX_ATTEMPTS) {
            timer = window.setTimeout(() => attempt(n + 1), RETRY_DELAY_MS);
          }
        });
    };
    attempt(1);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return demoMode;
}
