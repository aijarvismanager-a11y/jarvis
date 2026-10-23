import { useState } from "react";
import { api } from "../api";
import { FREE_LABEL, LEVEL_LABEL, formatTime } from "../labels";
import { Badge, Button, Card, Details, useAction, usePoll } from "../ui";
import type { AiService, WebAiSettings } from "../types";

export function SettingsScreen({ services, setError, refresh }: { services: AiService[]; setError: (m: string) => void; refresh: () => void }) {
  const [web, setWeb] = useState<WebAiSettings | null>(null);
  const { busy, run } = useAction(setError);
  const reload = usePoll(async () => setWeb(await api.webAiSettings()), 10000, []);
  const done = () => {
    reload();
    refresh();
  };

  return (
    <div className="space-y-4">
      <Card title="Web AI(ChatGPT・Gemini などの利用)">
        {!web ? (
          <p className="text-[13px] text-muted">読み込み中…</p>
        ) : !web.available ? (
          <p className="text-[13px] text-muted">この環境ではWeb AI機能が接続されていません。</p>
        ) : (
          <>
            <label className="flex items-start gap-3 text-[13px]">
              <input type="checkbox" className="mt-1" checked={web.enabled} disabled={busy} onChange={(e) => run(async () => { await api.setWebAi(e.target.checked); done(); })} />
              <span>
                <span className="font-semibold">Web AI を使う</span>
                <span className="block text-[12px] text-muted">オフの間は、すべてのタスクを Claude Code が実行します(既定)。オンにすると、調査・文書系のタスクだけ Web AI に回ることがあり、その場合はあなたの操作(コピー&貼り付け)が必要です。コードの編集は常に Claude Code が行います。</span>
              </span>
            </label>
            <p className="mt-2 text-[12px] text-muted">
              ブラウザ(Edge/Chrome): {web.browserAvailable ? "見つかりました(半自動・全自動に引き上げ可能)" : "見つかりません(手動のみ)"}
            </p>
          </>
        )}
      </Card>

      <Card title="AIの一覧">
        <p className="mb-3 text-[12px] text-muted">自動化レベルの引き上げはあなたの判断です(自動では上がりません)。多くのWeb AIは利用規約で自動操作を制限している場合があります。半自動・全自動にする前に各サービスの規約を確認してください。</p>
        <div className="mb-3">
          <Button variant="ghost" disabled={busy} onClick={() => run(async () => { await api.healthCheck(); done(); })}>{busy ? "確認中…" : "接続状況を確認"}</Button>
        </div>
        <Details summary={`登録されているAI(${services.length}件)`}>
        <ul className="space-y-2">
          {services.map((s) => (
            <li key={s.id} className="rounded-lg border border-borderSoft bg-bg px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold">{s.name}</span>
                <Badge tone={s.freeStatus === "paid" ? "bad" : s.freeStatus === "unknown" ? "neutral" : "ok"}>{FREE_LABEL[s.freeStatus] ?? s.freeStatus}</Badge>
                {s.status !== "active" && <Badge tone="warn">{s.status === "unavailable" ? "利用不可" : "廃止"}</Badge>}
                {s.requiresApiKey && <Badge tone="bad">APIキー必須(使用しません)</Badge>}
                {s.url && web?.available ? (
                  <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
                    自動化
                    <select
                      value={s.automationLevel}
                      disabled={busy}
                      onChange={(e) => run(async () => { await api.setAutomationLevel(s.id, Number(e.target.value)); done(); })}
                      className="rounded border border-border bg-panel px-1.5 py-1 text-[12px] text-ink"
                    >
                      {[1, 2, 3].map((l) => (
                        <option key={l} value={l} disabled={l > 1 && !web.sites[s.id] && s.automationLevel < l}>
                          Level {l}: {LEVEL_LABEL[l]}{l > 1 && !web.sites[s.id] ? "(サイト設定なし)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="ml-auto text-[12px] text-muted">Level {s.automationLevel}: {LEVEL_LABEL[s.automationLevel]}</span>
                )}
              </div>
              <Details summary="詳細">
                <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-[12px]">
                  <dt className="text-muted">能力</dt><dd>{s.capabilities.join("、") || "未登録"}</dd>
                  <dt className="text-muted">接続方式</dt><dd>{s.accessMode}</dd>
                  <dt className="text-muted">最終確認</dt><dd>{s.lastVerifiedAt ? formatTime(s.lastVerifiedAt) : "未確認"}</dd>
                  {s.limitations && (<><dt className="text-muted">制限</dt><dd className="whitespace-pre-wrap">{s.limitations}</dd></>)}
                </dl>
              </Details>
            </li>
          ))}
        </ul>
        </Details>
      </Card>
    </div>
  );
}
