import { useCallback, useEffect, useRef, useState } from "react";
import { parseErrorMessage } from "../apiUtil";
import type { WorkerCapability } from "./useWorkersData";

const POLL_INTERVAL_MS = 20000;

export interface AIProfile {
  enabled: boolean;
  strengths: Partial<Record<WorkerCapability, number>>;
  priority: number;
}

export type AIProfiles = Record<string, AIProfile>;

/**
 * AI Profile Manager (spec Phase 3's "AI Profile Manager" - previously
 * file-only editing of ai-profiles.json). Same shape as useCostData's
 * budget editor: poll the current table, PUT the whole thing back on save.
 *
 * `enabled` (default true) gates both the initial fetch and the polling
 * interval - pass `false` while the panel showing this data isn't open, so
 * the room doesn't keep polling in the background for data nobody is
 * looking at.
 */
export function useAIProfilesData(enabled = true) {
  const [profiles, setProfiles] = useState<AIProfiles>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const resp = await fetch("/api/orchestrator/ai-profiles");
      if (!resp.ok) throw new Error(await parseErrorMessage(resp));
      const data = (await resp.json()) as { profiles: AIProfiles };
      setProfiles(data.profiles ?? {});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AIプロファイルの読み込みに失敗しました");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  const saveProfiles = useCallback(
    async (next: AIProfiles): Promise<{ ok: boolean; message: string }> => {
      try {
        const resp = await fetch("/api/orchestrator/ai-profiles", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        if (!resp.ok) throw new Error(await parseErrorMessage(resp));
        await refresh();
        return { ok: true, message: "AIプロファイルを更新しました。" };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "AIプロファイルの更新に失敗しました" };
      }
    },
    [refresh],
  );

  return { profiles, loading, error, refresh, saveProfiles };
}
