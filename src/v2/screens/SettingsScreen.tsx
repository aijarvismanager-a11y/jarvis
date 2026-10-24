import { useState } from "react";
import { api } from "../api";
import { FREE_LABEL, LEVEL_LABEL, formatTime } from "../labels";
import { Badge, Button, Card, Details } from "../ui";
import { useAction, usePoll } from "../hooks";
import type { AiService, Project, WebAiSettings } from "../types";

function DeleteProjectCard({ project, setError, onDeleted }: { project: Project; setError: (m: string) => void; onDeleted: () => void }) {
  const { busy, run } = useAction(setError);
  const remove = () => {
    if (!window.confirm(`プロジェクト「${project.name}」を削除します。

このアプリの中にある作業用のコピー、依頼の記録、できたもの、変更の履歴がすべて消え、元に戻せません。
(取り込み元の元のフォルダは消えません)

削除しますか?`)) return;
    void run(async () => {
      await api.deleteProject(project.id);
      onDeleted();
    });
  };
  return (
    <Card title="このプロジェクトの削除">
      <p className="text-[13px]">「{project.name}」を、このアプリから消します。試しに取り込んだプロジェクトの片付けに使えます。</p>
      <p className="mt-1 text-[12px] text-muted">消えるのは、このアプリ内のコピーと記録だけです。取り込み元の元のフォルダには何もしません。実行中の依頼があるときは、先に止めてください。</p>
      <Button variant="danger" className="mt-3" disabled={busy} onClick={remove}>このプロジェクトを削除</Button>
    </Card>
  );
}

export function SettingsScreen({ services, project, setError, refresh, onProjectDeleted }: { services: AiService[]; project: Project | null; setError: (m: string) => void; refresh: () => void; onProjectDeleted: () => void }) {
  const [web, setWeb] = useState<WebAiSettings | null>(null);
  const { busy, run } = useAction(setError);
  const reload = usePoll(async () => setWeb(await api.webAiSettings()), 10000, []);
  const done = () => {
    reload();
    refresh();
  };

  return (
    <div className="space-y-4">
      {project && <DeleteProjectCard project={project} setError={setError} onDeleted={onProjectDeleted} />}
      <Card title="ブラウザ上のAIも使う(ChatGPT・Gemini など・上級者向け)">
        {!web ? (
          <p className="text-[13px] text-muted">読み込み中…</p>
        ) : !web.available ? (
          <p className="text-[13px] text-muted">この環境ではWeb AI機能が接続されていません。</p>
        ) : (
          <>
            <label className="flex items-start gap-3 text-[13px]">
              <input type="checkbox" className="mt-1" checked={web.enabled} disabled={busy} onChange={(e) => run(async () => { await api.setWebAi(e.target.checked); done(); })} />
              <span>
                <span className="font-semibold">ブラウザ上のAI(ChatGPT・Gemini など)も使う</span>
                <span className="block text-[12px] text-muted">オフの間は、すべての作業を Claude Code が実行します(既定)。オンにすると、調査・文書系の作業だけ Web AI に回ることがあり、その場合はあなたの操作(コピー&貼り付け)が必要です。コードの編集は常に Claude Code が行います。</span>
              </span>
            </label>
            <p className="mt-2 text-[12px] text-muted">
              ブラウザ(Edge/Chrome/Brave): {web.browserAvailable ? "見つかりました(「半自動」「全自動」も選べます)" : "見つかりません(「手動」のみ)"}
            </p>
            {web.browserAvailable && (
              <div className="mt-3 rounded-lg border border-borderSoft bg-bg p-3">
                <p className="text-[13px] font-semibold">いつものブラウザのログインを引き継ぐ</p>
                <p className="mt-1 text-[12px] text-muted">「ログイン用に開く」で開く専用ブラウザは、最初は何もログインしていません。ふだん使っているブラウザ(Braveなど)で Google にログイン済みなら、そのログイン状態をコピーして、再ログインの手間を省けます。コピーするのはログイン状態(Cookie など)だけで、保存したパスワード・履歴・拡張機能は含みません。<b>先に、Brave をすべて閉じてから</b>押してください。</p>
                <Button variant="ghost" className="mt-2" disabled={busy} onClick={() => run(async () => { const r = await api.importSignIn(); window.alert(`引き継ぎました(プロフィール: ${r.profile})。このあと「ログイン用に開く」を押して、ログイン済みか確認してください。`); })}>ログイン状態を引き継ぐ</Button>
              </div>
            )}
          </>
        )}
      </Card>

      <Card title="使えるAIの一覧(ふだんは触らなくて大丈夫です)">
        <p className="mb-3 text-[12px] text-muted">「操作のしかた」を手動から半自動・全自動に変えるかは、あなたの判断です(自動では変わりません)。多くのブラウザ上のAIは利用規約で自動操作を制限している場合があります。半自動・全自動にする前に各サービスの規約を確認してください。</p>
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
                    操作のしかた
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
              {s.url && web?.available && web.browserAvailable && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button variant="ghost" disabled={busy} onClick={() => run(async () => { await api.openLogin(s.id); })}>ログイン用に開く</Button>
                  <span className="text-[11.5px] text-muted">自動化用の専用ブラウザで開きます。ご自身でログインして、終わったらそのブラウザを閉じてください(次回から自動で使われます)。</span>
                </div>
              )}
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
