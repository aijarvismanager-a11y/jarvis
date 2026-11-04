import { useRef, useState } from "react";
import { api } from "../api";
import { formatTime } from "../labels";
import { useAction, usePoll } from "../hooks";
import { Button } from "../ui";
import { restingNotice, showNotices } from "../notify";
import type { AllResting } from "../types";

/** "あと1時間33分ほど": the wait to the first AI; "リセット" is only said of Claude's plan, which really resets. */
function inHours(until: string): string {
  const min = Math.max(1, Math.round((Date.parse(until) - Date.now()) / 60_000));
  return min < 60 ? `あと${min}分ほど` : `あと${Math.floor(min / 60)}時間${min % 60 ? `${min % 60}分` : ""}ほど`;
}

const WHY ={ limit: "利用上限", botcheck: "ボット確認", claude: "Claude の利用上限" } as const;

/**
 * Every AI that could take the waiting work is resting. The work is not failed: it goes on by itself when the first AI is back.
 * Shown above every screen, so a quiet mission never looks broken.
 */
export function RestingBanner({ setError }: { setError: (m: string) => void }) {
  const [state, setState] = useState<AllResting | null>(null);
  const was = useRef<boolean | undefined>(undefined);
  const refresh = usePoll(async () => {
    const next = (await api.allResting().catch(() => ({ state: null }))).state;
    setState(next);
    const notice = restingNotice(was.current, next !== null);
    was.current = next !== null;
    if (notice) showNotices([notice]);
  }, 15000, []);
  // the red Claude box above asks for a choice until one is made: then "nothing to do" would contradict it
  const [needsPick, setNeedsPick] = useState(false);
  usePoll(async () => { const l = await api.claudeLimit().catch(() => null); setNeedsPick(!!l?.until && !l.policy); }, 15000, []);
  const { busy, run } = useAction(setError);
  const [open, setOpen] = useState(false);
  if (!state) return null;
  return (
    <div role="status" className="mb-3 rounded-lg border border-[#EBD9A8] bg-[#FBF1DC] px-3 py-2 text-[13px] text-[#8A6212]">
      <p className="font-semibold">いまは使えるAIがありません。自動で再開します</p>
      <p className="mt-0.5">いちばん早く使えるのは {formatTime(state.until)} ごろです({inHours(state.until)})。待っている作業は {state.tasks} 件です。{needsPick ? "Claude の作業の扱いだけ、上の赤い枠で選んでください。" : "何もしなくて大丈夫です。"}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { await api.recheckResting(); refresh(); })}>いま使えるか確かめる</Button>
        <button type="button" className="text-[12px] underline" onClick={() => setOpen((v) => !v)}>{open ? "休んでいるAIを閉じる" : "休んでいるAIを見る"}</button>
      </div>
      {open && (
        <ul className="mt-2 space-y-0.5 text-[12px]">
          {state.ais.map((a) => (
            <li key={a.aiId}>{a.name}: {WHY[a.reason]}のため、{formatTime(a.until)}ごろまで</li>
          ))}
          <li className="pt-1 opacity-80">時刻は、サイトが示したものか、こちらでの目安です。早く戻ったときは、確かめ直した時点で使い始めます。</li>
        </ul>
      )}
    </div>
  );
}
