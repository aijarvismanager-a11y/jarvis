import { useEffect, useState } from "react";
import { api } from "../api";
import type { Ctx } from "../context";
import { useAction, usePoll } from "../hooks";
import { aiStepState, delegableSteps, delegateGoal, humanOnlyKind, nextOpenStep, shownTicks, stepHeadline } from "../humanTodoView";
import type { HumanTodoView } from "../types";
import { Badge, Button } from "../ui";

/** The things only the person can do, polled for the project. `reload` re-reads them (after "やりました"). */
export function useHumanTodos(projectId: string | undefined): { todos: HumanTodoView[]; reload: () => Promise<void> } {
  const [todos, setTodos] = useState<HumanTodoView[]>([]);
  const reload = async () => setTodos(projectId ? await api.humanTodos(projectId).catch(() => []) : []);
  usePoll(reload, 20_000, [projectId]);
  return { todos, reload };
}

const key = (id: string) => `humanTodoTicks:${id}`;
function loadTicks(id: string): boolean[] {
  try { const v = JSON.parse(localStorage.getItem(key(id)) ?? "[]"); return Array.isArray(v) ? v.map(Boolean) : []; } catch { return []; }
}

function TodoBlock({ todo, projectId, ctx, reload, primary }: { todo: HumanTodoView; projectId: string; ctx: Ctx; reload: () => Promise<void>; primary: boolean }) {
  const [ticks, setTicks] = useState<boolean[]>(() => loadTicks(todo.id));
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState("");
  const { busy, run } = useAction(ctx.setError);
  useEffect(() => { try { localStorage.setItem(key(todo.id), JSON.stringify(ticks)); } catch { /* the ticks are a convenience only */ } }, [ticks, todo.id]);
  const shown = shownTicks(todo, ticks); // the person's ticks plus the steps the AI is doing or has done
  const next = nextOpenStep(shown, todo.steps.length);
  const kind = humanOnlyKind(todo);
  // a todo that is person-only as a whole can still have steps the AI could do first (a build, a command): offer those alone
  const aiSteps = kind.onlyHuman ? delegableSteps(todo, shown) : [];
  const doneCount = todo.steps.filter((_, i) => shown[i]).length;
  const failed = todo.delegation?.state === "failed";
  return (
    <div className={primary ? "" : "border-t border-borderSoft pt-3"}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className={primary ? "font-serif text-[18px] font-semibold" : "text-[14px] font-semibold"}>{todo.title}</span>
        {todo.source === "legacy" && <Badge tone="warn">古い記録から拾いました</Badge>}
        <span className="ml-auto text-[12px] text-muted">{doneCount}/{todo.steps.length} できた</span>
      </div>
      {failed && (
        <p className="mb-2 rounded-lg border border-border bg-bg px-3 py-2 text-[12.5px] font-semibold text-accent" role="alert">
          AIに任せましたが、完了しませんでした(依頼が失敗したか、中止されました)。手順は人が行うか、もう一度「AIに任せる」を押してください。
        </p>
      )}
      <p className="mb-2 text-[12.5px] text-muted">{kind.onlyHuman ? kind.label : todo.why ? `${todo.why} ／ ${kind.label}` : kind.label}</p>
      <ol className="mb-3 space-y-1.5">
        {todo.steps.map((s, i) => {
          const isNext = i === next;
          const isOpen = open === i;
          return (
            <li key={i} className={`rounded-lg border px-3 py-2 ${isNext ? "border-accent bg-white" : "border-borderSoft bg-bg"} ${shown[i] ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-[#B5563A]"
                  checked={shown[i]}
                  disabled={aiStepState(todo, i) === "active" || aiStepState(todo, i) === "completed"}
                  aria-label={`${i + 1}番めをやった`}
                  onChange={(e) => setTicks((prev) => { const n = todo.steps.map((_, j) => !!prev[j]); n[i] = e.target.checked; return n; })}
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-[14px] leading-snug ${shown[i] ? "line-through" : isNext ? "font-semibold" : ""}`}>
                    <span className="mr-1.5 text-muted">{i + 1}.</span>{stepHeadline(s)}
                    {isNext && <span className="ml-2 rounded bg-accent px-1.5 py-px text-[11px] font-semibold text-white">いまここ</span>}
                    {aiStepState(todo, i) === "active" && <span className="ml-2 rounded border border-border px-1.5 py-px text-[11px] text-muted">AIが作業中</span>}
                    {aiStepState(todo, i) === "completed" && <span className="ml-2 rounded border border-border px-1.5 py-px text-[11px] text-muted">AIが済ませました</span>}
                    {aiSteps.includes(i) &&<span className="ml-2 rounded border border-border px-1.5 py-px text-[11px] text-muted">AIにできそう</span>}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {s.command && (
                      <Button variant="ghost" className="!px-2.5 !py-1 !text-[12px]" onClick={() => void navigator.clipboard?.writeText(s.command!).then(() => setCopied(`${todo.id}:${i}`)).catch(() => undefined)}>
                        {copied === `${todo.id}:${i}` ? "コピーしました" : "コマンドをコピー"}
                      </Button>
                    )}
                    {s.text.replace(/`/g, "").length > stepHeadline(s).length + 2 && (
                      <button type="button" className="text-[12px] text-accent hover:underline" onClick={() => setOpen(isOpen ? null : i)}>{isOpen ? "閉じる" : "くわしく"}</button>
                    )}
                  </div>
                  {isOpen && <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{s.text.replace(/`/g, "")}</p>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {!kind.onlyHuman && (
          <Button disabled={busy} onClick={() => run(async () => {
            const m = await api.createMission(projectId, delegateGoal(todo), [], []);
            await api.humanTodoDelegate(projectId, todo.id, m.mission.id, null); // the card goes while the AI works; it comes back if the request fails
            await reload();
            ctx.refresh();
          })}>AIに任せる</Button>
        )}
        {aiSteps.length > 0 && (
          <Button variant="ghost" disabled={busy} onClick={() => run(async () => {
            const m = await api.createMission(projectId, delegateGoal(todo, aiSteps), [], []);
            await api.humanTodoDelegate(projectId, todo.id, m.mission.id, aiSteps);
            await reload();
            ctx.refresh();
          })}>{`AIにできそうな手順だけ任せる(${aiSteps.length}件)`}</Button>
        )}
        <Button variant={kind.onlyHuman ? undefined : "ghost"} disabled={busy} onClick={() => run(async () => { await api.humanTodoDone(projectId, todo.id); try { localStorage.removeItem(key(todo.id)); } catch { /* ignore */ } await reload(); })}>
          {next === null ? "全部やりました(この案内を消す)" : "やりました(この案内を消す)"}
        </Button>
        <span className="text-[12px] text-muted">不要な案内も、「やりました」で消せます。書かれている場所: {todo.sourceFile}</span>
      </div>
    </div>
  );
}

/** "いまやること": the first thing is open with a checklist; the others are folded under it. */
export function HumanTodoCard({ ctx, todos, reload }: { ctx: Ctx; todos: HumanTodoView[]; reload: () => Promise<void> }) {
  const projectId = ctx.project?.id;
  if (!projectId || todos.length === 0) return null;
  const [first, ...rest] = todos;
  return (
    <section className="rounded-xl border border-border bg-panel px-4 py-3.5" aria-label="いまやること">
      <p className="mb-2 text-[11px] font-semibold tracking-wide text-accent">いまやること(あなたの操作が必要)</p>
      <TodoBlock todo={first} projectId={projectId} ctx={ctx} reload={reload} primary />
      {rest.length > 0 && (
        <details className="mt-3 border-t border-borderSoft pt-2">
          <summary className="cursor-pointer text-[13px] text-muted">ほかのやること({rest.length}件)</summary>
          <div className="mt-2 space-y-3">{rest.map((t) => <TodoBlock key={t.id} todo={t} projectId={projectId} ctx={ctx} reload={reload} primary={false} />)}</div>
        </details>
      )}
    </section>
  );
}
