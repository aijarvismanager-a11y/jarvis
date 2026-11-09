import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";
import { aiNameOf, type Ctx } from "../context";
import { MISSION_LABEL, TASK_LABEL, deriveProjectName, elapsedSince, formatCost, formatDuration, formatTime, formatTokens, summarizeUsage, progressOf, roleLabel, shortGoal } from "../labels";
import { Badge, Button, Card, Details, GoalText } from "../ui";
import { useAction, usePoll } from "../hooks";
import { SplitPreview } from "./SplitPreview";
import { DepsCard } from "./DepsCard";
import { nextStep } from "../nextStep";
import { NextStepBanner } from "./NextStep";
import { summaryLine } from "./summaryLine";
import { FailureReason } from "./FailureReason";
import { ClaudeCheck, Welcome } from "./Welcome";
import { SyncCard } from "./SyncCard";
import { SayItHelper } from "../SayItHelper";
import type { Approval, Handoff, LogEntry, MissionView, Preview, Task, TaskChanges, MissionReport, Acceptance, NextIdeas, ReportAction, ReportTodo } from "../types";

/** A task's instruction is written for the AI and can run to several hundred characters: show the start, the rest on request. */
function TaskObjective({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const LIMIT = 90;
  if (text.length <= LIMIT) return <>{text}</>;
  return (
    <>
      {full ? text : `${text.slice(0, LIMIT)}…`}{" "}
      <button type="button" className="text-[12px] text-muted underline" onClick={() => setFull((v) => !v)}>{full ? "閉じる" : "全文を見る"}</button>
    </>
  );
}

function StepMark({ status }: { status: Task["status"] }) {
  if (status === "completed") return <span className="text-status-done">✓</span>;
  if (status === "failed" || status === "blocked") return <span className="text-[#9B2C2C]">✕</span>;
  if (status === "cancelled") return <span className="text-muted">–</span>;
  if (status === "running" || status === "validation" || status === "waiting") return <span className="text-accent">●</span>;
  return <span className="text-muted">○</span>;
}

/** "3分12秒 · $0.21" for one task, over all its attempts. */
function taskTime(runs: Parameters<typeof summarizeUsage>[0], taskId: string): string {
  const u = summarizeUsage(runs, new Set([taskId]));
  if (u.runs === 0 || u.durationMs === 0) return "";
  return `${formatDuration(u.durationMs)}${u.hasCost ? ` · ${formatCost(u.costUsd)}` : ""}`;
}

/** The AI's final answer for a task: what the run said, or (for a web AI, which saves its answer to a file) that file's content. */
type AnswerSource = { summary: string; paths: string[] };
function answerSource(ctx: Ctx, taskId: string): AnswerSource | null {
  const run = [...ctx.overview.aiRuns].filter((r) => r.task_id === taskId && r.status === "succeeded" && r.executor !== "ai-review" && r.summary && r.summary.trim().length > 40).pop();
  if (!run?.summary) return null;
  const paths = (/回答を保存しました:\s*(.+)$/.exec(run.summary)?.[1] ?? "").split(",").map((s) => s.trim()).filter((s) => /\.(md|txt)$/i.test(s)).slice(0, 3);
  return { summary: run.summary, paths };
}
async function loadAnswer(projectId: string, src: AnswerSource): Promise<string | null> {
  if (!src.paths.length) return src.summary;
  const parts = await Promise.all(src.paths.map((p) => api.artifactContent(projectId, p).catch(() => "")));
  return parts.filter(Boolean).join("\n\n---\n\n") || null; // the file cannot be read: the "saved to" notice alone says nothing useful
}

function Markdown({ text }: { text: string }) {
  return <div className="prose-artifact"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>;
}

/** One task's answer: folded away by default (a request has many), readable in full size, or in a large reading window. */
function TaskAnswer({ taskId, ctx }: { taskId: string; ctx: Ctx }) {
  const src = answerSource(ctx, taskId);
  const key = src ? `${src.summary}` : "";
  const projectId = ctx.project?.id;
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [big, setBig] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!src || !projectId) return setText(null);
    let alive = true;
    void loadAnswer(projectId, src).then((t) => alive && setText(t));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, projectId]);
  if (!text) return null;
  const firstLine = text.replace(/[#>*|`\-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const copy = () => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined); };
  return (
    <div className="ml-6 mt-1 rounded-lg border border-borderSoft bg-white px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" className="min-w-0 flex-1 text-left text-[12.5px]" onClick={() => setOpen(!open)}>
          <span className="font-semibold">AIの回答</span><span className="ml-2 text-muted">{open ? "" : `${firstLine}…`}</span>
        </button>
        <button type="button" className="text-[12px] text-accent hover:underline" onClick={() => setBig(true)}>大きく表示</button>
        <button type="button" className="text-[12px] text-accent hover:underline" onClick={copy}>{copied ? "コピーしました" : "コピー"}</button>
        <button type="button" className="text-[12px] text-accent hover:underline" onClick={() => setOpen(!open)}>{open ? "閉じる" : "開く"}</button>
      </div>
      {open && <div className="mt-2"><Markdown text={text} /></div>}
      {big && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4" onClick={() => setBig(false)}>
          <div className="my-4 w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-3 border-b border-borderSoft pb-2">
              <span className="font-semibold">AIの回答</span>
              <button type="button" className="ml-auto text-[12.5px] text-accent hover:underline" onClick={copy}>{copied ? "コピーしました" : "コピー"}</button>
              <Button variant="ghost" onClick={() => setBig(false)}>閉じる</Button>
            </div>
            <Markdown text={text} />
          </div>
        </div>
      )}
    </div>
  );
}

const FOLLOW_UPS = ["この内容の根拠や出典を教えて", "足りない項目や観点があれば追加して", "一番おすすめを1つ選んで、理由も教えて", "分かりにくいところを、やさしく説明し直して"];

/** Once per request (not per task): questions made from all the answers together, and a way to ask or ask for more. */
function MissionFollowUp({ ctx, tasks, onNewRequest }: { ctx: Ctx; tasks: Task[]; onNewRequest: (goal: string) => void }) {
  const projectId = ctx.project?.id;
  const done = tasks.filter((t) => t.status === "completed").map((t) => ({ t, src: answerSource(ctx, t.id) })).filter((x) => x.src);
  const key = done.map((x) => `${x.t.id}:${x.src!.summary}`).join("|");
  const [combined, setCombined] = useState("");
  useEffect(() => {
    if (!projectId || done.length === 0) return setCombined("");
    let alive = true;
    const per = Math.max(700, Math.floor(11000 / done.length));
    void Promise.all(done.map(async (x) => { const a = await loadAnswer(projectId, x.src!); return a && a.trim().length >= 80 ? `【作業${tasks.indexOf(x.t) + 1}:${roleLabel(x.t.role)}】\n${a.trim().slice(0, per)}` : ""; }))
      .then((parts) => alive && setCombined(parts.filter(Boolean).join("\n\n")));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, projectId]);
  const [question, setQuestion] = useState("");
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [replies, setReplies] = useState<string[]>([]);
  const { busy: asking, run: runAsk } = useAction(ctx.setError);
  if (!combined) return null;
  const attach = `\n\n【これまでの回答(要点)】\n${combined.slice(0, 2200)}`;
  return (
    <div className="mt-4 rounded-lg border border-borderSoft bg-bg px-3.5 py-3">
      <p className="text-[13px] font-semibold">AIからの確認と、続きの依頼</p>
      <p className="mb-2 text-[12px] text-muted">上のAIの回答をまとめて読んで、あなたに決めてほしいことを質問にします(作業ごとではなく、この依頼で1回です)。</p>
      {!questions ? (
        <Button variant="ghost" disabled={asking} onClick={() => void runAsk(async () => { const q = await api.followUpQuestions(combined); setQuestions(q); setReplies(q.map(() => "")); })}>{asking ? "質問を考えています…(1分ほどかかります)" : "確認の質問を作ってもらう"}</Button>
      ) : (
        <div className="space-y-2">
          <p className="text-[11.5px] text-muted">答えたいものだけ書いてください(空欄は飛ばされます)。</p>
          {questions.map((q, i) => (
            <div key={i}>
              <p className="text-[13px]">{i + 1}. {q}</p>
              <input value={replies[i] ?? ""} onChange={(e) => setReplies(replies.map((r, j) => (j === i ? e.target.value : r)))} maxLength={200} className="mt-0.5 w-full rounded-lg border border-border bg-white p-1.5 text-[13px]" />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={!replies.some((r) => r.trim())} onClick={() => onNewRequest(`これまでの回答について、次の確認への答えを反映して、やり直し・修正してください:\n${questions.map((q, i) => (replies[i]?.trim() ? `質問: ${q}\n答え: ${replies[i]!.trim()}` : "")).filter(Boolean).join("\n")}${attach}`)}>答えをもとに新しい依頼を書く</Button>
            <Button variant="ghost" onClick={() => setQuestions(null)}>質問をつくり直す</Button>
          </div>
        </div>
      )}
      <p className="mb-1 mt-3 text-[12px] font-semibold">自分で続きを頼む</p>
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        {FOLLOW_UPS.map((q) => <button key={q} type="button" className="rounded-full border border-border px-2.5 py-0.5 text-[11.5px] hover:bg-sidebar" onClick={() => setQuestion(q)}>{q}</button>)}
      </div>
      <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} maxLength={500} placeholder="例: 表にコストの列も足して" className="w-full rounded-lg border border-border bg-white p-2 text-[13px]" />
      <Button variant="ghost" disabled={!question.trim()} onClick={() => onNewRequest(`これまでの回答をもとに、次のことをお願いします:${question.trim()}${attach}`)}>この内容で新しい依頼を書く</Button>
    </div>
  );
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

/** A request as bullet points: one per numbered item "(1) ..." and per sentence, nothing cut. */
const toBullets = (text: string): string[] =>
  text
    .split(/(?=[(（]\d+[)）])/)
    .flatMap((part) => part.replace(/^[(（]\d+[)）]\s*/, "").split(/(?<=。)|\n/))
    .map((s) => s.trim().replace(/[。\s]+$/, ""))
    .filter(Boolean);

const VERDICT_TONE ={ verified: "ok", partial: "warn", unfinished: "bad" } as const;
const LEVEL_SHORT: Record<number, string> = { 1: "存在", 2: "構文", 3: "テスト", 4: "起動確認", 5: "別のAI", 6: "別のAI" };

/** What was done, how far it was actually checked, and what was not checked. */
function TodoCard({ todo, ctx, missionId, onNewRequest }: { todo: ReportTodo; ctx: Ctx; missionId: string; onNewRequest: (goal: string) => void }) {
  const { busy, run } = useAction(ctx.setError);
  const [copied, setCopied] = useState("");
  const projectId = ctx.project!.id;
  const act = (a: ReportAction) => {
    if (a.kind === "new_request") return onNewRequest(a.goal);
    if (a.kind === "retry") return void run(async () => { await api.retryTask(projectId, missionId, a.taskId); ctx.refresh(); });
    if (a.kind === "artifact") {
      const found = ctx.overview.artifacts.find((x) => x.path === a.path);
      if (found) ctx.openArtifact(found);
      else ctx.setError(`成果物「${a.path}」が見つかりません。「できたもの」のタブで探してください`);
      return;
    }
    if (a.kind === "copy") return void navigator.clipboard?.writeText(a.text).then(() => setCopied(a.text)).catch(() => undefined);
    const box = document.querySelector<HTMLDetailsElement>("#sync-card details");
    if (!box) return ctx.setError("このプロジェクトは、元のフォルダから取り込んだものではないので、反映の画面はありません");
    box.open = true;
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className={`rounded-md border px-3 py-2.5 ${todo.required ? "border-accent bg-white" : "border-borderSoft bg-white"}`}>
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone={todo.required ? "warn" : "neutral"}>{todo.required ? "やること" : "任意"}</Badge>
        <span className="font-semibold">{todo.title}</span>
      </p>
      <p className="mt-1 text-muted">{todo.why}</p>
      <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">{todo.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
      <div className="mt-2 flex flex-wrap gap-2">
        {todo.actions.map((a, i) => (
          <Button key={i} variant={i === todo.actions.length - 1 && todo.required ? "primary" : "ghost"} disabled={busy} onClick={() => act(a)}>{a.kind === "copy" && copied === a.text ? "コピーしました" : a.label}</Button>
        ))}
      </div>
    </div>
  );
}

const ACCEPT_LABEL = { met: "満たしている", partial: "一部だけ", unmet: "満たしていない", unknown: "判断できない" } as const;
const ACCEPT_TONE = { met: "ok", partial: "warn", unmet: "bad", unknown: "neutral" } as const;

/** "Did it give what I asked for?": the request taken apart into wishes, each marked with the evidence found. Made by itself when a request finishes. */
function AcceptancePanel({ ctx, projectId, missionId, status, onNewRequest }: { ctx: Ctx; projectId: string; missionId: string; status: string; onNewRequest: (goal: string) => void }) {
  const [acc, setAcc] = useState<Acceptance | null>(null);
  const [waited, setWaited] = useState(0);
  const { busy, run } = useAction(ctx.setError);
  useEffect(() => {
    let alive = true;
    setAcc(null);
    setWaited(0);
    api.acceptance(projectId, missionId).then((a) => alive && setAcc(a)).catch(() => undefined);
    return () => { alive = false; };
  }, [projectId, missionId, status]);
  // the server starts the check as soon as the request finishes (about a minute): look again a few times before offering the button
  useEffect(() => {
    if (acc || waited >= 6) return;
    const id = setTimeout(() => { api.acceptance(projectId, missionId).then((a) => (a ? setAcc(a) : setWaited((w) => w + 1))).catch(() => setWaited((w) => w + 1)); }, 15000);
    return () => clearTimeout(id);
  }, [acc, waited, projectId, missionId]);
  const check = () => run(async () => { setAcc(await api.runAcceptance(projectId, missionId)); });
  if (!acc) {
    return (
      <div className="mt-3 rounded-lg border border-borderSoft bg-bg px-3.5 py-3">
        <p className="text-[13px] font-semibold">依頼どおりにできたかのチェック</p>
        <p className="mb-2 text-[12px] text-muted">{waited < 6 ? "AIが、依頼の希望を1つずつ見て、満たしているか確かめています(1分ほど)。" : "まだチェックされていません。"}</p>
        <Button variant="ghost" disabled={busy} onClick={() => void check()}>{busy ? "チェック中…(1〜3分)" : "いまチェックする"}</Button>
      </div>
    );
  }
  const bad = acc.items.filter((i) => i.status === "unmet" || i.status === "partial");
  return (
    <div className="mt-3 rounded-lg border border-borderSoft bg-bg px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">依頼どおりにできたかのチェック</span>
        {acc.score !== null && <Badge tone={acc.score >= 85 ? "ok" : acc.score >= 50 ? "warn" : "bad"}>希望の達成度 {acc.score}%</Badge>}
        <Button variant="ghost" disabled={busy} onClick={() => void check()}>{busy ? "チェック中…" : "もう一度チェック"}</Button>
      </div>
      {acc.summary && <p className="mt-1 text-[13px]">{acc.summary}</p>}
      <ul className="mt-2 divide-y divide-borderSoft rounded-md border border-borderSoft bg-white">
        {acc.items.map((i, n) => (
          <li key={n} className="px-3 py-2 text-[12.5px] leading-relaxed">
            <div className="flex flex-wrap items-center gap-2"><Badge tone={ACCEPT_TONE[i.status]}>{ACCEPT_LABEL[i.status]}</Badge><span>{i.requirement}</span></div>
            {i.evidence && <p className="mt-0.5 text-muted">{i.evidence}</p>}
          </li>
        ))}
      </ul>
      {bad.length > 0 && (
        <Button variant="ghost" onClick={() => onNewRequest(`前回の依頼のうち、次の点が足りていません。直してください:\n${bad.map((i) => `- ${i.requirement}${i.fix ? `(${i.fix})` : ""}`).join("\n")}`)}>足りない点だけ、直してもらう</Button>
      )}
      <p className="mt-1.5 text-[11px] text-muted">これはAIの目で見た判定です。画面や動きは、ご自身でも一度ご確認ください。</p>
    </div>
  );
}

const EFFORT_LABEL = { small: "30分ほど", medium: "1〜2時間", large: "大きめ(最初の一歩から)" } as const;

/** "What should I ask for next?": a few proposed next requests, one marked as the recommendation. Made by itself after the check. */
function NextIdeasPanel({ ctx, projectId, missionId, status, onPick }: { ctx: Ctx; projectId: string; missionId: string; status: string; onPick: (request: string) => void }) {
  const [ideas, setIdeas] = useState<NextIdeas | null>(null);
  const [waited, setWaited] = useState(0);
  const { busy, run } = useAction(ctx.setError);
  useEffect(() => {
    let alive = true;
    setIdeas(null);
    setWaited(0);
    api.nextIdeas(projectId, missionId).then((a) => alive && setIdeas(a)).catch(() => undefined);
    return () => { alive = false; };
  }, [projectId, missionId, status]);
  // the server makes them right after the acceptance check (together about two to three minutes): look again before offering the button
  useEffect(() => {
    if (ideas || waited >= 16) return;
    const id = setTimeout(() => { api.nextIdeas(projectId, missionId).then((a) => (a ? setIdeas(a) : setWaited((w) => w + 1))).catch(() => setWaited((w) => w + 1)); }, 15000);
    return () => clearTimeout(id);
  }, [ideas, waited, projectId, missionId]);
  const make = () => run(async () => { setIdeas(await api.makeNextIdeas(projectId, missionId)); });
  if (!ideas) {
    return (
      <section className="rounded-xl border border-borderSoft bg-panel p-4" aria-label="おすすめの次の案件">
        <p className="text-[13px] font-semibold">おすすめの次の案件</p>
        <p className="mb-2 text-[12px] text-muted">{waited < 16 ? "AIが、次に頼むとよいことを考えています(2〜3分)。できると、ここに出ます。" : "まだ提案が作られていません。"}</p>
        <Button variant="ghost" disabled={busy} onClick={() => void make()}>{busy ? "考えています…(1〜3分)" : "いま考えてもらう"}</Button>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-borderSoft bg-panel p-4" aria-label="おすすめの次の案件">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">おすすめの次の案件</span>
        <Button variant="ghost" disabled={busy} onClick={() => void make()}>{busy ? "考え直しています…" : "考え直してもらう"}</Button>
      </div>
      <p className="mb-2 text-[12px] text-muted">いま終わったことの次に、頼むとよさそうなことです。選ぶと、依頼の文が入力欄に入ります(そのまま開始せず、読んで直せます)。</p>
      <ul className="space-y-2">
        {ideas.ideas.map((idea, n) => (
          <li key={n} className={`rounded-lg border px-3.5 py-3 ${idea.recommended ? "border-accent bg-[#FBF1EC]" : "border-borderSoft bg-white"}`}>
            <div className="flex flex-wrap items-center gap-2">
              {idea.recommended && <Badge tone="warn">おすすめ</Badge>}
              <span className="font-serif text-[15px] font-semibold">{idea.title}</span>
              <span className="text-[11.5px] text-muted">目安: {EFFORT_LABEL[idea.effort]}</span>
            </div>
            <p className="mt-1 text-[13px]">{idea.why}</p>
            <Details summary="依頼の文を見る"><p className="whitespace-pre-wrap text-[12.5px] text-[#4a473f]">{idea.request}</p></Details>
            <div className="mt-2"><Button variant={idea.recommended ? "primary" : "ghost"} onClick={() => onPick(idea.request)}>この案件の依頼を書く</Button></div>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-muted">AIが作った提案です。やりたいことと違うときは、下の入力欄に自由に書いて頼めます。</p>
    </section>
  );
}

function ReportPanel({ ctx, projectId, missionId, status, onNewRequest }: { ctx: Ctx; projectId: string; missionId: string; status: string; onNewRequest: (goal: string) => void }) {
  const [report, setReport] = useState<MissionReport | null>(null);
  const [open, setOpen] = useState<boolean | null>(null); // null = default: open unless everything was verified
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    api.missionReport(projectId, missionId).then((r) => alive && setReport(r)).catch(() => alive && setReport(null));
    return () => { alive = false; };
  }, [projectId, missionId, status]);
  if (!report) return null;
  const copy = () => { void navigator.clipboard?.writeText(report.markdown).then(() => setCopied(true)).catch(() => undefined); };
  const isOpen = open ?? report.verdict !== "verified";
  const done = report.tasks.filter((t) => t.status === "completed").length;
  const todos = report.todos ?? [];
  const must = todos.filter((t) => t.required);
  const maybe = todos.filter((t) => !t.required);
  // a request that stopped while it was still being planned has nothing to report: its reason is already shown above
  if (report.tasks.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-borderSoft bg-bg px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">完了検証レポート</span>
        <Badge tone={VERDICT_TONE[report.verdict]}>{report.verdictLabel}</Badge>
        <span className="text-[12px] text-muted">{report.tasks.length}件の作業のうち、{done}件が終わりました</span>
        <button className="ml-auto text-[12px] text-accent hover:underline" onClick={() => setOpen(!isOpen)}>{isOpen ? "閉じる" : "詳しく見る"}</button>
      </div>
      {report.todos && (
        <div className={`mt-2 rounded-md px-3 py-2 text-[13px] ${must.length ? "bg-[#FBF3E0] text-[#7A5410]" : "bg-[#E8F3EA] text-[#2F6B3C]"}`}>
          <b>{must.length ? `あなたがやることが ${must.length}件 あります` : "いまは、あなたがやることはありません"}</b>
          {!must.length && maybe.length > 0 && <span className="ml-2 text-[12px]">(やっておくと安心なことが{maybe.length}件あります。下の「任意」)</span>}
        </div>
      )}
      {isOpen && (
        <div className="mt-3 space-y-3.5 text-[12.5px] leading-relaxed">
          {todos.length > 0 && (
            <section className="space-y-2">
              <p className="font-semibold">{must.length ? "あなたがやること" : "やっておくと安心なこと(しなくても大丈夫です)"}</p>
              {[...must, ...maybe].map((t) => <TodoCard key={t.id} todo={t} ctx={ctx} missionId={missionId} onNewRequest={onNewRequest} />)}
            </section>
          )}
          <section>
            <p className="mb-1 font-semibold">やったこと</p>
            <ul className="divide-y divide-borderSoft rounded-md border border-borderSoft bg-white">
              {report.tasks.map((t, i) => {
                const ok = t.status === "completed";
                const check = t.inconclusive ? "答えが出ていない" : t.partly ? "一部未確認" : t.level ? (!t.isCode && t.level <= 2 ? "成果物あり" : t.level >= 5 ? "別のAIが確認" : `確認: ${LEVEL_SHORT[t.level] ?? `L${t.level}`}まで`) : "確認なし";
                return (
                  <li key={t.id} className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <span className={`mt-px ${ok ? "text-status-done" : "text-[#9B2C2C]"}`}>{ok ? "✓" : "✕"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-semibold">作業{i + 1}{t.role ? `:${roleLabel(t.role)}` : ""}</span>
                          <span className={`text-[11.5px] ${t.inconclusive || t.partly ? "font-semibold text-[#9B6A12]" : "text-muted"}`}>{check}</span>
                          {t.attempts > 1 && <span className="text-[11.5px] text-muted">{t.attempts}回実行</span>}
                        </p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-muted">
                          {toBullets(t.objective).map((b, j) => <li key={j}>{b}</li>)}
                        </ul>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="rounded-md bg-[#FBF3E0] px-3 py-2">
            <p className="mb-1 font-semibold text-[#7A5410]">AIが確認できていないこと(あなたの作業ではありません)</p>
            <ul className="list-disc space-y-0.5 pl-5 text-[#5A4A2A]">{report.notChecked.map((n) => <li key={n}>{n}</li>)}</ul>
          </section>
          {report.notes.length > 0 && (
            <section>
              <p className="mb-1 font-semibold">気をつけること</p>
              <ul className="list-disc space-y-0.5 pl-5 text-muted">{report.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </section>
          )}
          <Button variant="ghost" onClick={copy}>{copied ? "コピーしました" : "Markdownでコピー"}</Button>
        </div>
      )}
    </div>
  );
}

const CHANGE_LABEL = { added: "追加", modified: "変更", deleted: "削除" } as const;

/** What this task changed in the project folder, with a way to put those files back. */
function TaskChangesPanel({ task, ctx, canRollback }: { task: Task; ctx: Ctx; canRollback: boolean }) {
  const [changes, setChanges] = useState<TaskChanges | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const { busy, run } = useAction(ctx.setError);
  const projectId = ctx.project!.id;
  useEffect(() => {
    let alive = true;
    api.taskChanges(projectId, task.id).then((c) => alive && setChanges(c)).catch(() => alive && setChanges(null));
    return () => { alive = false; };
  }, [projectId, task.id, task.updatedAt]);
  if (!changes || changes.files.length === 0) return null;
  const rollback = () => {
    if (!window.confirm(`この作業が変えた${changes.files.length}個のファイルを、作業実行前の状態に戻します。後の作業がこれらのファイルを使っている場合、動かなくなることがあります。よろしいですか?`)) return;
    void run(async () => { await api.rollbackTask(projectId, task.id); ctx.refresh(); setChanges(await api.taskChanges(projectId, task.id)); });
  };
  return (
    <div className="ml-6 mt-1">
      <button className="text-[12px] text-accent hover:underline" onClick={() => setOpen(!open)}>{open ? "変更内容を閉じる" : `変更内容を見る(${changes.files.length}ファイル)`}</button>
      {open && (
        <div className="mt-1 rounded-lg bg-sidebar px-3 py-2">
          <ul className="text-[12px]">
            {changes.files.map((f) => <li key={f.path} className="font-mono"><span className="mr-2 text-muted">{CHANGE_LABEL[f.status]}</span>{f.path}</li>)}
          </ul>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-[#4a473f]">{changes.patch}{changes.truncated ? "\n…(長いため途中まで)" : ""}</pre>
          {canRollback && <div className="mt-2"><Button variant="ghost" disabled={busy} onClick={rollback}>この作業の変更を元に戻す</Button></div>}
        </div>
      )}
    </div>
  );
}

/** Change direction mid-run: stops the work, then a new plan is proposed that keeps what is already done. */
function RedirectControls({ mission, ctx }: { mission: { projectId: string; id: string }; ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { busy, run } = useAction(ctx.setError);
  const go = () => run(async () => { await api.missionAction(mission.projectId, mission.id, "redirect", text); setText(""); setOpen(false); ctx.refresh(); });
  if (!open) return <Button variant="ghost" onClick={() => setOpen(true)}>途中で依頼を変える</Button>;
  return (
    <div className="w-full">
      <SayItHelper kind="change" value={text} onChange={setText} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="例: 検索機能を先に作って、画像アップロードは後回しにしてください" className="w-full rounded-lg border border-border bg-bg p-2 text-[13px] outline-none focus:border-accent" />
      <p className="mt-1 text-[12px] text-muted">実行中の作業はここで止まります。完了済みの作業は残したまま新しい計画を提案するので、内容を確認して承認してください(承認するまで、止まった作業は置き換わりません)。</p>
      <div className="mt-1 flex gap-2">
        <Button disabled={busy || !text.trim()} onClick={go}>止めて新しい計画を作る</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>閉じる</Button>
      </div>
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
        <Button variant="ghost" disabled={busy} onClick={go}>この作業をやり直す</Button>
        {!open && <Button variant="ghost" disabled={busy} onClick={() => setOpen(true)}>注文をつけてやり直す(任意)</Button>}
      </div>
      {open && (
        <div className="mt-2">
          <p className="mb-1 text-[12px] text-muted">AIが作った内容に付け足すのではなく、やり直すAIへの「注文」を書く欄です。変えたい点がなければ、何も書かずに「この作業をやり直す」を押してください。</p>
          <SayItHelper kind="retry" value={text} onChange={setText} />
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
  const desktop = preview?.kind === "desktop";
  return (
    <Card fold title="動かして確認する(作りかけの画面を実際に試す)">
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
      {preview?.message && (state !== "running" || desktop) && <p className="mt-2 text-[13px]">{preview.message}</p>}
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
      <p className="mt-2 text-[11.5px] text-muted">作りかけの状態のまま、あなたのPC上でだけ動かします(生成されたコードをそのまま実行します)。依頼が作業中のファイルを読むため、動きが不安定なことがあります。デスクトップアプリは、作業中のフォルダをコピーしてビルドし、別のウィンドウで開きます(止めるときは「停止」か、アプリのウィンドウを閉じます)。</p>
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
      <p className="mt-1 text-[12px] text-muted">許可しても、この作業の間だけ有効です。他の作業には広がりません。拒否するとこの作業は失敗として止まります。押すまで、この作業は止まったまま待ちます(自動では拒否しません)。</p>
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
  if (!proposal) return <Card title="計画">AI が計画を作成中です…(新しいアイデアは 1〜2 分、大きな既存プロジェクトは 10 分以上かかることがあります。できあがると、この画面が自動で切り替わります)</Card>;
  const act = (action: "approve" | "reject") =>
    run(async () => {
      if (action === "approve") await api.approveAndRun(mission.projectId, mission.id);
      else await api.missionAction(mission.projectId, mission.id, "reject", feedback);
      setFeedback("");
      ctx.refresh();
    });
  return (
    <Card title={proposal.kind === "replan" ? "再計画の提案" : "計画の提案"}>
      {proposal.draft.summary && <p className="mb-3 text-[15px] leading-relaxed">{proposal.draft.summary}</p>}
      <p className="mb-2 text-[13px] text-muted">作業は全部で{proposal.draft.tasks.length}つです。上から順に進みます。細かい内容は、各作業の「詳しく見る」で読めます。</p>
      <ol className="mb-3 space-y-2">
        {proposal.draft.tasks.map((t, i) => {
          const { head, long } = shortGoal(t.objective);
          const after = t.dependsOn.map((k) => proposal.draft.tasks.findIndex((x) => x.key === k) + 1).filter((n) => n > 0);
          return (
            <li key={t.key} className="rounded-lg border border-borderSoft bg-white px-3 py-2">
              <p className="text-[14.5px] leading-relaxed">
                <span className="mr-2 font-semibold text-muted">{i + 1}.</span>
                <span className="mr-2 rounded bg-bg px-1.5 py-0.5 text-[12.5px] font-semibold">{roleLabel(t.role)}</span>
                <span>{head}</span>
              </p>
              {(long || t.expectedOutputs.length > 0 || after.length > 0) && (
                <details className="mt-1 text-[13px]">
                  <summary className="cursor-pointer select-text text-muted">詳しく見る</summary>
                  <div className="mt-1.5 space-y-1.5 leading-relaxed">
                    {long && <p className="whitespace-pre-wrap">{t.objective}</p>}
                    {after.length > 0 && <p className="text-muted">先に終わらせる作業: {after.map((n) => `作業${n}`).join("、")}</p>}
                    {t.expectedOutputs.length > 0 && <p className="break-all text-muted">できるもの: {t.expectedOutputs.join(" / ")}</p>}
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mb-1 text-[13px] font-semibold">この計画で合っていますか?</p>
      <SayItHelper kind="plan" value={feedback} onChange={setFeedback} />
      <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} placeholder="直してほしい点があれば入力(例: テストを厚く)。合っていれば、何も書かずに「この計画で開始」を押してください" className="mb-2 w-full rounded-lg border border-border bg-bg p-2.5 text-[13px] outline-none focus:border-accent" />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => act("approve")}>この計画で開始</Button>
        <Button variant="ghost" disabled={busy || !feedback.trim()} onClick={() => act("reject")}>{busy ? "作り直し中…(1〜2分)" : "修正して再提案"}</Button>
      </div>
    </Card>
  );
}

function Intake({ ctx, onStarted, initialGoal = "" }: { ctx: Ctx; onStarted: () => void; initialGoal?: string }) {
  const [goal, setGoal] = useState(initialGoal);
  const [constraints, setConstraints] = useState("");
  const [tech, setTech] = useState("");
  const { busy, run } = useAction(ctx.setError);
  const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Before planning, a vague request gets a few questions (once); the answers are written into the request so the plan starts from them.
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [replies, setReplies] = useState<string[]>([]);
  const create = (text: string) =>
    run(async () => {
      const project = await ctx.ensureProject(deriveProjectName(text));
      await api.createMission(project.id, text.trim(), lines(constraints), tech.split(/[,、\n]/).map((s) => s.trim()).filter(Boolean));
      setGoal("");
      setQuestions(null);
      onStarted();
    });
  const withAnswers = () => {
    const qa = (questions ?? []).map((q, i) => (replies[i]?.trim() ? `- ${q} → ${replies[i]!.trim()}` : "")).filter(Boolean);
    return qa.length ? `${goal.trim()}\n\n【確認して決まったこと】\n${qa.join("\n")}` : goal;
  };
  const start = () =>
    run(async () => {
      // the AI itself judges whether the request is concrete enough (it answers with no questions when it is), whatever its length
      const q = await api.clarifyRequest(goal.trim()).catch(() => [] as string[]); // asking is a help: if it fails, just go on
      if (q.length) { setQuestions(q); setReplies(q.map(() => "")); return; }
      await create(goal);
    });
  return (
    <Card>
      <label htmlFor="goal" className="mb-2 block font-serif text-[18px] font-semibold">何を作りますか?</label>
      <SayItHelper kind="first" value={goal} onChange={setGoal} />
      <textarea id="goal" value={goal} onChange={(e) => { setGoal(e.target.value); setQuestions(null); }} rows={3} maxLength={4000} placeholder="例: 商品管理ができるシンプルなWebアプリを作って" className="w-full rounded-lg border border-border bg-bg p-3 text-[14px] outline-none focus:border-accent" />
      <div className="mt-3">
        <Details summary="詳細設定(任意)">
          <label className="mb-1 block text-[12px] text-muted">守ってほしい条件(1行に1つ)</label>
          <textarea value={constraints} onChange={(e) => setConstraints(e.target.value)} rows={2} className="mb-2 w-full rounded-lg border border-border bg-panel p-2 text-[13px]" />
          <label className="mb-1 block text-[12px] text-muted">使いたい技術(カンマ区切り)</label>
          <input value={tech} onChange={(e) => setTech(e.target.value)} className="w-full rounded-lg border border-border bg-panel p-2 text-[13px]" />
        </Details>
      </div>
      {questions ? (
        <div className="mt-3 rounded-lg border border-borderSoft bg-bg px-3.5 py-3">
          <p className="text-[13px] font-semibold">作り始める前に、いくつか確認させてください</p>
          <p className="mb-2 text-[12px] text-muted">答えたいものだけ書いてください(空欄は、AIにおまかせになります)。答えは依頼に書き足されます。</p>
          <div className="space-y-2">
            {questions.map((q, i) => (
              <div key={i}>
                <p className="text-[13px]">{i + 1}. {q}</p>
                <input value={replies[i] ?? ""} onChange={(e) => setReplies(replies.map((r, j) => (j === i ? e.target.value : r)))} maxLength={200} className="mt-0.5 w-full rounded-lg border border-border bg-white p-1.5 text-[13px]" />
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void create(withAnswers())}>{busy ? "計画を作成中…(数十秒かかります)" : "この答えで開発を開始"}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => void create(goal)}>確認せず、このまま開始</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button disabled={busy || !goal.trim()} onClick={start}>{busy ? "依頼を確認中…(数十秒かかります)" : "開発を開始"}</Button>
        </div>
      )}
    </Card>
  );
}

const FINISHED = ["completed", "failed", "cancelled"];

export function MissionScreen({ ctx }: { ctx: Ctx }) {
  const { mission, overview, services, handoffs, approvals, project } = ctx;
  const [view, setView] = useState<MissionView | null>(null);
  const { busy, run } = useAction(ctx.setError);
  const [starting, setStarting] = useState(false);
  const [draftGoal, setDraftGoal] = useState(""); // a to-do in the report can open the request form with the words already written
  const writeRequest = (text: string) => { setDraftGoal(text); setStarting(true); setTimeout(() => document.getElementById("goal")?.scrollIntoView({ behavior: "smooth", block: "center" }), 80); };

  // The proposal is not part of /overview, and it arrives after the mission already says "planning" (without any change to the
  // mission itself), so keep asking for the full view while a plan awaits approval. `view` is only used while it matches the
  // current planning mission, so it never needs clearing.
  usePoll(async () => {
    if (!mission || mission.status !== "planning") return;
    const v = await api.missionView(mission.projectId, mission.id);
    setView((prev) => (prev && JSON.stringify(prev) === JSON.stringify(v) ? prev : v));
  }, 2500, [mission?.id, mission?.status]);

  const tasks = mission ? overview.tasks.filter((t) => t.missionId === mission.id).sort((a, b) => a.position - b.position) : [];
  // A draft without a plan (e.g. migrated from the old app) can never run: let the user start a fresh mission right away.
  const emptyDraft = mission?.status === "draft" && tasks.length === 0;
  const showIntake = starting || !mission || FINISHED.includes(mission.status) || emptyDraft;
  const { done, total, percent } = progressOf(tasks);
  const usage = summarizeUsage(overview.aiRuns, new Set(tasks.map((t) => t.id)));
  const doing = tasks.find((t) => t.status === "running" || t.status === "validation" || t.status === "waiting");
  const myHandoffs = handoffs.filter((h) => h.projectId === project?.id);
  const recent = [...overview.artifacts].filter((a) => !/(^|\/)(bin|obj|node_modules|publish|dist)\//i.test(a.path)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const act = (action: "pause" | "cancel" | "resume" | "run" | "replan") =>
    run(async () => {
      if (!mission) return;
      await api.missionAction(mission.projectId, mission.id, action);
      ctx.refresh();
    });

  const pendingPlan = mission?.status === "planning" && view?.mission.id === mission.id;
  const [resting, setResting] = useState(false);
  usePoll(async () => setResting(((await api.allResting().catch(() => ({ state: null }))).state?.tasks ?? 0) > 0), 15000, []);
  const step = nextStep(ctx, tasks, () => setStarting(true), mission?.status !== "planning" || (pendingPlan && !!view?.proposal), resting);

  return (
    <div className="space-y-4">
      <ClaudeCheck />
      {ctx.projectCount === 0 && !mission ? (
        <Welcome onHelp={ctx.openHelp} onImport={() => window.dispatchEvent(new Event("open-import"))} />
      ) : (
        <NextStepBanner step={step} />
      )}
      {mission?.status === "completed" && !starting && !approvals.some((a) => a.projectId === project?.id) && <NextIdeasPanel ctx={ctx} projectId={mission.projectId} missionId={mission.id} status={`${mission.status}:${mission.updatedAt}`} onPick={writeRequest} />}

      {/* wide screens: the work flow on the left, preview / sync / recent files beside it */}
      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] min-[900px]:items-start">
      <div className="min-w-0 space-y-4">
      {/* things that wait for the person come first */}
      {pendingPlan && <PlanReview view={view} ctx={ctx} />}
      {approvals.filter((a) => a.projectId === project?.id).map((a) => <ApprovalCard key={a.id} approval={a} ctx={ctx} />)}
      {myHandoffs.map((h) => <HandoffCard key={h.id} handoff={h} ctx={ctx} />)}
      {project && <DepsCard ctx={ctx} />}

      {mission && !starting && (
        <Card>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold tracking-wide text-muted">{project?.name ?? "プロジェクト"}</span>
            <Badge tone={mission.status === "completed" ? "ok" : mission.status === "failed" ? "bad" : mission.status === "running" ? "info" : "neutral"}>{MISSION_LABEL[mission.status]}</Badge>
          </div>
          <GoalText goal={mission.goal} className="font-serif text-[18px] font-semibold" />
          {total > 0 && (
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-sidebar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-accent transition-all" style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-1 text-[12px] text-muted">{percent}%({done}/{total})</p>
            </div>
          )}
          {total > 0 && <p className="mt-3 text-[13px]">{summaryLine(tasks, ctx, resting)}</p>}
          <FailureReason projectId={mission.projectId} missionId={mission.id} failed={mission.status === "failed"} className="mt-3" />
          {mission.status === "completed" && <AcceptancePanel ctx={ctx} onNewRequest={writeRequest} projectId={mission.projectId} missionId={mission.id} status={`${mission.status}:${mission.updatedAt}`} />}
          {["completed", "failed"].includes(mission.status) && <ReportPanel ctx={ctx} onNewRequest={writeRequest} projectId={mission.projectId} missionId={mission.id} status={`${mission.status}:${mission.updatedAt}`} />}
          {usage.runs > 0 && (
            <p className="mt-2 text-[12px] text-muted">
              AIの作業時間 {formatDuration(usage.durationMs)} · 実行{usage.runs}回{usage.failedRuns > 0 && `(うち失敗${usage.failedRuns}回)`}
              {usage.hasCost && <> · 使用量(API換算) {formatCost(usage.costUsd)}</>}
              {usage.inputTokens + usage.outputTokens > 0 && <> · トークン 入力{formatTokens(usage.inputTokens)} / 出力{formatTokens(usage.outputTokens)}</>}
            </p>
          )}
          {doing && (
            <p className="mt-3 text-[13px]"><span className="text-muted">現在: </span>{resting && doing.status === "running" ? `${roleLabel(doing.role)}は、使えるAIが戻るのを待っています` : <>{aiNameOf(services, doing.selectedAi)} が{roleLabel(doing.role)}{doing.status === "waiting" ? "の回答待ち" : "中"}</>}</p>
          )}
          {tasks.length > 0 && (
            <ul className="mt-3 space-y-1">
              {tasks.map((t) => (
                <li key={t.id} className={`text-[13px] ${t.status === "pending" || t.status === "cancelled" ? "text-muted" : ""}`}>
                  <div className="flex items-start gap-2">
                    <StepMark status={t.status} />
                    <span className="min-w-0 flex-1"><span className="text-muted">{roleLabel(t.role)} / </span><TaskObjective text={t.objective} /></span>
                    {(t.status === "failed" || t.status === "blocked") && <Badge tone="bad">{TASK_LABEL[t.status]}</Badge>}
                    {t.status === "waiting" && <Badge tone="warn">{TASK_LABEL[t.status]}</Badge>}
                    {["completed", "failed"].includes(t.status) && taskTime(overview.aiRuns, t.id) && <span className="shrink-0 text-[11.5px] text-muted">{taskTime(overview.aiRuns, t.id)}</span>}
                    {(t.status === "running" || t.status === "validation") && <span className="shrink-0 text-muted">{TASK_LABEL[t.status]} {elapsedSince(t.updatedAt)}</span>}
                  </div>
                  {overview.taskNotes?.[t.id] && <p className="ml-6 text-[12px] text-[#9B2C2C]">{overview.taskNotes[t.id]}</p>}
                  {(t.status === "running" || t.status === "validation") && <LiveLog projectId={ctx.project!.id} taskId={t.id} />}
                  {t.status === "completed" && <TaskAnswer taskId={t.id} ctx={ctx} />}
                  {["completed", "failed"].includes(t.status) && <TaskChangesPanel task={t} ctx={ctx} canRollback={mission.status !== "running"} />}
                  {t.status === "failed" && !["completed", "cancelled", "planning"].includes(mission.status) && <RetryControls task={t} ctx={ctx} />}
                </li>
              ))}
            </ul>
          )}
          {["completed", "failed"].includes(mission.status) && <MissionFollowUp ctx={ctx} tasks={tasks} onNewRequest={writeRequest} />}
          {tasks.length === 0 && mission.status === "draft" && (
            <p className="mt-3 text-[12.5px] text-muted">この依頼にはまだ計画がありません。下のフォームから新しい依頼を始められます(この依頼は不要なら「中止」してください)。</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {mission.status === "running" && <Button variant="ghost" disabled={busy} onClick={() => act("pause")}>一時停止</Button>}
            {mission.status === "paused" && <Button disabled={busy} onClick={() => act("resume")}>再開</Button>}
            {mission.status === "failed" && <Button disabled={busy} onClick={() => act("replan")}>計画をやり直す</Button>}
            {["running", "paused", "failed"].includes(mission.status) && <RedirectControls mission={mission} ctx={ctx} />}
            {["draft", "planning", "running", "paused"].includes(mission.status) && <Button variant="danger" disabled={busy} onClick={() => act("cancel")}>中止</Button>}
            {FINISHED.includes(mission.status) && <Button variant="ghost" onClick={() => setStarting(true)}>新しい依頼</Button>}
          </div>
        </Card>
      )}

      {showIntake && (
        <>
          {starting && <div><Button variant="ghost" onClick={() => setStarting(false)}>← 現在の依頼に戻る</Button></div>}
          <Intake key={draftGoal} ctx={ctx} initialGoal={draftGoal} onStarted={() => { setDraftGoal(""); setStarting(false); ctx.refresh(); }} />
        </>
      )}

      </div>
      <div className="min-w-0 space-y-4">
      {project && overview.artifacts.length > 0 && <PreviewCard ctx={ctx} />}
      {project && overview.artifacts.length > 0 && <SplitPreview ctx={ctx} />}
      {project && <SyncCard ctx={ctx} />}

      {recent.length > 0 && (
        <Card title="最近できたもの">
          <ul className="space-y-1">
            {recent.map((a) => (
              <li key={a.id}>
                <button onClick={() => ctx.openArtifact(a)} className="break-all text-left text-[13px] text-accent hover:underline">{a.path}</button>
                <span className="ml-2 text-[11px] text-muted">{formatTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      </div>
      </div>
    </div>
  );
}
