import { useCallback, useEffect, useRef, useState } from "react";
import { parseErrorMessage } from "../apiUtil";
import type { TaskTemplate } from "./useWorkersData";

const POLL_INTERVAL_MS = 15000;

export type TaskHistoryEntry =
  | { task_id: string; template: TaskTemplate; timestamp: number; mode: "worker_run"; worker: string; status: "completed" | "failed" | "needs_input" }
  | { task_id: string; template: TaskTemplate; timestamp: number; mode: "manual_handoff"; primary: string | null; fallback: string | null; reason: string };

export interface SuccessRateEntry {
  worker: string;
  completed: number;
  failed: number;
  needs_input: number;
  total: number;
  successRate: number;
}

/** Task History + Success Rate (spec §38 optional checklist "使用履歴"/"成功率"). */
export function useTaskHistoryData() {
  const [history, setHistory] = useState<TaskHistoryEntry[]>([]);
  const [rates, setRates] = useState<SuccessRateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const [historyResp, ratesResp] = await Promise.all([
        fetch("/api/orchestrator/task-history?limit=50"),
        fetch("/api/orchestrator/success-rate"),
      ]);
      if (historyResp.ok) {
        const data = (await historyResp.json()) as { history: TaskHistoryEntry[] };
        setHistory(Array.isArray(data.history) ? data.history : []);
      }
      if (ratesResp.ok) {
        const data = (await ratesResp.json()) as { rates: SuccessRateEntry[] };
        setRates(Array.isArray(data.rates) ? data.rates : []);
      }
      if (!historyResp.ok) setError(await parseErrorMessage(historyResp));
      else if (!ratesResp.ok) setError(await parseErrorMessage(ratesResp));
      else setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "履歴の読み込みに失敗しました");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
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

  return { history, rates, loading, error, refresh };
}
