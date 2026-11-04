import { useState } from "react";
import { api } from "../api";
import { resetIn } from "../labels";
import { usePoll } from "../hooks";
import type { ClaudeQuota } from "../types";

/** Claude's 5-hour usage in the header, once it is known; turns amber and red as the plan fills up. */
export function QuotaChip({ onOpen }: { onOpen: () => void }) {
  const [quota, setQuota] = useState<ClaudeQuota | null>(null);
  usePoll(async () => setQuota(await api.claudeQuota().catch(() => null)), 30000, []);
  const w = quota?.fiveHour;
  if (!quota || !w || w.utilization === null) return null;
  const pct = Math.round(w.utilization * 100);
  const tone = pct >= 90 ? "border-[#E7C4C4] bg-[#FBEFEF] text-[#9B2C2C]" : pct >= 70 ? "border-[#EBD9A8] bg-[#FBF1DC] text-[#8A6212]" : "border-border bg-panel text-ink";
  const week = quota.sevenDay?.utilization != null ? ` / 7日枠 ${Math.round(quota.sevenDay.utilization * 100)}%` : "";
  return (
    <button onClick={onOpen} className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] ${tone}`} title={`Claude の利用枠: 5時間枠 ${pct}% 使用${week}。${resetIn(w.resetsAt)}。押すと「使うAI」で詳しく見られます`}>
      Claude 5時間枠 {pct}%
    </button>
  );
}
