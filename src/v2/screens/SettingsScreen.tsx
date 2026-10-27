import { useEffect, useState } from "react";
import { api } from "../api";
import { Badge, Button, Card, Details } from "../ui";
import { useAction, usePoll } from "../hooks";
import type { AiService, Project, TuningReport, WebAiSettings } from "../types";

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
  const [tuning, setTuning] = useState<TuningReport | null>(null);
  const [review, setReview] = useState<{ enabled: boolean; webAiEnabled: boolean; reviewer: string | null } | null>(null);
  const reload = usePoll(async () => { setWeb(await api.webAiSettings()); setReview(await api.aiReviewSettings()); setTuning(await api.scoreTuning().catch(() => null)); }, 10000, []);
  const done = () => {
    reload();
    refresh();
  };

  const [trying, setTrying] = useState<string | null>(null);
  const [tried, setTried] = useState<Record<string, string>>({});
  // the AI whose sign-in window was opened from the card: when that window is closed the app checks it by itself
  const [waitingLogin, setWaitingLogin] = useState<{ id: string; seen: boolean } | null>(null);
  const tryOne = async (s: AiService) => {
    setTrying(s.id);
    setTried((t) => ({ ...t, [s.id]: "" }));
    try {
      const r = await api.tryAutomation(s.id);
      setTried((t) => ({ ...t, [s.id]: r.ok ? "ok" : (r.reason ?? "試せませんでした") }));
      done();
    } catch (e) {
      setTried((t) => ({ ...t, [s.id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setTrying(null);
    }
  };
  useEffect(() => {
    if (!waitingLogin) return;
    const timer = setInterval(() => {
      void api.browserStatus().then((st) => {
        if (st.loginWindowOpen) {
          if (!waitingLogin.seen) setWaitingLogin({ ...waitingLogin, seen: true });
        } else if (waitingLogin.seen) {
          const svc = services.find((x) => x.id === waitingLogin.id);
          setWaitingLogin(null);
          if (svc) void tryOne(svc);
        }
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingLogin]);
  const canAutomate = (s: AiService) => s.accessMode === "web" && !!s.url && !!web?.sites[s.id];
  const candidates = services.filter(canAutomate);
  const autoCount = candidates.filter((s) => s.automationLevel >= 3 && !web?.botChecks?.[s.id]).length;

  const claudeCode = services.find((x) => x.id === "claude-code");
  const others = services.filter((x) => x.id !== "claude-code" && !canAutomate(x));
  const short = (name: string) => name.replace(/ ?\(Web\)/, "");

  return (
    <div className="space-y-4">
      <Card title="使うAI">
        <p className="text-[13px]">
          自動で使えるAI: <b>{autoCount + (claudeCode ? 1 : 0)}件</b>。調べもの・設計・文章などは、このAIが分担します。
        </p>
        <ul className="mt-3 space-y-2">
          {claudeCode && (
            <li className="rounded-lg border border-borderSoft bg-bg px-3 py-2 text-[13px]">
              <span className="font-semibold">Claude Code</span> <Badge tone="ok">自動で使えます</Badge> <span className="text-[12px] text-muted">コードを書くのは、いつもこのAIです</span>
            </li>
          )}
          {web?.available && web.browserAvailable && candidates.map((s) => {
            const auto = s.automationLevel >= 3;
            const result = tried[s.id];
            const check = web.botChecks?.[s.id];
            return (
              <li key={s.id} className="rounded-lg border border-borderSoft bg-bg px-3 py-2 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{short(s.name)}</span>
                  {check ? <Badge tone="warn">人間確認が必要</Badge> : auto ? <Badge tone="ok">自動で使えます</Badge> : <Badge>まだ使えません</Badge>}
                  {check && trying !== s.id && waitingLogin?.id !== s.id && (
                    <Button disabled={busy || trying !== null || waitingLogin !== null} onClick={() => run(async () => { await api.openCheck(s.id); setTried((t) => ({ ...t, [s.id]: "" })); setWaitingLogin({ id: s.id, seen: false }); })}>確認を済ませる</Button>
                  )}
                  {!auto && !check && trying !== s.id && waitingLogin?.id !== s.id && (
                    <Button disabled={busy || trying !== null || waitingLogin !== null} onClick={() => run(async () => { await api.openLogin(s.id); setTried((t) => ({ ...t, [s.id]: "" })); setWaitingLogin({ id: s.id, seen: false }); })}>ログインして使えるようにする</Button>
                  )}
                </div>
                {check && waitingLogin?.id !== s.id && trying !== s.id && (
                  <p className="mt-1 text-[12px] text-muted">
                    {check.kind === "always" ? "毎回「私はロボットではありません」などの確認が出るため、いまは自動で使っていません。" : "確認が出たため、しばらく休ませています。"}
                    「確認を済ませる」で開くブラウザで、ご自身で確認を通して、ブラウザを閉じてください。
                  </p>
                )}
                {waitingLogin?.id === s.id && <p className="mt-1 text-[12px] text-[#8A6212]">開いたブラウザで {short(s.name)} {check ? "の確認(ログイン・ロボット確認など)を済ませて" : "にログインして"}、そのブラウザを閉じてください。閉じると、自動で確認します。</p>}
                {trying === s.id && <p className="mt-1 text-[12px] text-muted">確認しています…(1分ほど)</p>}
                {result === "ok" && <p className="mt-1 text-[12px] text-status-done">確認できました。これで使えます。</p>}
                {result && result !== "ok" && <p className="mt-1 text-[12px] text-[#9B2C2C]">使えるようにできませんでした: {result}</p>}
              </li>
            );
          })}
        </ul>
        {web?.available && !web.browserAvailable && <p className="mt-2 text-[12px] text-muted">ブラウザ(Edge・Chrome・Brave)が見つからないため、ブラウザ上のAIは使えません。</p>}
        {others.length > 0 && (
          <Details summary={`画像・動画・音楽などのAI(${others.length}件・手動で使います)`}>
            <p className="text-[12px] text-muted">画像・動画・音楽づくりなどで、AIの画面を開いて操作する必要があるものです。ふだんは何もしなくて大丈夫です。必要になったときに、画面で案内します。</p>
            <p className="mt-2 text-[12px]">{others.map((x) => short(x.name)).join("、")}</p>
          </Details>
        )}
      </Card>

      <Card title="オプション">
        <div className="space-y-3 text-[13px]">
          {web?.available && (
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" checked={web.enabled} disabled={busy} onChange={(e) => run(async () => { await api.setWebAi(e.target.checked); done(); })} />
              <span><span className="font-semibold">ブラウザ上のAIも使う</span><span className="block text-[12px] text-muted">オフにすると、すべて Claude Code がやります。</span></span>
            </label>
          )}
          {review && (
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" checked={review.enabled} disabled={busy} onChange={(e) => run(async () => { await api.setAiReview(e.target.checked); done(); })} />
              <span><span className="font-semibold">重要な作業を、別のAIにもチェックしてもらう</span><span className="block text-[12px] text-muted">設計やコードなどの大事な作業を、別のメーカーのAIが確認します。{review.reviewer ? `いまの確認役: ${review.reviewer}` : ""}</span></span>
            </label>
          )}
          {tuning && (
            <div>
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1" checked={tuning.enabled} disabled={busy} onChange={(e) => run(async () => { await api.setScoreTuning(e.target.checked); done(); })} />
                <span><span className="font-semibold">AIの得意・不得意を、結果から学ぶ</span><span className="block text-[12px] text-muted">うまくいったか、失敗したかをもとに、AIの選び方を少しずつ良くします。</span></span>
              </label>
              {tuning.entries.length > 0 && (
                <Details summary="学んだ内容を見る">
                  <ul className="space-y-2 text-[12px]">
                    {tuning.entries.map((e) => (
                      <li key={e.aiId}>
                        <span className="font-semibold">{short(e.name)}</span>
                        {e.items.filter((i) => i.good + i.bad > 0).map((i) => (
                          <div key={i.key} className="text-muted">{i.label}: {i.start ?? "—"} → {i.now ?? "—"}</div>
                        ))}
                      </li>
                    ))}
                  </ul>
                  <Button variant="ghost" className="mt-2" disabled={busy} onClick={() => run(async () => { await api.resetScoreTuning(); done(); })}>学んだ内容を消す</Button>
                </Details>
              )}
            </div>
          )}
        </div>
      </Card>

      {web?.available && web.browserAvailable && (
        <Details summary="ログインがうまくいかないとき">
          <p className="text-[12px] text-muted">ふだん使っているブラウザ(Brave)で Google にログイン済みなら、そのログイン状態をコピーできます(パスワードや履歴は含みません)。先に Brave をすべて閉じてから押してください。</p>
          <Button variant="ghost" className="mt-2" disabled={busy} onClick={() => run(async () => { const r = await api.importSignIn(); window.alert(`引き継ぎました(${r.profile})。もう一度「ログインして使えるようにする」を押してください。`); })}>ログイン状態をコピーする</Button>
        </Details>
      )}

      {project && <DeleteProjectCard project={project} setError={setError} onDeleted={onProjectDeleted} />}
    </div>
  );
}
