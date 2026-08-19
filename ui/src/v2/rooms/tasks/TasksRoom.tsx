import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { Icon } from "../../ui";
import { Tabs, StatusChip, FilterChip, Select, EmptyState, Toast, DeepLink, Skeleton, type Tone } from "../../ui/roomkit";
import { RoomShell } from "../RoomShell";
import { openRoom } from "../../router";
import { useRoomActions } from "../useRoomActionBus";
import { parseRelativeDate } from "../../../../../src/voice/parse-date";
import { useTasksData, type Task, type TaskPriority, type TaskStatus } from "./useTasksData";
import "./TasksRoom.css";

const TASK_STATUSES: TaskStatus[] = ["pending", "active", "completed", "failed", "escalated"];
const TASK_PRIORITIES: TaskPriority[] = ["low", "normal", "high", "critical"];
const STATUS_LABEL: Record<TaskStatus, string> = { pending: "保留中", active: "実行中", completed: "完了", failed: "失敗", escalated: "エスカレーション" };

// Status remap (tasks §02): active→blue (running), escalated→amber (waits on
// you), pending neutral, completed green, failed red.
const STATUS_TONE: Record<TaskStatus, Tone> = { pending: "mut", active: "run", completed: "ok", failed: "fail", escalated: "hold" };
// Priority remap: low+normal neutral (green = succeeded, not low), high amber, critical red.
const PRIORITY_TONE: Record<TaskPriority, Tone> = { low: "mut", normal: "mut", high: "hold", critical: "fail" };
const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const TONE_HUE: Record<Tone, string> = { run: "var(--speak)", ok: "var(--ok)", hold: "var(--hold)", fail: "var(--listen)", mut: "var(--faint)" };

export type RoomBodyMode = "inline" | "expanded";

export function TasksRoomBody({ mode }: { mode: RoomBodyMode }) {
  const data = useTasksData();
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "all">("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);

  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(null), 4000); return () => window.clearTimeout(id); }, [toast]);
  const toastFrom = (r: { ok: boolean; message: string }) => setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });

  const assignees = useMemo(() => [...new Set(data.tasks.map((t) => t.assigned_to).filter(Boolean) as string[])], [data.tasks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.tasks.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (assigneeFilter !== "all" && (t.assigned_to ?? "") !== assigneeFilter) return false;
      if (q && !(t.what.toLowerCase().includes(q) || (t.context ?? "").toLowerCase().includes(q) || (t.assigned_to ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data.tasks, search, statusFilter, priorityFilter, assigneeFilter]);

  const byStatus = useMemo(() => {
    const m = new Map<TaskStatus, Task[]>();
    for (const s of TASK_STATUSES) m.set(s, []);
    for (const t of filtered) m.get(t.status)?.push(t);
    return m;
  }, [filtered]);

  const listItems = useMemo(() => [...filtered].sort((a, b) => {
    const dp = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]; if (dp) return dp;
    const da = a.when_due ?? Infinity, db = b.when_due ?? Infinity; if (da !== db) return da - db;
    return a.created_at - b.created_at;
  }), [filtered]);

  const selected = useMemo(() => data.tasks.find((t) => t.id === selectedId) ?? null, [data.tasks, selectedId]);

  // Columns: pending/active/completed always; failed/escalated only when occupied.
  const columns = TASK_STATUSES.filter((s) => s === "pending" || s === "active" || s === "completed" || (byStatus.get(s)?.length ?? 0) > 0);

  useRoomActions("tasks", (action, args) => {
    switch (action) {
      case "switch_view": { const v = String(args.view); if (v === "kanban" || v === "list") { setView(v); return true; } return false; }
      case "search": setSearch(typeof args.query === "string" ? args.query : ""); return true;
      case "set_filter": {
        const f = String(args.field), v = String(args.value);
        if (f === "status") { if (v === "all" || TASK_STATUSES.includes(v as TaskStatus)) { setStatusFilter(v as TaskStatus | "all"); return true; } }
        if (f === "priority") { if (v === "all" || TASK_PRIORITIES.includes(v as TaskPriority)) { setPriorityFilter(v as TaskPriority | "all"); return true; } }
        if (f === "assigned_to") { setAssigneeFilter(v); return true; }
        return false;
      }
      case "select": { const t = data.findByName(typeof args.name === "string" ? args.name : ""); if (!t) return false; setSelectedId(t.id); return true; }
      case "create_task": {
        const title = typeof args.title === "string" ? args.title.trim() : ""; if (!title) return false;
        const parsed = typeof args.when === "string" ? parseRelativeDate(args.when) : null;
        (async () => { const r = await data.createTask({ what: title, when_due: parsed?.ts, priority: (args.priority as TaskPriority) ?? undefined, assigned_to: typeof args.assigned_to === "string" ? args.assigned_to : undefined }); setToast({ text: r.ok ? `Created task "${title}".` : r.message, tone: r.ok ? "ok" : "warn" }); })();
        return true;
      }
      case "complete_task": { const t = data.findByName(typeof args.name === "string" ? args.name : ""); if (!t) return false; (async () => toastFrom(await data.updateStatus(t.id, "completed")))(); return true; }
      case "update_priority": { const t = data.findByName(typeof args.name === "string" ? args.name : ""); if (!t) return false; (async () => toastFrom(await data.updatePriority(t.id, args.level as TaskPriority)))(); return true; }
      case "reassign": { const t = data.findByName(typeof args.name === "string" ? args.name : ""); if (!t) return false; (async () => toastFrom(await data.reassign(t.id, (args.agent as string) ?? null)))(); return true; }
      default: return false;
    }
  });

  const complete = async (id: string) => toastFrom(await data.updateStatus(id, "completed"));
  const fail = async (id: string) => toastFrom(await data.updateStatus(id, "failed"));
  const kanban = view === "kanban" || mode === "inline";

  return (
    <div className="rk-tasks">
      <div className="rk-tasks__tool">
        <span className="rk-tasks__title">タスク</span>
        {mode === "expanded" && <Tabs tabs={[{ key: "kanban", label: "ボード" }, { key: "list", label: "リスト" }]} active={view} onChange={(k) => setView(k as "kanban" | "list")} />}
        <div className="rk-tasks__search"><Icon icon={Search} size="sm" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="タスクを検索…" aria-label="タスクを検索" /></div>
        <button className="rk-tasks__icbtn" onClick={data.refresh} aria-label="更新"><Icon icon={RefreshCw} size="sm" /></button>
        <button className="rk-tasks__new" onClick={() => setCreateOpen(true)}>新規タスク</button>
      </div>

      <div className="rk-tasks__stats">
        <Stat k="実行中" n={data.stats.active} />
        <Stat k="今日完了" n={data.stats.completedToday} />
        <Stat k="期限超過" n={data.stats.overdue} amber={data.stats.overdue > 0} />
        <Stat k="合計" n={data.stats.total} />
      </div>

      <div className="rk-tasks__fbar">
        <span className="rk-tasks__flabel">ステータス</span>
        <FilterChip on={statusFilter === "all"} onClick={() => setStatusFilter("all")}>すべて</FilterChip>
        {TASK_STATUSES.map((s) => <FilterChip key={s} on={statusFilter === s} onClick={() => setStatusFilter(s)}>{s}</FilterChip>)}
        <span className="rk-tasks__flabel" style={{ marginLeft: 8 }}>優先度</span>
        <FilterChip on={priorityFilter === "all"} onClick={() => setPriorityFilter("all")}>すべて</FilterChip>
        {TASK_PRIORITIES.map((p) => <FilterChip key={p} on={priorityFilter === p} onClick={() => setPriorityFilter(p)}>{p}</FilterChip>)}
        {assignees.length > 1 && (
          <div style={{ marginLeft: "auto" }}>
            <Select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
              <option value="all">すべての担当者</option>
              {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </div>
        )}
      </div>

      <div className="rk-tasks__body">
        {data.error ? (
          <div className="rk-tasks__msg">{data.error}</div>
        ) : data.loading && data.tasks.length === 0 ? (
          <div className="rk-tasks__empty"><Skeleton lines={6} /></div>
        ) : kanban ? (
          <div className="rk-tasks__board">
            {columns.map((status) => {
              const items = byStatus.get(status) ?? [];
              return (
                <div className={`rk-tasks__col rk-tasks__col--${status}`} key={status}>
                  <div className="rk-tasks__colh">{status}<span className="c">{items.length}</span></div>
                  <div className="rk-tasks__col-scroll">
                    {items.length === 0 ? <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)", padding: "8px 11px" }}>—</div>
                      : items.map((t) => <TaskCard key={t.id} task={t} selected={selectedId === t.id} onClick={() => setSelectedId(selectedId === t.id ? null : t.id)} onComplete={() => complete(t.id)} onFail={() => fail(t.id)} onPriority={async (p) => toastFrom(await data.updatePriority(t.id, p))} />)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rk-tasks__list">
            {listItems.length === 0 ? <div className="rk-tasks__empty"><EmptyState title="一致するタスクがありません">フィルタを解除するか、<b>新規タスク</b>を押して追加してください。</EmptyState></div>
              : listItems.map((t) => {
                const over = isOverdue(t);
                const terminal = t.status === "completed" || t.status === "failed";
                return (
                  <button key={t.id} className={`rk-tasks__row${selectedId === t.id ? " rk-tasks__row--sel" : ""}${over ? " rk-tasks__row--over" : ""}${terminal ? " rk-tasks__row--dim" : ""}`} onClick={() => setSelectedId(selectedId === t.id ? null : t.id)}>
                    <span className="rk-tasks__row-dot" style={{ background: TONE_HUE[STATUS_TONE[t.status]] }} />
                    <span className="rk-tasks__row-t">{t.what}</span>
                    <span className="rk-tasks__row-due">{formatDue(t) || "—"}</span>
                    <span className="rk-tasks__row-end">
                      <StatusChip tone={PRIORITY_TONE[t.priority]}>{t.priority}</StatusChip>
                      <StatusChip tone={STATUS_TONE[t.status]}>{t.status}</StatusChip>
                      {t.assigned_to && <span className="rk-tasks__asg">{t.assigned_to}</span>}
                    </span>
                  </button>
                );
              })}
          </div>
        )}

        {mode === "expanded" && selected && <TaskDrawer task={selected} onClose={() => setSelectedId(null)} onStatus={async (s) => toastFrom(await data.updateStatus(selected.id, s))} />}
      </div>

      {createOpen && (
        <CreateDialog onClose={() => setCreateOpen(false)} onCreate={async (input) => {
          const parsed = input.when ? parseRelativeDate(input.when) : null;
          const r = await data.createTask({ what: input.what, when_due: parsed?.ts, priority: input.priority, assigned_to: input.assigned_to || undefined, context: input.context || undefined });
          setToast({ text: r.ok ? `タスク「${input.what}」を作成しました。` : r.message, tone: r.ok ? "ok" : "warn" });
          if (r.ok) setSelectedId(r.task.id);
          return r.ok;
        }} />
      )}

      {toast && <div className="rk-tasks__toast"><Toast tone={toast.tone === "ok" ? "ok" : "hold"}>{toast.text}</Toast></div>}
    </div>
  );
}

export function TasksRoom() {
  return (
    <RoomShell title="タスク" subtitle="カンバン · 期限 · 優先度" breadcrumb={["タスク"]}>
      <TasksRoomBody mode="expanded" />
    </RoomShell>
  );
}

function Stat({ k, n, amber }: { k: string; n: number; amber?: boolean }) {
  return <div className="rk-tasks__stat"><div className="rk-tasks__stat-k">{k}</div><div className={`rk-tasks__stat-n${amber ? " rk-tasks__stat-n--amber" : ""}`}>{n}</div></div>;
}

function TaskCard({ task, selected, onClick, onComplete, onFail, onPriority }: { task: Task; selected: boolean; onClick: () => void; onComplete: () => void; onFail: () => void; onPriority: (p: TaskPriority) => void }) {
  const over = isOverdue(task);
  const terminal = task.status === "completed" || task.status === "failed";
  return (
    <div className={`rk-tasks__card${selected ? " rk-tasks__card--sel" : ""}${over ? " rk-tasks__card--over" : ""}${terminal ? " rk-tasks__card--terminal" : ""}`} onClick={onClick} role="button">
      {!terminal && (
        <div className="rk-tasks__card-acts">
          <select className="rk-tasks__prio" value={task.priority} aria-label="優先度を設定" title="優先度を設定" onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); onPriority(e.target.value as TaskPriority); }}>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button className="rk-tasks__act rk-tasks__act--no" title="失敗にする" onClick={(e) => { e.stopPropagation(); onFail(); }}>✕</button>
          <button className="rk-tasks__act rk-tasks__act--ok" title="完了にする" onClick={(e) => { e.stopPropagation(); onComplete(); }}>✓</button>
        </div>
      )}
      <div className="rk-tasks__card-what">{task.what}</div>
      {task.context && <div className="rk-tasks__card-cx">{task.context}</div>}
      <div className="rk-tasks__card-meta">
        <StatusChip tone={PRIORITY_TONE[task.priority]}>{task.priority}</StatusChip>
        {task.assigned_to && <span className="rk-tasks__asg">{task.assigned_to}</span>}
        {task.when_due != null && <span className={`rk-tasks__due${over ? " rk-tasks__due--over" : ""}`}>{formatDue(task)}</span>}
      </div>
      {terminal && task.result && <div className="rk-tasks__card-result">{task.result}</div>}
    </div>
  );
}

function TaskDrawer({ task, onClose, onStatus }: { task: Task; onClose: () => void; onStatus: (s: TaskStatus) => void }) {
  const terminal = task.status === "completed" || task.status === "failed";
  return (
    <aside className="rk-tasks__drawer">
      <div className="rk-tasks__dh">
        <div>
          <div className="rk-tasks__dn">{task.what}</div>
          <div className="rk-tasks__dm">{task.assigned_to ? `担当 ${task.assigned_to}` : "未割り当て"} · 作成 {formatDay(task.created_at)}</div>
        </div>
        <button className="rk-tasks__icbtn" onClick={onClose} aria-label="閉じる"><Icon icon={X} size="sm" /></button>
      </div>
      <div className="rk-tasks__dbody">
        <div className="rk-tasks__drow"><StatusChip tone={STATUS_TONE[task.status]} dot>{STATUS_LABEL[task.status]}</StatusChip><StatusChip tone={PRIORITY_TONE[task.priority]}>{task.priority}</StatusChip>{task.when_due != null && <span className="rk-tasks__row-due">{formatDue(task)}</span>}</div>
        {task.context && <><div className="rk-tasks__dlabel">コンテキスト</div><div className="rk-tasks__dtext">{task.context}</div></>}
        {task.result && <><div className="rk-tasks__dlabel">結果</div><div className="rk-tasks__dtext">{task.result}</div></>}
        {task.status === "escalated" && <div style={{ marginTop: 12 }}><DeepLink onClick={() => openRoom("authority")}>→ 権限でブロック中の承認を開く</DeepLink></div>}
      </div>
      <div className="rk-tasks__da">
        {!terminal ? (
          <>
            <button className="rk-tasks__sbtn rk-tasks__sbtn--pri" onClick={() => onStatus("completed")}>完了</button>
            <button className="rk-tasks__sbtn rk-tasks__sbtn--red" onClick={() => onStatus("failed")}>失敗</button>
          </>
        ) : (
          <button className="rk-tasks__sbtn" onClick={() => onStatus("pending")}>再アクティブ化</button>
        )}
      </div>
    </aside>
  );
}

function CreateDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (input: { what: string; when: string; priority: TaskPriority; assigned_to: string; context: string }) => Promise<boolean> }) {
  const [what, setWhat] = useState("");
  const [when, setWhen] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [assigned, setAssigned] = useState("");
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => (when.trim() ? parseRelativeDate(when) : null), [when]);
  const submit = async () => { if (!what.trim()) return; setBusy(true); const ok = await onCreate({ what: what.trim(), when: when.trim(), priority, assigned_to: assigned.trim(), context: context.trim() }); setBusy(false); if (ok) onClose(); };
  return (
    <div className="rk-tasks__overlay" onClick={() => !busy && onClose()}>
      <div className="rk-tasks__dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="rk-tasks__dialog-head"><div className="rk-tasks__dialog-title">新規タスク</div><div className="rk-tasks__dialog-sub">クイック作成。「保留中」列に表示されます。</div></div>
        <div className="rk-tasks__dialog-body">
          <div><div className="rk-tasks__flab">タスク</div><input className="rk-tasks__input" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="何をする必要がありますか?" autoFocus /></div>
          <div><div className="rk-tasks__flab">期限 · 任意</div><input className="rk-tasks__input" value={when} onChange={(e) => setWhen(e.target.value)} placeholder="金曜17時" />
            <div className="rk-tasks__parse">{when.trim() ? (parsed ? `→ ${formatFull(parsed.ts)}` : "解析できませんでした。期限なしのタスクになります。") : "空欄のままにすると期限なしのタスクになります。"}</div></div>
          <div><div className="rk-tasks__flab">優先度</div><div className="rk-tasks__chiprow">{TASK_PRIORITIES.map((p) => <button key={p} className={`rk-tasks__sbtn${priority === p ? " rk-tasks__sbtn--pri" : ""}`} onClick={() => setPriority(p)}>{p}</button>)}</div></div>
          <div><div className="rk-tasks__flab">担当者 · 任意</div><input className="rk-tasks__input" value={assigned} onChange={(e) => setAssigned(e.target.value)} placeholder="you / jarvis / エージェント名" /></div>
          <div><div className="rk-tasks__flab">コンテキスト · 任意</div><input className="rk-tasks__input" value={context} onChange={(e) => setContext(e.target.value)} placeholder="背景やメモ。" /></div>
        </div>
        <div className="rk-tasks__dialog-acts">
          <button className="rk-tasks__sbtn" onClick={onClose} disabled={busy}>キャンセル</button>
          <button className="rk-tasks__sbtn rk-tasks__sbtn--pri" onClick={submit} disabled={busy || !what.trim()}>{busy ? "作成中…" : "作成"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── helpers ── */
function isOverdue(t: Task): boolean { return t.status !== "completed" && t.status !== "failed" && t.when_due != null && t.when_due < Date.now(); }
function formatDue(t: Task): string {
  if (t.when_due == null) return "";
  const d = new Date(t.when_due); const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (isOverdue(t)) return `期限超過 · ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return `今日 ${hm}`;
  const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1);
  if (sameDay(d, tmr)) return `明日 ${hm}`;
  const diff = (d.getTime() - now.getTime()) / 86_400_000;
  if (diff > 0 && diff < 7) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${hm}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${hm}`;
}
function formatDay(ts: number): string { return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }
function formatFull(ts: number): string { return new Date(ts).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
