import { useCallback, useEffect, useRef, useState } from "react";

/** Runs `load` now and every `ms` while the tab is visible; returns a manual refresh. */
export function usePoll(load: () => Promise<void>, ms: number, deps: unknown[]): () => void {
  const loadRef = useRef(load);
  loadRef.current = load;
  // A slow answer must not pile up requests: while one is running, further ticks are skipped.
  const running = useRef(false);
  const refresh = useCallback(() => {
    if (running.current) return;
    running.current = true;
    void loadRef.current().catch(() => {}).finally(() => { running.current = false; });
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, ms);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, refresh, ...deps]);
  return refresh;
}

/** Wraps an async action: shows errors, blocks double clicks. */
export function useAction(onError: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [onError],
  );
  return { busy, run };
}
