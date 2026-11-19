import { useState } from "react";
import { api, type RosterState } from "../api";
import { Badge, Button, Card } from "../ui";
import { useAction, usePoll } from "../hooks";
import { formatTime } from "../labels";

const KIND_LABEL: Record<string, string> = { promoted: "自動にしました", removed: "名簿から外しました", restored: "名簿に戻しました", back: "サイトが戻りました", promote_failed: "自動にできませんでした" };

/** What the weekly roster check changed (AIs raised to automatic, AIs taken out) and the way back for each removal. */
export function RosterCard({ setError }: { setError: (m: string) => void }) {
  const [state, setState] = useState<RosterState | null>(null);
  const { busy, run } = useAction(setError);
  const refresh = usePoll(async () => setState(await api.roster()), state?.running ? 4000 : 30000, [state?.running]);
  if (!state) return null;
  return (
    <Card title="AIの入れ替わり">
      <p className="text-[13px]">週に1回、手動のままのAIを見直します。<b>ログイン済みで自動に使えると確認できたAIは、自動のAIにします</b>。サイトが2回続けて見つからないAIは名簿から外します(「戻す」で元に戻せます)。</p>
      <p className="mt-1 text-[12px] text-muted">
        {state.running ? "いま確認しています…(数分かかります)" : state.lastRunAt ? `最後に確認した日時: ${formatTime(state.lastRunAt)}。${state.lastNote ?? ""}` : "まだ確認していません。"}
      </p>
      {state.removed.length > 0 && (
        <ul className="mt-2 space-y-2">
          {state.removed.map((r) => (
            <li key={r.service.id} className="rounded-lg border border-borderSoft bg-bg px-3 py-2 text-[13px]">
              <span className="font-semibold">{r.service.name}</span> {r.backAlive && <Badge tone="ok">サイトが戻っています</Badge>}
              <p className="mt-0.5 text-[12px] text-muted">{formatTime(r.removedAt)}に外しました: {r.reason}</p>
              <Button className="mt-1" variant="ghost" disabled={busy} onClick={() => run(async () => setState((await api.rosterRestore(r.service.id)).state))}>戻す</Button>
            </li>
          ))}
        </ul>
      )}
      {state.log.length > 0 && (
        <details className="mt-2 text-[12px]">
          <summary className="cursor-pointer text-muted">これまでの入れ替わり({state.log.length}件)</summary>
          <ul className="mt-1 space-y-0.5">
            {state.log.map((l, i) => (
              <li key={i}>{formatTime(l.at)} {l.name}: {KIND_LABEL[l.kind] ?? l.kind}。{l.text}</li>
            ))}
          </ul>
        </details>
      )}
      <Button variant="ghost" className="mt-3" disabled={busy || state.running} onClick={() => run(async () => { setState(await api.rosterRun()); refresh(); })}>いま確認する</Button>
    </Card>
  );
}
