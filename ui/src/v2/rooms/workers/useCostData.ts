import { useCallback, useEffect, useRef, useState } from "react";
import { parseErrorMessage } from "../apiUtil";

const POLL_INTERVAL_MS = 15000;

export type BudgetStatus = "ok" | "warning" | "exceeded";

export interface BudgetConfig {
  daily_budget: number;
  warning_threshold: number;
  hard_limit: number;
  currency: "JPY" | "USD";
}

export interface ProviderCost {
  provider: string;
  cost: number;
  calls: number;
}

export interface CostSummary {
  currency: "JPY" | "USD";
  daily_cost: number;
  monthly_cost: number;
  budget: BudgetConfig;
  status: BudgetStatus;
  by_provider: ProviderCost[];
  monthly_partial: boolean;
}

/**
 * Cost management (spec section 19-20) - polls /api/orchestrator/cost for
 * estimated spend against the configured budget, and lets the user edit
 * the budget itself. Separate from useWorkersData's poll (different
 * refresh cadence - cost changes slower than worker/handoff state).
 */
export function useCostData() {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const resp = await fetch("/api/orchestrator/cost");
      if (!resp.ok) throw new Error(await parseErrorMessage(resp));
      setSummary((await resp.json()) as CostSummary);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "コスト情報の読み込みに失敗しました");
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

  const updateBudget = useCallback(
    async (budget: BudgetConfig): Promise<{ ok: boolean; message: string }> => {
      try {
        const resp = await fetch("/api/orchestrator/budget", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(budget),
        });
        if (!resp.ok) throw new Error(await parseErrorMessage(resp));
        await refresh();
        return { ok: true, message: "予算を更新しました。" };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "予算の更新に失敗しました" };
      }
    },
    [refresh],
  );

  return { summary, loading, error, refresh, updateBudget };
}
