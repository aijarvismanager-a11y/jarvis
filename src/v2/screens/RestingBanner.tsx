import { useState } from "react";
import { api } from "../api";
import { formatTime, resetIn } from "../labels";
import { useAction, usePoll } from "../hooks";
import { Button } from "../ui";
import type { AllResting } from "../types";

const WHY = { limit: "利用上限", botcheck: "ボット確認", claude: "Claude の利用上限" } as const;

/**
 * Every AI that could take the waiting work is resting. The work is not failed: it goes on by itself when the first AI is back.
 * Shown above every screen, so a quiet mission never looks broken.
 */
export function RestingBanner({ setError }: { setError: (m: string) => void }) {
  const [state, setState] = useState<AllResting | null>(null);
  const refresh = usePoll(async () => setState((await api.allResting().catch(() => ({ state: null }))).state), 15000, []);
  const { busy, run } = useAction(setError);
  const [open, setOpen] = useState(false);
  if (!state) return null;
  return (
    <div role="status" className="mb-3 rounded-lg border border-[#EBD9A8] bg-[#FBF1DC] px-3 py-2 text-[13px] text-[#8A6212]">
      <p className="font-semibold">いまは使えるAIがありません。自動で再開します</p>
      <p className="mt-0.5">いちばん早く使えるのは {formatTime(state.until)} ごろです({resetIn(state.until)})。待っている作業は {state.tasks} 件です。何もしなくて大丈夫です。</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { await api.recheckResting(); refresh(); })}>いま使えるか確かめる</Button>
        <button type="button" className="text-[12px] underline" onClick={() => setOpen((v) => !v)}>{open ? "休んでいるAIを閉じる" : "休んでいるAIを見る"}</button>
      </div>
      {open && (
        <ul className="mt-2 space-y-0.5 text-[12px]">
          {state.ais.map((a) => (
            <li key={a.aiId}>{a.name}: {WHY[a.reason]}のため、{formatTime(a.until)}ごろまで(時刻が分からない場合は目安です)</li>
          ))}
        </ul>
      )}
    </div>
  );
}
