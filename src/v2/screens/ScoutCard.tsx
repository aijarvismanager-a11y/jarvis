import { useState } from "react";
import { api, type ScoutState } from "../api";
import { Badge, Button, Card } from "../ui";
import { useAction, usePoll } from "../hooks";
import { formatTime } from "../labels";

/** New-AI candidates found by the weekly scout: the person adds them or drops them; nothing is added on its own. */
export function ScoutCard({ setError }: { setError: (m: string) => void }) {
  const [state, setState] = useState<ScoutState | null>(null);
  const { busy, run } = useAction(setError);
  const refresh = usePoll(async () => setState(await api.scout()), state?.running ? 4000 : 30000, [state?.running]);
  if (!state) return null;
  const fresh = state.proposals.filter((p) => p.status === "new");
  return (
    <Card title="新しいAIの候補">
      <p className="text-[13px]">週に1回、Googleでログインできる新しいAIを探して候補を出します。<b>あなたが「追加する」を押すまで、何も登録しません</b>。</p>
      <p className="mt-1 text-[12px] text-muted">
        {state.running ? "いま探しています…(数分かかります)" : state.lastRunAt ? `最後に探した日時: ${formatTime(state.lastRunAt)}。${state.lastNote ?? ""}` : "まだ探していません。"}
      </p>
      {fresh.length === 0 && !state.running && <p className="mt-2 text-[13px]">いま、確認待ちの候補はありません。</p>}
      <ul className="mt-2 space-y-2">
        {fresh.map((p) => (
          <li key={p.id} className="rounded-lg border border-borderSoft bg-bg px-3 py-2 text-[13px]">
            <span className="font-semibold">{p.name}</span> {p.use && <span className="text-[12px] text-muted">{p.use}</span>}{" "}
            <Badge tone={p.googleLogin === "page" ? "ok" : "warn"}>{p.googleLogin === "page" ? "Googleログイン: サイトに記載あり" : "Googleログイン: AIの回答のみ(未確認)"}</Badge>
            <p className="mt-0.5 text-[12px] text-muted">
              {p.url} / 無料枠: {p.free === "page" ? "サイトに記載あり" : "AIの回答のみ(未確認)"}。追加すると「自動化待ち」として登録され、自動で使えると確認できた時点で、週1回の見直しで自動のAIになります。
            </p>
            <div className="mt-1 flex gap-2">
              <Button disabled={busy} onClick={() => run(async () => { setState((await api.scoutAdd(p.id)).state); })}>追加する</Button>
              <Button variant="ghost" disabled={busy} onClick={() => run(async () => setState(await api.scoutDismiss(p.id)))}>見送る</Button>
            </div>
          </li>
        ))}
      </ul>
      <Button variant="ghost" className="mt-3" disabled={busy || state.running} onClick={() => run(async () => { setState(await api.scoutRun()); refresh(); })}>いま探す</Button>
    </Card>
  );
}
