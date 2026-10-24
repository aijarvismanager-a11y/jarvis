import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { aiNameOf, type Ctx } from "../context";
import { MISSION_LABEL, TASK_LABEL, deriveProjectName, elapsedSince, formatTime, progressOf, roleLabel } from "../labels";
import { Badge, Button, Card, Details, useAction, usePoll } from "../ui";
import type { Approval, Handoff, LogEntry, MissionView, Preview, Task } from "../types";

function StepMark({ status }: { status: Task["status"] }) {
  if (status === "completed") return <span className="text-status-done">✓</span>;
  if (status === "failed" || status === "blocked") return <span className="text-[#9B2C2C]">✕</span>;
  if (status === "cancelled") return <span className="text-muted">–</span>;
  if (status === "running" || status === "validation" || status === "waiting") return <span className="text-accent">●</span>;
  return <span className="text-muted">○</span>;
}

const LOG_MARK: Record<LogEntry["kind"], string> = { text: "💬", tool: "🔧", info: "•", error: "⚠" };

/** What the AI is doing right now in this task: its messages and tool calls, newest at the bottom. */
function LiveLog({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [all, setAll] = useState(false);
  const cursor = useRef(0);
  usePoll(
    async () => {
      const r = await api.taskLog(projectId, taskId, cursor.current);
      if (r.entries.length === 0) return;
      cursor.current = r.entries[r.entries.length - 1]!.seq;
      setEntries((prev) => [...prev, ...r.entries].slice(-200));
    },
    2000,
    [projectId, taskId],
  );
  const shown = all ? entries : entries.slice(-5);
  return (
    <div className="ml-6 mt-1 rounded-lg bg-sidebar px-3 py-2">
      {entries.length === 0 ? (
        <p className="text-[12px] text-muted">作業の様子を待っています…(ログは Claude Code が動いている間だけ出ます)</p>
      ) : (
        <>
          <ul className="space-y-0.5">
            {shown.map((e) => (
              <li key={e.seq} className={`break-words font-mono text-[11.5px] ${e.kind === "error" ? "text-[#9B2C2C]" : "text-[#4a473f]"}`}>
                <span className="mr-1.5">{LOG_MARK[e.kind]}</span>{e.text}
              </li>
            ))}
          </ul>
          {entries.length > 5 && <button className="mt-1 text-[11.5px] text-accent hover:underline" onClick={() => setAll(!all)}>{all ? "最新だけ表示" : `すべて表示(${entries.length}件)`}</button>}
        </>
      )}
    </div>
  );
}

/** Retry one failed task, optionally telling the AI what to do differently. */
function RetryControls({ task, ctx }: { task: Task; ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { busy, run } = useAction(ctx.setError);
  const go = () => run(async () => { await api.retryTask(ctx.project!.id, task.missionId, task.id, text); setText(""); setOpen(false); ctx.refresh(); });
  return (
    <div className="ml-6 mt-1">
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" disabled={busy} onClick={go}>このタスクをやり直す</Button>
        {!open && <Button variant="ghost" disabled={busy} onClick={() => setOpen(true)}>指示を足してやり直す</Button>}
      </div>
      {open && (
        <div className="mt-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="例: 削除機能は後回しにして、一覧と登録だけ作ってください" className="w-full rounded-lg border border-border bg-bg p-2 text-[13px] outline-none focus:border-accent" />
          <div className="mt-1 flex gap-2">
            <Button disabled={busy || !text.trim()} onClick={go}>この指示でやり直す</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>閉じる</Button>
          </div>
        </div>
      )}
    </div>
  );
}

const PREVIEW_LABEL: Record<Preview["state"], string> = { stopped: "停止中", starting: "起動中", running: "動作中", error: "起動できませんでした" };

/** Runs the project's app as it is right now, so it can be tried while the mission is still going. */
function PreviewCard({ ctx }: { ctx: Ctx }) {
  const projectId = ctx.project!.id;
  const [preview, setPreview] = useState<Preview | null>(null);
  const { busy, run } = useAction(ctx.setError);
  const refresh = usePoll(async () => setPreview(await api.preview(projectId)), 2500, [projectId]);
  const state = preview?.state ?? "stopped";
  const active = state === "starting" || state === "running";
  return (
    <Card title="動かして見る">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={state === "running" ? "ok" : state === "error" ? "bad" : state === "starting" ? "info" : "neutral"}>{PREVIEW_LABEL[state]}</Badge>
        {state === "running" && preview?.url && (
          <a href={preview.url} target="_blank" rel="noreferrer noopener" className="rounded-lg border border-border bg-panel px-3.5 py-2 text-[13px] font-semibold hover:bg-sidebar">画面を開く</a>
        )}
        {active ? (
          <Button variant="ghost" disabled={busy} onClick={() => run(async () => { setPreview(await api.stopPreview(projectId)); })}>停止</Button>
        ) : (
          <Button disabled={busy} onClick={() => run(async () => { setPreview(await api.startPreview(projectId)); refresh(); })}>{state === "error" ? "もう一度起動" : "起動して見る"}</Button>
        )}
      </div>
      {preview?.message && state !== "running" && <p className="mt-2 text-[13px]">{preview.message}</p>}
      {state === "running" && preview?.check && (
        preview.check.ok ? (
          <p className="mt-2 text-[12.5px] text-status-done">画面を開いて確認しました。エラーは出ていません。</p>
        ) : (
          <div className="mt-2 text-[12.5px] text-[#9B2C2C]">
            <p className="font-semibold">画面を開いたところ、問題がありました:</p>
            <ul className="list-disc pl-5">{preview.check.problems.map((p, i) => <li key={i} className="break-words">{p}</li>)}</ul>
          </div>
        )
      )}
      {preview?.log && state === "error" && <Details summary="ログを見る"><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px]">{preview.log}</pre></Details>}
      <p className="mt-2 text-[11.5px] text-muted">作りかけの状態のまま、あなたのPC上でだけ動かします(生成されたコードをそのまま実行します)。ミッションが作業中のファイルを読むため、動きが不安定なことがあります。</p>
    </Card>
  );
}

const APPROVAL_LEVEL: Record<Approval["level"], string> = {
  READ: "読み取り",
  WORKSPACE_WRITE: "ファイルの書き込み",
  NETWORK: "ネットワーク通信",
  DEPLOY: "公開・デプロイ",
  DESTRUCTIVE: "ファイルやデータの削除",
};

function ApprovalCard({ approval, ctx }: { approval: Approval; ctx: Ctx }) {
  const { busy, run } = useAction(ctx.setError);
  const task = ctx.overview.tasks.find((t) => t.id === approval.taskId);
  const answer = (approve: boolean) => run(async () => { await api.answerApproval(approval.id, approve); ctx.refresh(); });
  return (
    <Card className="border-accent/40">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone="warn">許可が必要</Badge>
        <span className="text-[13px] font-semibold">{APPROVAL_LEVEL[approval.level]}を伴う作業です</span>
      </div>
      <p className="text-[13px]">{task ? `${roleLabel(task.role)}: ${task.objective}` : approval.reason}</p>
      <p className="mt-1 text-[12px] text-muted">許可しても、このタスクの間だけ有効です。他のタスクには広がりません。拒否するとこのタスクは失敗として止まります。30分で自動的に拒否されます。</p>
      <div className="mt-3 flex gap-2">
        <Button disabled={busy} onClick={() => answer(true)}>許可して続ける</Button>
        <Button variant="danger" disabled={busy} onClick={() => answer(false)}>拒否する</Button>
      </div>
    </Card>
  );
}

function HandoffCard({ handoff, ctx }: { handoff: Handoff; ctx: Ctx }) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [extra, setExtra] = useState("");
  const [switchTo, setSwitchTo] = useState("");
  const { busy, run } = useAction(ctx.setError);
  const alternatives = handoff.alternatives ?? [];
  // The user's own addition goes at the end of the generated instruction, so it is copied along with it.
  const fullPrompt = extra.trim() ? `${handoff.prompt}\n\n【追加の指示】\n${extra.trim()}` : handoff.prompt;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullPrompt);
      setCopied(true);
    } catch {
      ctx.setError("コピーできませんでした。「指示文を見る」を開いて手動でコピーしてください");
    }
  };
  return (
    <Card className="border-accent/40">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone="warn">あなたの操作が必要</Badge>
        <span className="text-[13px] font-semibold">{handoff.aiName} に依頼してください</span>
      </div>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-[12.5px] text-[#4a473f]">
        <li>『指示文をコピー』ボタンを押す</li>
        <li>{handoff.url ? <>『{handoff.aiName}を開く』リンクから開き、貼り付けて送信する</> : <>{handoff.aiName} を開いて貼り付けて送信する</>}</li>
        <li>返ってきた回答を下の欄に貼り付けて『回答を送る』ボタンを押す</li>
      </ol>
      {handoff.note && <p className="mb-2 text-[12px] text-muted">{handoff.note}</p>}
      {alternatives.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted">別のAIに頼む:</span>
          <select aria-label="切り替え先のAI" value={switchTo} onChange={(e) => setSwitchTo(e.target.value)} className="rounded-lg border border-border bg-panel px-2 py-1.5 text-[13px]">
            <option value="">選んでください</option>
            {alternatives.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <Button variant="ghost" disabled={busy || !switchTo} onClick={() => run(async () => { await api.reassignHandoff(handoff.id, switchTo); ctx.refresh(); })}>このAIに切り替える</Button>
        </div>
      )}
      <label className="mb-2 block text-[12.5px] text-muted">
        指示文への追記(任意。コピーする指示文の末尾に付きます)
        <textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows={2} placeholder="例: 日本語で、表を使って答えてください" className="mt-1 w-full rounded-lg border border-border bg-bg p-2 text-[13px] text-ink outline-none focus:border-accent" />
      </label>
      <div className="mb-2 flex flex-wrap gap-2">
        <Button variant="ghost" onClick={copy}>{copied ? "コピーしました" : "指示文をコピー"}</Button>
        {handoff.url && (
          <a href={handoff.url} target="_blank" rel="noreferrer noopener" className="rounded-lg border border-border bg-panel px-3.5 py-2 text-[13px] font-semibold hover:bg-sidebar">
            {handoff.aiName}を開く
          </a>
        )}
      </div>
      <Details summary="指示文を見る">
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px]">{fullPrompt}</pre>
      </Details>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="AIの回答をここに貼り付け" className="mt-3 w-full rounded-lg border border-border bg-bg p-2.5 text-[13px] outline-none focus:border-accent" />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button disabled={busy || !text.trim()} onClick={() => run(async () => { await api.submitHandoff(handoff.id, text); setText(""); ctx.refresh(); })}>回答を送る</Button>
        <Button variant="ghost" disabled={busy} onClick={() => run(async () => { await api.skipHandoff(handoff.id); ctx.refresh(); })}>Web AIに任せず Claude Code で実行</Button>
      </div>
    </Card>
  );
}

function PlanReview({ view, ctx }: { view: MissionView; ctx: Ctx }) {
  const [feedback, setFeedback] = useState("");
  const { busy, run } = useAction(ctx.setError);
  const { mission, proposal } = view;
  if (!proposal) return <Card title="計画">計画を作成中です…</Card>;
  const act = (action: "approve" | "reject") =>
    run(async () => {
      if (action === "approve") {
        await api.missionAction(mission.projectId, mission.id, "approve");
        await api.missionAction(mission.projectId, mission.id, "run");
      } else await api.missionAction(mission.projectId, mission.id, "reject", feedback);
      setFeedback("");
      ctx.refresh();
    });
  return (
    <Card title={proposal.kind === "replan" ? "再計画の提案" : "計画の提案"}>
      {proposal.draft.summary && <p className="mb-3 text-[13px]">{proposal.draft.summary}</p>}
      <ol className="mb-3 space-y-1.5">
        {proposal.draft.tasks.map((t, i) => (
          <li key={t.key} className="text-[13px]">
            <span className="mr-2 text-muted">{i + 1}.</span>
            <span className="font-semibold">{roleLabel(t.role)}</span>
            <span className="ml-2 text-muted">{t.objective}</span>
          </li>
        ))}
      </ol>
      <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} placeholder="直してほしい点があれば入力(例: テストを厚く)" className="mb-2 w-full rounded-lg border border-border bg-bg p-2.5 text-[13px] outline-none focus:border-accent" />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => act("approve")}>この計画で開始</Button>
        <Button variant="ghost" disabled={busy || !feedback.trim()} onClick={() => act("reject")}>修正して再提案</Button>
      </div>
    </Card>
  );
}

function Intake({ ctx, onStarted }: { ctx: Ctx; onStarted: () => void }) {
  const [goal, setGoal] = useState("");
  const [constraints, setConstraints] = useState("");
  const [tech, setTech] = useState("");
  const { busy, run } = useAction(ctx.setError);
  const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const start = () =>
    run(async () => {
      const project = await ctx.ensureProject(deriveProjectName(goal));
      await api.createMission(project.id, goal.trim(), lines(constraints), tech.split(/[,、\n]/).map((s) => s.trim()).filter(Boolean));
      setGoal("");
      onStarted();
    });
  return (
    <Card>
      <label htmlFor="goal" className="mb-2 block font-serif text-[18px] font-semibold">何を作りますか?</label>
      <textarea id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} maxLength={4000} placeholder="例: 商品管理ができるシンプルなWebアプリを作って" className="w-full rounded-lg border border-border bg-bg p-3 text-[14px] outline-none focus:border-accent" />
      <div className="mt-3">
        <Details summary="詳細設定(任意)">
          <label className="mb-1 block text-[12px] text-muted">守ってほしい条件(1行に1つ)</label>
          <textarea value={constraints} onChange={(e) => setConstraints(e.target.value)} rows={2} className="mb-2 w-full rounded-lg border border-border bg-panel p-2 text-[13px]" />
          <label className="mb-1 block text-[12px] text-muted">使いたい技術(カンマ区切り)</label>
          <input value={tech} onChange={(e) => setTech(e.target.value)} className="w-full rounded-lg border border-border bg-panel p-2 text-[13px]" />
        </Details>
      </div>
      <div className="mt-3">
        <Button disabled={busy || !goal.trim()} onClick={start}>{busy ? "計画を作成中…(数十秒かかります)" : "開発を開始"}</Button>
      </div>
    </Card>
  );
}

const FINISHED = ["completed", "failed", "cancelled"];

export function MissionScreen({ ctx }: { ctx: Ctx }) {
  const { mission, overview, services, handoffs, approvals, project } = ctx;
  const [view, setView] = useState<MissionView | null>(null);
  const { busy, run } = useAction(ctx.setError);
  const [starting, setStarting] = useState(false);

  // The proposal is not part of /overview, so fetch the full view while a plan awaits approval.
  useEffect(() => {
    if (!mission || mission.status !== "planning") return void setView(null);
    let cancelled = false;
    api.missionView(mission.projectId, mission.id).then((v) => !cancelled && setView(v)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mission?.id, mission?.status, mission?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const showIntake = starting || !mission || FINISHED.includes(mission.status);
  const tasks = mission ? overview.tasks.filter((t) => t.missionId === mission.id).sort((a, b) => a.position - b.position) : [];
  const { done, total, percent } = progressOf(tasks);
  const doing = tasks.find((t) => t.status === "running" || t.status === "validation" || t.status === "waiting");
  const myHandoffs = handoffs.filter((h) => h.projectId === project?.id);
  const recent = [...overview.artifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const act = (action: "pause" | "cancel" | "resume" | "run" | "replan") =>
    run(async () => {
      if (!mission) return;
      await api.missionAction(mission.projectId, mission.id, action);
      ctx.refresh();
    });

  return (
    <div className="space-y-4">
      {mission && !starting && (
        <Card>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{project?.name ?? "プロジェクト"}</span>
            <Badge tone={mission.status === "completed" ? "ok" : mission.status === "failed" ? "bad" : mission.status === "running" ? "info" : "neutral"}>{MISSION_LABEL[mission.status]}</Badge>
          </div>
          <p className="font-serif text-[18px] font-semibold">{mission.goal}</p>
          {total > 0 && (
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-sidebar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-accent transition-all" style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-1 text-[12px] text-muted">{percent}%({done}/{total})</p>
            </div>
          )}
          {doing && (
            <p className="mt-3 text-[13px]"><span className="text-muted">現在: </span>{aiNameOf(services, doing.selectedAi)} が{roleLabel(doing.role)}{doing.status === "waiting" ? "の回答待ち" : "中"}</p>
          )}
          {tasks.length > 0 && (
            <ul className="mt-3 space-y-1">
              {tasks.map((t) => (
                <li key={t.id} className={`text-[13px] ${t.status === "pending" || t.status === "cancelled" ? "text-muted" : ""}`}>
                  <div className="flex items-start gap-2">
                    <StepMark status={t.status} />
                    <span className="min-w-0 flex-1"><span className="text-muted">{roleLabel(t.role)} / </span>{t.objective}</span>
                    {(t.status === "failed" || t.status === "blocked") && <Badge tone="bad">{TASK_LABEL[t.status]}</Badge>}
                    {t.status === "waiting" && <Badge tone="warn">{TASK_LABEL[t.status]}</Badge>}
                    {(t.status === "running" || t.status === "validation") && <span className="shrink-0 text-muted">{TASK_LABEL[t.status]} {elapsedSince(t.updatedAt)}</span>}
                  </div>
                  {overview.taskNotes?.[t.id] && <p className="ml-6 text-[12px] text-[#9B2C2C]">{overview.taskNotes[t.id]}</p>}
                  {(t.status === "running" || t.status === "validation") && <LiveLog projectId={ctx.project!.id} taskId={t.id} />}
                  {t.status === "failed" && !["completed", "cancelled", "planning"].includes(mission.status) && <RetryControls task={t} ctx={ctx} />}
                </li>
              ))}
            </ul>
          )}
          {tasks.length === 0 && mission.status === "draft" && (
            <p className="mt-3 text-[12.5px] text-muted">このミッションにはまだ計画がありません。「中止」してから新しいミッションを始めてください。</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {mission.status === "running" && <Button variant="ghost" disabled={busy} onClick={() => act("pause")}>一時停止</Button>}
            {mission.status === "paused" && <Button disabled={busy} onClick={() => act("resume")}>再開</Button>}
            {mission.status === "failed" && <Button disabled={busy} onClick={() => act("replan")}>計画をやり直す</Button>}
            {["draft", "planning", "running", "paused"].includes(mission.status) && <Button variant="danger" disabled={busy} onClick={() => act("cancel")}>中止</Button>}
            {FINISHED.includes(mission.status) && <Button variant="ghost" onClick={() => setStarting(true)}>新しいミッション</Button>}
          </div>
        </Card>
      )}

      {mission?.status === "planning" && view && <PlanReview view={view} ctx={ctx} />}
      {project && overview.artifacts.length > 0 && <PreviewCard ctx={ctx} />}
      {approvals.filter((a) => a.projectId === project?.id).map((a) => <ApprovalCard key={a.id} approval={a} ctx={ctx} />)}
      {myHandoffs.map((h) => <HandoffCard key={h.id} handoff={h} ctx={ctx} />)}

      {showIntake && (
        <>
          {starting && <div><Button variant="ghost" onClick={() => setStarting(false)}>← 現在のミッションに戻る</Button></div>}
          <Intake ctx={ctx} onStarted={() => { setStarting(false); ctx.refresh(); }} />
        </>
      )}

      {recent.length > 0 && (
        <Card title="最近の成果物">
          <ul className="space-y-1">
            {recent.map((a) => (
              <li key={a.id}>
                <button onClick={() => ctx.openArtifact(a)} className="text-[13px] text-accent hover:underline">{a.path}</button>
                <span className="ml-2 text-[11px] text-muted">{formatTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
