import { useEffect, useState } from "react";
import { api } from "../api";
import { Badge, Button, Card, Details } from "../ui";
import { useAction, usePoll } from "../hooks";
import { resetIn, formatTime } from "../labels";
import type { AiService, ClaudeQuota, Environment, Project, TuningReport, WebAiSettings } from "../types";

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

function QuotaBar({ label, w }: { label: string; w: { utilization: number | null; resetsAt: string | null } | null }) {
  if (!w) return null;
  const pct = w.utilization === null ? null : Math.round(w.utilization * 100);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px]">
      <span className="w-14 shrink-0 text-muted">{label}</span>
      {pct !== null && (
        <span className="h-1.5 w-28 overflow-hidden rounded-full bg-sidebar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${label}の使用率`}>
          <span className={`block h-full ${pct >= 90 ? "bg-[#9B2C2C]" : pct >= 70 ? "bg-[#B7791F]" : "bg-accent"}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </span>
      )}
      <span>{pct === null ? "使用率は不明" : `${pct}% 使用`}</span>
      <span className="text-muted">{resetIn(w.resetsAt)}</span>
    </div>
  );
}

/** The Claude plan's usage, as Claude Code reports it (the same plan claude.ai chat uses). */
function ClaudeQuotaView({ setError }: { setError: (m: string) => void }) {
  const [quota, setQuota] = useState<ClaudeQuota | null>(null);
  const { busy, run } = useAction(setError);
  usePoll(async () => setQuota(await api.claudeQuota().catch(() => null)), 20000, []);
  return (
    <div className="mt-1">
      {quota ? (
        <>
          <QuotaBar label="5時間枠" w={quota.fiveHour} />
          <QuotaBar label="7日枠" w={quota.sevenDay} />
          {quota.status === "rejected" && <p className="mt-1 text-[12px] text-[#9B2C2C]">いま上限に達しています。リセットまで Claude Code は使えません。</p>}
          <p className="mt-1 text-[11.5px] text-muted">{formatTime(quota.checkedAt)} 時点。Claude(claude.ai のチャット)と同じ枠です。</p>
        </>
      ) : (
        <p className="text-[12px] text-muted">まだ読み取っていません。作業を1回実行するか、下のボタンで確認します。</p>
      )}
      <Button variant="ghost" className="mt-1" disabled={busy} onClick={() => run(async () => setQuota(await api.refreshClaudeQuota()))}>{busy ? "確認中…(30秒ほど)" : "いまの使用量を確認"}</Button>
    </div>
  );
}

function EnvironmentCard({ project }: { project: Project | null }) {
  const [env, setEnv] = useState<Environment | null>(null);
  usePoll(async () => setEnv(await api.environment(project?.id ?? null).catch(() => null)), 60000, [project?.id]);
  if (!env) return null;
  const rows: [string, string, string][] = [
    ["データの置き場所", env.root, "このアプリの記録・コピー・バックアップは、すべてこの下にあります"],
    ["プロジェクトの作業用コピー", env.projectsDir, "AIが実際にファイルを書き換える場所(取り込んだ元のフォルダではありません)"],
    ["バックアップ", env.backupsDir, "「元のフォルダに反映する」の前に自動で取る控え"],
    ["変更の履歴(巻き戻し用)", env.snapshotsDir, "作業ごとの前後の状態。「この作業の変更を元に戻す」で使います"],
    ["ブラウザ上のAIのログイン情報", env.browserProfileDir, "ChatGPT・Gemini などにログインした状態を覚えている専用のブラウザ"],
    ["記録のデータベース", env.dataDir, "依頼・作業・AIの記録(orchestrator.db)"],
  ];
  if (env.project) {
    rows.unshift(["このプロジェクトの作業用コピー", env.project.workDir, "AIが書き換えるのはここだけです"]);
    if (env.project.sourcePath) rows.splice(1, 0, ["取り込み元の元のフォルダ", env.project.sourcePath, "反映のボタンを押すまで、変わりません"]);
  }
  return (
    <Details summary="フォルダと環境(データの場所)">
      <dl className="space-y-2 text-[12.5px]">
        {rows.map(([name, value, note]) => (
          <div key={name + value}>
            <dt className="font-semibold">{name}</dt>
            <dd className="break-all font-mono text-[12px]">{value}</dd>
            <dd className="text-[11.5px] text-muted">{note}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11.5px] text-muted">{env.platform} · Node {env.node}</p>
    </Details>
  );
}

export function SettingsScreen({ section, services, project, setError, refresh, onProjectDeleted }: { section: "ai" | "app"; services: AiService[]; project: Project | null; setError: (m: string) => void; refresh: () => void; onProjectDeleted: () => void }) {
  const [web, setWeb] = useState<WebAiSettings | null>(null);
  const { busy, run } = useAction(setError);
  const [tuning, setTuning] = useState<TuningReport | null>(null);
  const [review, setReview] = useState<{ enabled: boolean; webAiEnabled: boolean; reviewer: string | null } | null>(null);
  const [usage, setUsage] = useState<Record<string, { last3h: number; last24h: number; lastAt: string | null }>>({});
  usePoll(async () => setUsage(await api.aiUsage().catch(() => ({}))), 15000, []);
  const usageLine = (id: string) => {
    const u = usage[id];
    return u ? `使った回数: 直近3時間 ${u.last3h}回 · 直近24時間 ${u.last24h}回` : "使った回数: 直近24時間 0回";
  };
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
      // the site asked for a sign-in although it was marked as signed in: the mark is wrong, so the sign-in button must come back
      if (!r.ok && r.reason?.includes("ログインが必要です") && web?.loggedIn?.[s.id]) await api.setLoggedIn(s.id, false).catch(() => undefined);
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
  const isReady = (s: AiService) => s.automationLevel >= 3 && !web?.botChecks?.[s.id] && !web?.usageLimits?.[s.id];
  const autoCount = candidates.filter(isReady).length;
  const isResting = (s: AiService) => !!web?.usageLimits?.[s.id];
  const ready = candidates.filter(isReady);
  const resting = candidates.filter(isResting);
  // semi-automatic (Level 2): the app fills the prompt in, the person presses send (and passes a bot check when the site asks)
  const isSemi = (s: AiService) => s.automationLevel === 2 && !web?.usageLimits?.[s.id];
  const semi = candidates.filter(isSemi);
  const notReady = candidates.filter((s) => !isReady(s) && !isResting(s) && !isSemi(s));

  const claudeCode = services.find((x) => x.id === "claude-code");
  const others = services.filter((x) => x.id !== "claude-code" && !canAutomate(x));
  const short = (name: string) => name.replace(/ ?\(Web\)/, "");

  const renderRow = (s: AiService) => {
            const auto = s.automationLevel >= 3;
            const result = tried[s.id];
            const check = s.automationLevel >= 3 ? web?.botChecks?.[s.id] : undefined; // at Level 2 the person passes the check themselves
            const limitUntil = web?.usageLimits?.[s.id];
            return (
              <li key={s.id} className="rounded-lg border border-borderSoft bg-bg px-3 py-2 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{short(s.name)}</span>
                  {limitUntil ? <Badge tone="warn">上限に達しました</Badge> : check ? <Badge tone="warn">人間確認が必要</Badge> : auto ? <Badge tone="ok">自動で使えます</Badge> : s.automationLevel === 2 ? <Badge tone="info">半自動で使えます</Badge> : <Badge>まだ使えません</Badge>}
                  {check && trying !== s.id && waitingLogin?.id !== s.id && (
                    <Button disabled={busy || trying !== null || waitingLogin !== null} onClick={() => run(async () => { await api.openCheck(s.id); setTried((t) => ({ ...t, [s.id]: "" })); setWaitingLogin({ id: s.id, seen: false }); })}>確認を済ませる</Button>
                  )}
                  {!auto && s.automationLevel !== 2 && !check && !limitUntil && trying !== s.id && waitingLogin?.id !== s.id && (web?.loggedIn?.[s.id] ? (
                    // signed in already (the sign-in is remembered), yet not automatic: what is missing is a check, not another sign-in
                    <Button disabled={busy || trying !== null || waitingLogin !== null} onClick={() => void tryOne(s)}>使えるか確認する</Button>
                  ) : (
                    <Button disabled={busy || trying !== null || waitingLogin !== null} onClick={() => run(async () => { await api.openLogin(s.id); setTried((t) => ({ ...t, [s.id]: "" })); setWaitingLogin({ id: s.id, seen: false }); })}>ログインして使えるようにする</Button>
                  ))}
                </div>
                {usage[s.id] && usage[s.id].last24h > 0 && <p className="mt-0.5 text-[12px] text-muted">{usageLine(s.id)}</p>}
                {limitUntil && <p className="mt-1 text-[12px] text-muted">このAIは「利用上限に達した」と答えたため、{formatTime(limitUntil)}ごろまで休ませています。その間は、ほかのAIが引き受けます。</p>}
                {check && waitingLogin?.id !== s.id && trying !== s.id && (
                  <p className="mt-1 text-[12px] text-muted">
                    {check.kind === "always" ? "毎回「私はロボットではありません」などの確認が出るため、いまは自動で使っていません。" : "確認が出たため、しばらく休ませています。"}
                    「確認を済ませる」で開くブラウザで、そのAIに「こんにちは」などと1通送ってみてください(確認は、メッセージを送ったときに出ることがあります)。確認が出たら、ご自身で通して、ブラウザを閉じてください。
                  </p>
                )}
                {waitingLogin?.id === s.id && <p className="mt-1 text-[12px] text-[#8A6212]">開いたブラウザで {short(s.name)} {check ? "の確認(ログイン・ロボット確認など)を済ませて" : "にログインして"}、そのブラウザを閉じてください。閉じると、自動で確認します。</p>}
                {trying === s.id && <p className="mt-1 text-[12px] text-muted">確認しています…(1分ほど)</p>}
                {result === "ok" && <p className="mt-1 text-[12px] text-status-done">確認できました。これで使えます。</p>}
                {result && result !== "ok" && <p className="mt-1 text-[12px] text-[#9B2C2C]">使えるようにできませんでした: {result}</p>}
              </li>
            );
  };

  return (
    <div className="space-y-4">
      {section === "ai" && (<>
      <Card title="使うAI">
        <p className="text-[13px]">
          自動で使えるAI: <b>{autoCount + (claudeCode ? 1 : 0)}件</b>。調べもの・設計・文章などは、このAIが分担します。
        </p>
        <ul className="mt-3 space-y-2">
          {claudeCode && (
            <li className="rounded-lg border border-borderSoft bg-bg px-3 py-2 text-[13px]">
              <span className="font-semibold">Claude Code</span> <Badge tone="ok">自動で使えます</Badge> <span className="text-[12px] text-muted">コードを書くのは、いつもこのAIです</span>
              <p className="mt-0.5 text-[12px] text-muted">{usageLine("claude-code")}</p>
              <ClaudeQuotaView setError={setError} />
            </li>
          )}
        </ul>
        {web?.available && web.browserAvailable && ready.length > 0 && (
          <>
            <h3 className="mt-4 text-[13px] font-semibold">ブラウザ上の自動で使えるAI({ready.length}件)</h3>
            <ul className="mt-2 grid items-start gap-2 lg:grid-cols-2">{ready.map(renderRow)}</ul>
          </>
        )}
        {web?.available && web.browserAvailable && semi.length > 0 && (
          <>
            <h3 className="mt-4 text-[13px] font-semibold">半自動で使えるAI({semi.length}件)</h3>
            <p className="text-[12px] text-muted">アプリが依頼の文を入力欄に入れます。<b>送信ボタンは、あなたが押します</b>。ロボット確認が出たときも、ご自身で通してください。返事はアプリが読み取ります。作業が回ってきたときは、画面で知らせます。</p>
            <ul className="mt-2 grid items-start gap-2 lg:grid-cols-2">{semi.map(renderRow)}</ul>
          </>
        )}
        {web?.available && web.browserAvailable && resting.length > 0 && (
          <>
            <h3 className="mt-4 text-[13px] font-semibold">いま休んでいるAI({resting.length}件)</h3>
            <p className="text-[12px] text-muted">サイトの利用上限に達したAIです。時間がたつと自動で戻ります。その間は、ほかのAIが引き受けます。</p>
            <ul className="mt-2 grid items-start gap-2 lg:grid-cols-2">{resting.map(renderRow)}</ul>
          </>
        )}
        {web?.available && web.browserAvailable && notReady.length > 0 && (
          <>
            <h3 className="mt-4 text-[13px] font-semibold">まだ使えないAI({notReady.length}件)</h3>
            <p className="text-[12px] text-muted">使いたいAIだけ、「ログインして使えるようにする」を押してください。使わないAIは、そのままで大丈夫です。</p>
            <ul className="mt-2 grid items-start gap-2 lg:grid-cols-2">{notReady.map(renderRow)}</ul>
          </>
        )}
        <p className="mt-2 text-[12px] text-muted">「使った回数」は、このアプリが各AIに頼んだ回数です。ChatGPT・Gemini などのサイトは残りの枠を教えてくれないため、サイト側の本当の残量は分かりません。「人間確認が必要」と出たAIや、サイトの利用上限に達したAIは、しばらく休み、その間は別のAIが引き受けます。</p>
        {web?.available && !web.browserAvailable && <p className="mt-2 text-[12px] text-muted">ブラウザ(Edge・Chrome・Brave)が見つからないため、ブラウザ上のAIは使えません。</p>}
        {others.length > 0 && (
          <Details summary={`画像・動画・音楽などのAI(${others.length}件・手動で使います)`}>
            <p className="text-[12px] text-muted">画像・動画・音楽づくりなどで、AIの画面を開いて操作する必要があるものです。ふだんは何もしなくて大丈夫です。必要になったときに、画面で案内します。</p>
            <p className="mt-2 text-[12px]">{others.map((x) => short(x.name)).join("、")}</p>
          </Details>
        )}
      </Card>

      {web?.available && web.browserAvailable && (
        <Details summary="ログインがうまくいかないとき">
          <p className="text-[12px] text-muted">ふだん使っているブラウザ(Brave)で Google にログイン済みなら、そのログイン状態をコピーできます(パスワードや履歴は含みません)。先に Brave をすべて閉じてから押してください。</p>
          <Button variant="ghost" className="mt-2" disabled={busy} onClick={() => run(async () => { const r = await api.importSignIn(); window.alert(`引き継ぎました(${r.profile})。もう一度「ログインして使えるようにする」を押してください。`); })}>ログイン状態をコピーする</Button>
        </Details>
      )}

      </>)}
      {section === "app" && (<>
      <Card title="動き方の設定">
        <div className="space-y-3 text-[13px]">
          {web?.available && (
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" checked={web.enabled} disabled={busy} onChange={(e) => run(async () => { await api.setWebAi(e.target.checked); done(); })} />
              <span><span className="font-semibold">ブラウザ上のAIも使う</span><span className="block text-[12px] text-muted">ChatGPT や Gemini など、ブラウザで開くAIにも作業を分けます。AIには、依頼の文と、プロジェクトのファイルの一部(一覧と、関係するファイルの抜粋)を送ります。<b>プロジェクトの中身を外に出したくないときは、オフにしてください。</b>オフにすると、すべて Claude Code がやります。</span></span>
            </label>
          )}
          {review && (
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" checked={review.enabled} disabled={busy} onChange={(e) => run(async () => { await api.setAiReview(e.target.checked); done(); })} />
              <span><span className="font-semibold">重要な作業を、別のAIにもチェックしてもらう</span><span className="block text-[12px] text-muted">設計やコードなどの大事な作業を、作ったAIとは別のメーカーのAIが確認します。確認できるAI(自動で動かせて、ログイン済みのもの)が、順番に担当します。{review.reviewer ? `次の担当: ${review.reviewer}` : "いまは確認できるAIがないので、確認は行いません。"}</span></span>
            </label>
          )}
          {tuning && (
            <div>
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1" checked={tuning.enabled} disabled={busy} onChange={(e) => run(async () => { await api.setScoreTuning(e.target.checked); done(); })} />
                <span><span className="font-semibold">AIの得意・不得意を、結果から学ぶ</span><span className="block text-[12px] text-muted">作業が終わるたびに、うまくいったか、失敗したかを記録して、次からのAIの選び方に使います。同じAIの結果が3件たまるまでは、何も変わりません。変わる幅も小さく、いつでも元に戻せます。</span></span>
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

      <Card title="フォルダと環境"><EnvironmentCard project={project} /></Card>
      {project && <DeleteProjectCard project={project} setError={setError} onDeleted={onProjectDeleted} />}
      </>)}
    </div>
  );
}
