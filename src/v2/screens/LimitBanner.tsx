import { useState } from "react";
import { api } from "../api";
import { formatTime, resetIn } from "../labels";
import { useAction, usePoll } from "../hooks";
import { Button } from "../ui";
import type { ClaudeLimit } from "../types";

/**
 * Claude's plan is nearly used up (warning) or used up (the person picks: wait for the reset, or hand the work to other AIs).
 * Shown above every screen, because the choice decides what the running request does next.
 */
export function LimitBanner({ setError }: { setError: (m: string) => void }) {
  const [limit, setLimit] = useState<ClaudeLimit | null>(null);
  const [, setTick] = useState(0);
  const refresh = usePoll(async () => setLimit(await api.claudeLimit().catch(() => null)), 15000, []);
  const { busy, run } = useAction(setError);
  if (!limit || (!limit.warn && !limit.until)) return null;
  const pick = (policy: "wait" | "reroute" | null) => run(async () => { await api.setClaudeLimitPolicy(policy); refresh(); setTick((n) => n + 1); });

  if (!limit.until) {
    const pct = Math.round((limit.utilization ?? 0) * 100);
    return (
      <div role="status" className="mb-3 rounded-lg border border-[#EBD9A8] bg-[#FBF1DC] px-3 py-2 text-[13px] text-[#8A6212]">
        <p className="font-semibold">Claude の利用枠(5時間)が {pct}% まで使われています</p>
        <p className="mt-0.5">上限に達すると、Claude Code が止まります。{resetIn(limit.resetsAt)}。大きな作業は、リセット後にするか、ほかのAIに任せると安心です。</p>
      </div>
    );
  }
  const at = formatTime(limit.until);
  return (
    <div role="alert" className="mb-3 rounded-lg border border-[#E7C4C4] bg-[#FBEFEF] px-3 py-2 text-[13px] text-[#9B2C2C]">
      <p className="font-semibold">Claude が利用上限に達しました({at}にリセット。{resetIn(limit.until)})</p>
      {limit.policy === "wait" && <p className="mt-0.5">リセットまで待つ設定です。Claude Code の作業は待機し、リセット後に自動で続きます。</p>}
      {limit.policy === "reroute" && <p className="mt-0.5">ほかのAIに回す設定です。止まった作業は、「やり直す」を押すとほかのAIが引き受けます。</p>}
      {!limit.policy && <p className="mt-0.5">どうしますか? 選ぶと、止まった作業は「やり直す」で続けられます。</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant={limit.policy === "wait" ? "primary" : "ghost"} disabled={busy} onClick={() => void pick("wait")}>リセットまで待つ</Button>
        <Button variant={limit.policy === "reroute" ? "primary" : "ghost"} disabled={busy} onClick={() => void pick("reroute")}>ほかのAIに回す</Button>
      </div>
    </div>
  );
}
