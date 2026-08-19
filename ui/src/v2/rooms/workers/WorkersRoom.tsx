import React, { useMemo, useState, useEffect, useRef, useCallback, memo } from "react";
import { RefreshCw } from "lucide-react";
import { Icon } from "../../ui";
import { StatusChip, EmptyState, Skeleton, Toast, Switch, Select, Input, type Tone } from "../../ui/roomkit";
import { RoomShell } from "../RoomShell";
import {
  useWorkersData,
  type WorkerSummary,
  type WorkerStatus,
  type WorkerCapability,
  type FileHandoff,
  type TaskTemplate,
  type ManualHandoffOutcome,
  type TaskOutcome,
  type SplitSubtaskInput,
} from "./useWorkersData";
import { useCostData, type BudgetConfig, type BudgetStatus, type CostSummary } from "./useCostData";
import { useAIProfilesData, type AIProfile, type AIProfiles } from "./useAIProfilesData";
import { useTaskHistoryData, type TaskHistoryEntry, type SuccessRateEntry } from "./useTaskHistoryData";
import "./WorkersRoom.css";

export type RoomBodyMode = "inline" | "expanded";

/** Status vocabulary from the AI司令塔 spec §23: READY/WORKING/WAITING/HANDOFF/ERROR/DONE (+ disabled, JARVIS-side only). */
const STATUS_TONE: Record<WorkerStatus, Tone> = {
  ready: "ok",
  working: "run",
  waiting: "hold",
  handoff: "hold",
  error: "fail",
  done: "ok",
  disabled: "mut",
};

const HANDOFF_TONE: Record<FileHandoff["status"], Tone> = {
  ready: "mut",
  in_progress: "run",
  completed: "ok",
  failed: "fail",
  needs_input: "hold",
};

const TEMPLATES: readonly TaskTemplate[] = ["code", "research", "plan", "write", "general"];

const BUDGET_STATUS_TONE: Record<BudgetStatus, Tone> = {
  ok: "ok",
  warning: "hold",
  exceeded: "fail",
};

export function WorkersRoomBody({ mode }: { mode: RoomBodyMode }) {
  const data = useWorkersData();
  const cost = useCostData();
  const aiProfiles = useAIProfilesData();
  const taskHistory = useTaskHistoryData();
  const [runOpen, setRunOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [manualHandoff, setManualHandoff] = useState<{ taskId: string; outcome: ManualHandoffOutcome } | null>(null);
  const [splitResults, setSplitResults] = useState<TaskOutcome[] | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const handleToggle = useCallback(
    async (worker: WorkerSummary, enabled: boolean) => {
      const r = await data.setEnabled(worker.name, enabled);
      setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
    },
    [data.setEnabled],
  );

  const handleRemove = useCallback(
    async (worker: WorkerSummary) => {
      const r = await data.removeWorker(worker);
      setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
    },
    [data.removeWorker],
  );

  const selectedHandoff = useMemo(
    () => data.handoffs.find((h) => h.task_id === selectedTaskId) ?? null,
    [data.handoffs, selectedTaskId],
  );

  return (
    <div className={`rk-workers rk-workers--${mode}`} style={{ position: "relative" }}>
      <div className="rk-workers__tool">
        <span className="rk-workers__title">ワーカー</span>
        <span className="rk-workers__sub">AIステータス · タスク · ハンドオフ</span>
        <button className="rk-workers__icbtn" onClick={data.refresh} aria-label="更新">
          <Icon icon={RefreshCw} size="sm" />
        </button>
        {cost.summary && (
          <StatusChip tone={BUDGET_STATUS_TONE[cost.summary.status]} dot>
            {cost.summary.daily_cost}{cost.summary.currency} / {cost.summary.budget.daily_budget}{cost.summary.currency}
          </StatusChip>
        )}
        <button className="rk-workers__new" onClick={() => setAddOpen(true)}>ワーカーを追加</button>
        <button className="rk-workers__new" onClick={() => setProfilesOpen((v) => !v)}>
          {profilesOpen ? "閉じる" : "AIプロファイル"}
        </button>
        <button className="rk-workers__new" onClick={() => setCostOpen((v) => !v)}>
          {costOpen ? "閉じる" : "コスト管理"}
        </button>
        <button className="rk-workers__new" onClick={() => setHistoryOpen((v) => !v)}>
          {historyOpen ? "閉じる" : "履歴"}
        </button>
        <button className="rk-workers__new" onClick={() => setSplitOpen((v) => !v)}>
          {splitOpen ? "閉じる" : "タスク分割"}
        </button>
        <button className="rk-workers__new" onClick={() => setRunOpen((v) => !v)}>
          {runOpen ? "閉じる" : "タスクを実行"}
        </button>
      </div>

      {profilesOpen && (
        <AIProfilesPanel
          profiles={aiProfiles.profiles}
          loading={aiProfiles.loading}
          error={aiProfiles.error}
          onSave={async (next) => {
            const r = await aiProfiles.saveProfiles(next);
            setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
            return r.ok;
          }}
        />
      )}

      {costOpen && (
        <CostPanel
          summary={cost.summary}
          loading={cost.loading}
          error={cost.error}
          onSave={async (budget) => {
            const r = await cost.updateBudget(budget);
            setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
            return r.ok;
          }}
        />
      )}

      {historyOpen && (
        <HistoryPanel history={taskHistory.history} rates={taskHistory.rates} loading={taskHistory.loading} error={taskHistory.error} />
      )}

      {splitOpen && (
        <SplitPanel
          workers={data.workers}
          busy={data.running}
          onRun={async (subtasks) => {
            const r = await data.runSplitTask(subtasks);
            if (r.ok) {
              setSplitResults(r.result.results);
              const failed = r.result.results.filter(
                (o) => o.mode === "worker_run" && o.result.status !== "completed",
              ).length;
              setToast({ text: `${r.result.results.length}件のサブタスクを実行しました`, tone: failed > 0 ? "warn" : "ok" });
            } else {
              setToast({ text: r.message, tone: "warn" });
            }
            return r.ok;
          }}
        />
      )}

      {splitResults && (
        <div className="rk-workers__runpanel">
          <div className="rk-workers__flab">分割実行の結果</div>
          {splitResults.map((outcome, i) =>
            outcome.mode === "worker_run" ? (
              <div key={i} className="rk-workers__row" style={{ cursor: "default" }}>
                <div className="rk-workers__row-body">
                  <span className="rk-workers__row-route">{outcome.worker}</span>
                  <span className="rk-workers__row-summary">{outcome.result.summary}</span>
                </div>
                <StatusChip tone={outcome.result.status === "completed" ? "ok" : outcome.result.status === "needs_input" ? "hold" : "fail"}>
                  {outcome.result.status}
                </StatusChip>
              </div>
            ) : (
              <div key={i} className="rk-workers__row" style={{ cursor: "default" }}>
                <div className="rk-workers__row-body">
                  <span className="rk-workers__row-route">{outcome.primary ?? "(なし)"}</span>
                  <span className="rk-workers__row-summary">{outcome.reason}</span>
                </div>
                <StatusChip tone="hold">manual_handoff</StatusChip>
              </div>
            ),
          )}
          <div className="rk-workers__runacts">
            <button className="rk-workers__sbtn" onClick={() => setSplitResults(null)}>閉じる</button>
          </div>
        </div>
      )}

      {runOpen && (
        <RunPanel
          workers={data.workers}
          busy={data.running}
          onRun={async (input) => {
            const r = await data.runTask(input);
            if (r.ok) {
              if (r.outcome.mode === "manual_handoff") {
                setManualHandoff({ taskId: input.task_id, outcome: r.outcome });
                setToast({ text: `推奨AI: ${r.outcome.primary ?? "なし"}（Manual Handoff）`, tone: "warn" });
              } else {
                setManualHandoff(null);
                setToast({
                  text: `${r.outcome.worker}: ${r.outcome.result.status}`,
                  tone: r.outcome.result.status === "completed" ? "ok" : "warn",
                });
              }
              setSelectedTaskId(input.task_id);
              setRunOpen(false);
            } else {
              setToast({ text: r.message, tone: "warn" });
            }
            return r.ok;
          }}
        />
      )}

      {manualHandoff && (
        <ManualHandoffPanel
          outcome={manualHandoff.outcome}
          onClose={() => setManualHandoff(null)}
          onCopy={(text) => setToast({ text: "コピーしました", tone: "ok" })}
        />
      )}

      <div className="rk-workers__body">
        <div className="rk-workers__cards">
          {data.loading && data.workers.length === 0 ? (
            <Skeleton lines={4} />
          ) : data.workers.length === 0 ? (
            <EmptyState title="登録されたワーカーがありません">
              JARVISはこのデーモンで外部AIワーカーを見つけられませんでした。
            </EmptyState>
          ) : (
            data.workers.map((w) => (
              <WorkerCard key={w.name} worker={w} onToggle={handleToggle} onRemove={handleRemove} />
            ))
          )}
        </div>

        <div className="rk-workers__list">
          {data.error ? (
            <div className="rk-workers__msg">{data.error}</div>
          ) : data.loading && data.handoffs.length === 0 ? (
            <div className="rk-workers__empty"><Skeleton lines={4} /></div>
          ) : data.handoffs.length === 0 ? (
            <div className="rk-workers__empty">
              <EmptyState title="まだハンドオフがありません">
                タスクを実行するとここにハンドオフが表示されます — 外部AIワーカーが作業を戻すために読み込む、同じファイルです。
              </EmptyState>
            </div>
          ) : (
            data.handoffs.map((h) => (
              <HandoffRow
                key={h.task_id}
                handoff={h}
                selected={h.task_id === selectedTaskId}
                onClick={() => setSelectedTaskId(h.task_id === selectedTaskId ? null : h.task_id)}
              />
            ))
          )}

          {selectedHandoff && <HandoffDetail handoff={selectedHandoff} />}
        </div>
      </div>

      {addOpen && (
        <AddWorkerDialog
          onClose={() => setAddOpen(false)}
          onAdd={async (input) => {
            const r = await data.addWorker(input);
            setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
            if (r.ok) setAddOpen(false);
            return r.ok;
          }}
        />
      )}

      {toast && <div className="rk-workers__toast"><Toast tone={toast.tone === "ok" ? "ok" : "fail"}>{toast.text}</Toast></div>}
    </div>
  );
}

export function WorkersRoom() {
  return (
    <RoomShell title="ワーカー" subtitle="AIステータス · タスク · ハンドオフ" breadcrumb={["ワーカー"]}>
      <WorkersRoomBody mode="expanded" />
    </RoomShell>
  );
}

const WorkerCard = memo(function WorkerCard({
  worker,
  onToggle,
  onRemove,
}: {
  worker: WorkerSummary;
  onToggle: (worker: WorkerSummary, enabled: boolean) => void;
  onRemove: (worker: WorkerSummary) => void;
}) {
  const status: WorkerStatus = worker.enabled ? worker.status : "disabled";
  return (
    <div className="rk-workers__card">
      <div className="rk-workers__card-head">
        <span className="rk-workers__card-name">{worker.name}</span>
        <StatusChip tone={STATUS_TONE[status]} dot>{status}</StatusChip>
      </div>
      <div className="rk-workers__card-type">{worker.type} · {worker.input_method} → {worker.output_method}</div>
      <div className="rk-workers__card-caps">
        {worker.capabilities.map((c) => <span key={c} className="rk-workers__cap">{c}</span>)}
      </div>
      <div className="rk-workers__card-meta">
        <span>タイムアウト {Math.round(worker.timeout_ms / 1000)}秒</span>
        <span>リトライ {worker.retry}</span>
      </div>
      <div className="rk-workers__card-toggle">
        <span className="rk-workers__flab" style={{ marginBottom: 0 }}>有効</span>
        <Switch on={worker.enabled} onClick={() => onToggle(worker, !worker.enabled)} />
      </div>
      {worker.type === "custom" && (
        <button className="rk-workers__sbtn" onClick={() => onRemove(worker)}>削除</button>
      )}
    </div>
  );
});

function HandoffRow({ handoff, selected, onClick }: { handoff: FileHandoff; selected: boolean; onClick: () => void }) {
  return (
    <button className={`rk-workers__row${selected ? " rk-workers__row--sel" : ""}`} onClick={onClick}>
      <div className="rk-workers__row-body">
        <span className="rk-workers__row-route">{handoff.from} → {handoff.to}</span>
        <span className="rk-workers__row-summary">{handoff.summary}</span>
      </div>
      <StatusChip tone={HANDOFF_TONE[handoff.status]}>{handoff.status}</StatusChip>
    </button>
  );
}

function HandoffDetail({ handoff }: { handoff: FileHandoff }) {
  return (
    <div className="rk-workers__card" style={{ marginTop: 4 }}>
      <div className="rk-workers__card-head">
        <span className="rk-workers__card-name">{handoff.task_id}</span>
        <StatusChip tone={HANDOFF_TONE[handoff.status]}>{handoff.status}</StatusChip>
      </div>
      <div className="rk-workers__row-summary" style={{ whiteSpace: "pre-wrap" }}>{handoff.summary}</div>
      {handoff.files.length > 0 && (
        <div className="rk-workers__card-meta">ファイル: {handoff.files.join(", ")}</div>
      )}
      <div className="rk-workers__card-meta">次: {handoff.next_action}</div>
    </div>
  );
}

/** Task History + Success Rate (spec §38 optional checklist). */
function HistoryPanel({
  history,
  rates,
  loading,
  error,
}: {
  history: TaskHistoryEntry[];
  rates: SuccessRateEntry[];
  loading: boolean;
  error: string | null;
}) {
  if (loading && history.length === 0) {
    return <div className="rk-workers__runpanel"><Skeleton lines={3} /></div>;
  }
  if (error) {
    return <div className="rk-workers__runpanel"><div className="rk-workers__msg">{error}</div></div>;
  }

  return (
    <div className="rk-workers__runpanel">
      {rates.length > 0 && (
        <>
          <div className="rk-workers__flab">成功率</div>
          <div className="rk-workers__card-caps" style={{ marginBottom: 4 }}>
            {rates.map((r) => (
              <span key={r.worker} className="rk-workers__cap">
                {r.worker}: {Math.round(r.successRate * 100)}%({r.completed}/{r.total})
              </span>
            ))}
          </div>
        </>
      )}

      <div className="rk-workers__flab">タスク履歴</div>
      {history.length === 0 ? (
        <div className="rk-workers__sub">まだ履歴がありません。</div>
      ) : (
        history.map((h) => (
          <div key={`${h.task_id}-${h.timestamp}`} className="rk-workers__row" style={{ cursor: "default" }}>
            <div className="rk-workers__row-body">
              <span className="rk-workers__row-route">
                {h.mode === "worker_run" ? h.worker : `${h.primary ?? "(なし)"} (manual)`}
              </span>
              <span className="rk-workers__row-summary">
                {h.template} · {new Date(h.timestamp).toLocaleString()}
              </span>
            </div>
            <StatusChip
              tone={
                h.mode === "manual_handoff"
                  ? "hold"
                  : h.status === "completed"
                    ? "ok"
                    : h.status === "needs_input"
                      ? "hold"
                      : "fail"
              }
            >
              {h.mode === "worker_run" ? h.status : "manual_handoff"}
            </StatusChip>
          </div>
        ))
      )}
    </div>
  );
}

/** Multi-AI task splitting (spec §38 optional checklist "複数AIへのタスク分割"): the caller (here, the user) supplies each subtask's template/prompt/worker; JARVIS fans them out through the normal Router/Manual-Handoff path per subtask rather than auto-decomposing the task itself. */
function SplitPanel({
  workers,
  busy,
  onRun,
}: {
  workers: WorkerSummary[];
  busy: boolean;
  onRun: (subtasks: SplitSubtaskInput[]) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<SplitSubtaskInput[]>([
    { template: "general", prompt: "" },
    { template: "general", prompt: "" },
  ]);
  const submittingRef = useRef(false);

  const updateRow = (i: number, patch: Partial<SplitSubtaskInput>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((prev) => (prev.length >= 10 ? prev : [...prev, { template: "general", prompt: "" }]));
  const removeRow = (i: number) => setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const canSubmit = rows.every((r) => r.prompt.trim()) && rows.length > 0;

  const submit = async () => {
    if (!canSubmit || busy || submittingRef.current) return;
    submittingRef.current = true;
    try {
      const ok = await onRun(rows.map((r) => ({ ...r, prompt: r.prompt.trim(), ...(r.worker ? { worker: r.worker } : {}) })));
      if (ok) setRows([{ template: "general", prompt: "" }, { template: "general", prompt: "" }]);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <div className="rk-workers__runpanel">
      <div className="rk-workers__dialog-sub">
        1つの親タスクを複数のサブタスクに分け、それぞれ独立してルーティング(自動実行 or Manual Handoff)します。最大10件。
      </div>
      {rows.map((row, i) => (
        <div key={i} className="rk-workers__runrow" style={{ alignItems: "flex-end" }}>
          <div>
            <div className="rk-workers__flab">テンプレート</div>
            <Select value={row.template} onChange={(e) => updateRow(i, { template: e.target.value as TaskTemplate })}>
              {TEMPLATES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <div>
            <div className="rk-workers__flab">ワーカー (任意)</div>
            <Select value={row.worker ?? ""} onChange={(e) => updateRow(i, { worker: e.target.value || undefined })}>
              <option value="">自動</option>
              {workers.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
            </Select>
          </div>
          <div style={{ flex: 2 }}>
            <div className="rk-workers__flab">プロンプト</div>
            <Input value={row.prompt} onChange={(e) => updateRow(i, { prompt: e.target.value })} placeholder="サブタスクの内容" />
          </div>
          <button className="rk-workers__sbtn" onClick={() => removeRow(i)} disabled={rows.length <= 1}>削除</button>
        </div>
      ))}
      <div className="rk-workers__runacts" style={{ justifyContent: "space-between" }}>
        <button className="rk-workers__sbtn" onClick={addRow} disabled={rows.length >= 10}>+ サブタスクを追加</button>
        <button className="rk-workers__sbtn rk-workers__sbtn--pri" disabled={busy || !canSubmit} onClick={submit}>
          {busy ? "実行中…" : "分割実行"}
        </button>
      </div>
    </div>
  );
}

function RunPanel({
  workers,
  busy,
  onRun,
}: {
  workers: WorkerSummary[];
  busy: boolean;
  onRun: (input: { task_id: string; template: TaskTemplate; prompt: string; worker?: string }) => Promise<boolean>;
}) {
  const [template, setTemplate] = useState<TaskTemplate>("general");
  const [worker, setWorker] = useState<string>("");
  const [prompt, setPrompt] = useState("");

  const submittingRef = useRef(false);

  const submit = async () => {
    if (!prompt.trim() || busy || submittingRef.current) return;
    submittingRef.current = true;
    try {
      const ok = await onRun({
        task_id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        template,
        prompt: prompt.trim(),
        ...(worker ? { worker } : {}),
      });
      if (ok) setPrompt("");
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <div className="rk-workers__runpanel">
      <div className="rk-workers__runrow">
        <div>
          <div className="rk-workers__flab">テンプレート</div>
          <Select value={template} onChange={(e) => setTemplate(e.target.value as TaskTemplate)}>
            {TEMPLATES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </div>
        <div>
          <div className="rk-workers__flab">ワーカー (任意)</div>
          <Select value={worker} onChange={(e) => setWorker(e.target.value)}>
            <option value="">自動 (ルーターが選択)</option>
            {workers.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
          </Select>
        </div>
      </div>
      <div>
        <div className="rk-workers__flab">プロンプト</div>
        <textarea
          className="rk-workers__textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="このワーカーに何をさせますか?"
          autoFocus
        />
      </div>
      <div className="rk-workers__runacts">
        <button className="rk-workers__sbtn rk-workers__sbtn--pri" disabled={busy || !prompt.trim()} onClick={submit}>
          {busy ? "実行中…" : "実行"}
        </button>
      </div>
    </div>
  );
}

/** Manual Handoff (spec 17-18/21/28): shown when the Router has no connected Worker for the task, so the user copies the prompt into whichever AI is recommended themselves. */
function ManualHandoffPanel({
  outcome,
  onClose,
  onCopy,
}: {
  outcome: ManualHandoffOutcome;
  onClose: () => void;
  onCopy: (text: string) => void;
}) {
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API unavailable - the text is still visible below to copy by hand
    }
    onCopy(text);
  };

  return (
    <div className="rk-workers__runpanel">
      <div className="rk-workers__runrow">
        <div>
          <div className="rk-workers__flab">推奨AI</div>
          <div>
            ★ {outcome.primary ?? "(なし)"}
            {!outcome.primaryAvailable && <span className="rk-workers__sub"> — 未接続</span>}
          </div>
        </div>
        {outcome.fallback && (
          <div>
            <div className="rk-workers__flab">フォールバック</div>
            <div>
              ○ {outcome.fallback}
              {!outcome.fallbackAvailable && <span className="rk-workers__sub"> — 未接続</span>}
            </div>
          </div>
        )}
      </div>
      <div>
        <div className="rk-workers__flab">理由</div>
        <div>{outcome.reason}</div>
      </div>
      <div>
        <div className="rk-workers__flab">渡すプロンプト</div>
        <textarea className="rk-workers__textarea" value={outcome.prompt} readOnly />
      </div>
      <div className="rk-workers__runacts">
        <button className="rk-workers__sbtn rk-workers__sbtn--pri" onClick={() => copy(outcome.prompt)}>
          Promptをコピー
        </button>
        <button className="rk-workers__sbtn" onClick={() => copy(`task_type: ${outcome.task_type}\nprimary: ${outcome.primary ?? ""}\nfallback: ${outcome.fallback ?? ""}\nreason: ${outcome.reason}`)}>
          タスク情報をコピー
        </button>
        <button className="rk-workers__sbtn" onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}

/** Cost management (spec §19-20): estimated daily/monthly spend against a budget, with an editable budget form. Zero API cost by itself — a read of already-recorded llm_usage rows plus local pricing math. */
function CostPanel({
  summary,
  loading,
  error,
  onSave,
}: {
  summary: CostSummary | null;
  loading: boolean;
  error: string | null;
  onSave: (budget: BudgetConfig) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [dailyBudget, setDailyBudget] = useState("");
  const [warningThreshold, setWarningThreshold] = useState("");
  const [hardLimit, setHardLimit] = useState("");
  const [busy, setBusy] = useState(false);

  const startEdit = () => {
    if (!summary) return;
    setDailyBudget(String(summary.budget.daily_budget));
    setWarningThreshold(String(summary.budget.warning_threshold));
    setHardLimit(String(summary.budget.hard_limit));
    setEditing(true);
  };

  const submit = async () => {
    if (!summary || busy) return;
    const daily_budget = Number(dailyBudget);
    const warning_threshold = Number(warningThreshold);
    const hard_limit = Number(hardLimit);
    if (!Number.isFinite(daily_budget) || !Number.isFinite(warning_threshold) || !Number.isFinite(hard_limit)) return;
    setBusy(true);
    const ok = await onSave({ daily_budget, warning_threshold, hard_limit, currency: summary.currency });
    setBusy(false);
    if (ok) setEditing(false);
  };

  if (loading && !summary) {
    return <div className="rk-workers__runpanel"><Skeleton lines={3} /></div>;
  }
  if (error || !summary) {
    return <div className="rk-workers__runpanel"><div className="rk-workers__msg">{error ?? "コスト情報がありません"}</div></div>;
  }

  const pct = summary.budget.hard_limit > 0 ? Math.min(1, summary.daily_cost / summary.budget.hard_limit) : 0;

  return (
    <div className="rk-workers__runpanel">
      <div className="rk-workers__runrow">
        <div>
          <div className="rk-workers__flab">本日の推定コスト</div>
          <div className="rk-workers__cost-fig">{summary.daily_cost}{summary.currency}</div>
        </div>
        <div>
          <div className="rk-workers__flab">今月の推定コスト</div>
          <div className="rk-workers__cost-fig">
            {summary.monthly_cost}{summary.currency}
            {summary.monthly_partial && <span className="rk-workers__sub"> (一部のみ集計)</span>}
          </div>
        </div>
        <div>
          <div className="rk-workers__flab">状態</div>
          <StatusChip tone={BUDGET_STATUS_TONE[summary.status]} dot>{summary.status}</StatusChip>
        </div>
      </div>

      <div className="rk-workers__cost-bar">
        <div
          className={`rk-workers__cost-bar-fill rk-workers__cost-bar-fill--${summary.status}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <div className="rk-workers__sub">
        日次予算 {summary.budget.daily_budget}{summary.currency} · 警告 {summary.budget.warning_threshold}{summary.currency} · 上限 {summary.budget.hard_limit}{summary.currency}
      </div>

      {summary.by_provider.length > 0 && (
        <div className="rk-workers__card-caps">
          {summary.by_provider.map((p) => (
            <span key={p.provider} className="rk-workers__cap">{p.provider}: {p.cost}{summary.currency} ({p.calls}回)</span>
          ))}
        </div>
      )}

      {editing ? (
        <>
          <div className="rk-workers__runrow">
            <div>
              <div className="rk-workers__flab">日次予算 ({summary.currency})</div>
              <Input value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} mono />
            </div>
            <div>
              <div className="rk-workers__flab">警告しきい値</div>
              <Input value={warningThreshold} onChange={(e) => setWarningThreshold(e.target.value)} mono />
            </div>
            <div>
              <div className="rk-workers__flab">上限</div>
              <Input value={hardLimit} onChange={(e) => setHardLimit(e.target.value)} mono />
            </div>
          </div>
          <div className="rk-workers__runacts">
            <button className="rk-workers__sbtn" onClick={() => setEditing(false)} disabled={busy}>キャンセル</button>
            <button className="rk-workers__sbtn rk-workers__sbtn--pri" onClick={submit} disabled={busy}>
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </>
      ) : (
        <div className="rk-workers__runacts">
          <button className="rk-workers__sbtn" onClick={startEdit}>予算を編集</button>
        </div>
      )}
    </div>
  );
}

/** Capabilities a TaskTemplate can actually route to - excludes "image" (see ai-profiles.ts: no template maps to it, so a strength score there would be dead configuration). */
const ROUTABLE_CAPABILITIES: readonly WorkerCapability[] = ["code", "research", "write", "plan", "general"];

const EMPTY_PROFILE: AIProfile = { enabled: true, priority: 1, strengths: {} };

/** AI Profile Manager (spec Phase 3): edits ai-profiles.json's strengths/priority/enabled per AI, previously file-only. */
function AIProfilesPanel({
  profiles,
  loading,
  error,
  onSave,
}: {
  profiles: AIProfiles;
  loading: boolean;
  error: string | null;
  onSave: (next: AIProfiles) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AIProfiles>({});
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const startEdit = () => {
    setDraft(JSON.parse(JSON.stringify(profiles)));
    setEditing(true);
  };

  const updateProfile = (name: string, patch: Partial<AIProfile>) => {
    setDraft((prev) => ({ ...prev, [name]: { ...prev[name]!, ...patch } }));
  };

  const updateStrength = (name: string, cap: WorkerCapability, value: number) => {
    setDraft((prev) => ({
      ...prev,
      [name]: { ...prev[name]!, strengths: { ...prev[name]!.strengths, [cap]: value } },
    }));
  };

  const addProfile = () => {
    const name = newName.trim();
    if (!name || draft[name]) return;
    setDraft((prev) => ({ ...prev, [name]: { ...EMPTY_PROFILE, strengths: {} } }));
    setNewName("");
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onSave(draft);
    setBusy(false);
    if (ok) setEditing(false);
  };

  if (loading && Object.keys(profiles).length === 0) {
    return <div className="rk-workers__runpanel"><Skeleton lines={3} /></div>;
  }
  if (error) {
    return <div className="rk-workers__runpanel"><div className="rk-workers__msg">{error}</div></div>;
  }

  const shown = editing ? draft : profiles;
  const names = Object.keys(shown).sort();

  return (
    <div className="rk-workers__runpanel">
      {names.map((name) => {
        const p = shown[name]!;
        return (
          <div key={name} className="rk-workers__card" style={{ marginBottom: 4 }}>
            <div className="rk-workers__card-head">
              <span className="rk-workers__card-name">{name}</span>
              {editing ? (
                <Switch on={p.enabled} onClick={() => updateProfile(name, { enabled: !p.enabled })} />
              ) : (
                <StatusChip tone={p.enabled ? "ok" : "mut"} dot>{p.enabled ? "有効" : "無効"}</StatusChip>
              )}
            </div>
            <div className="rk-workers__runrow">
              {ROUTABLE_CAPABILITIES.map((cap) => (
                <div key={cap}>
                  <div className="rk-workers__flab">{cap}</div>
                  {editing ? (
                    <Input
                      value={String(p.strengths[cap] ?? 0)}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n)) updateStrength(name, cap, Math.max(0, Math.min(5, n)));
                      }}
                      mono
                    />
                  ) : (
                    <div>{p.strengths[cap] ?? 0}</div>
                  )}
                </div>
              ))}
              <div>
                <div className="rk-workers__flab">優先度</div>
                {editing ? (
                  <Input
                    value={String(p.priority)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) updateProfile(name, { priority: n });
                    }}
                    mono
                  />
                ) : (
                  <div>{p.priority}</div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {editing ? (
        <>
          <div className="rk-workers__runrow">
            <div>
              <div className="rk-workers__flab">新しいAIプロファイルを追加</div>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="my_worker" />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="rk-workers__sbtn" onClick={addProfile} disabled={!newName.trim()}>追加</button>
            </div>
          </div>
          <div className="rk-workers__runacts">
            <button className="rk-workers__sbtn" onClick={() => setEditing(false)} disabled={busy}>キャンセル</button>
            <button className="rk-workers__sbtn rk-workers__sbtn--pri" onClick={submit} disabled={busy}>
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </>
      ) : (
        <div className="rk-workers__runacts">
          <button className="rk-workers__sbtn" onClick={startEdit}>編集</button>
        </div>
      )}
    </div>
  );
}

const ALL_CAPABILITIES: readonly WorkerCapability[] = ["code", "research", "write", "plan", "image", "general"];

export type AddWorkerInput =
  | { kind: "cli"; name: string; binary: string; args: string[]; capabilities: WorkerCapability[] }
  | { kind: "mcp"; name: string; command: string; args: string[]; tool: string; promptParam?: string; capabilities: WorkerCapability[] };

/** Splits an argv template on whitespace, honoring "double quoted" spans as a single argument. */
function parseArgs(text: string): string[] {
  const args: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    args.push(match[1] ?? match[2] ?? "");
  }
  return args;
}

/** Registers a CommandWorker or MCPWorker at runtime (spec §10, completion checklist "Workerを追加できる") — any CLI or MCP server, no code change. */
function AddWorkerDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (input: AddWorkerInput) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<"cli" | "mcp">("cli");
  const [name, setName] = useState("");
  const [binary, setBinary] = useState("");
  const [argsText, setArgsText] = useState("{prompt}");
  const [mcpArgsText, setMcpArgsText] = useState("");
  const [tool, setTool] = useState("");
  const [promptParam, setPromptParam] = useState("");
  const [capabilities, setCapabilities] = useState<WorkerCapability[]>(["general"]);
  const [busy, setBusy] = useState(false);

  const toggleCap = (c: WorkerCapability) => {
    setCapabilities((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const canSubmit =
    Boolean(name.trim()) &&
    capabilities.length > 0 &&
    (kind === "cli" ? Boolean(binary.trim()) : Boolean(binary.trim()) && Boolean(tool.trim()));

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    const ok =
      kind === "cli"
        ? await onAdd({
            kind: "cli",
            name: name.trim(),
            binary: binary.trim(),
            args: parseArgs(argsText),
            capabilities,
          })
        : await onAdd({
            kind: "mcp",
            name: name.trim(),
            command: binary.trim(),
            args: parseArgs(mcpArgsText),
            tool: tool.trim(),
            ...(promptParam.trim() ? { promptParam: promptParam.trim() } : {}),
            capabilities,
          });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <div className="rk-workers__overlay" onClick={() => !busy && onClose()}>
      <div className="rk-workers__dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="rk-workers__dialog-title">ワーカーを追加</div>
        <div className="rk-workers__dialog-sub">
          {kind === "cli"
            ? <>このマシン上の任意のCLIをワーカーとして接続します。タスクプロンプトを挿入したい位置には引数内で <code>{"{prompt}"}</code> を使用します — 省略した場合、プロンプトは最後の引数として追加されます。</>
            : <>任意のMCPサーバー (stdio) をワーカーとして接続します。JARVISが起動してMCPハンドシェイクを行い、指定したツールをタスクプロンプトとともに呼び出します。</>}
        </div>
        <div className="rk-workers__flab">タイプ</div>
        <Select value={kind} onChange={(e) => setKind(e.target.value as "cli" | "mcp")}>
          <option value="cli">CLI</option>
          <option value="mcp">MCPサーバー</option>
        </Select>
        <div className="rk-workers__flab">名前</div>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my_tool" autoFocus />
        <div className="rk-workers__flab">{kind === "cli" ? "実行ファイル" : "コマンド"}</div>
        <Input value={binary} onChange={(e) => setBinary(e.target.value)} placeholder={kind === "cli" ? "my-tool" : "my-mcp-server"} />
        {kind === "cli" ? (
          <>
            <div className="rk-workers__flab">引数 (スペース区切り)</div>
            <Input value={argsText} onChange={(e) => setArgsText(e.target.value)} placeholder="-p {prompt} --quiet" mono />
          </>
        ) : (
          <>
            <div className="rk-workers__flab">サーバー引数 (スペース区切り、任意)</div>
            <Input value={mcpArgsText} onChange={(e) => setMcpArgsText(e.target.value)} placeholder="--stdio" mono />
            <div className="rk-workers__flab">ツール</div>
            <Input value={tool} onChange={(e) => setTool(e.target.value)} placeholder="search" />
            <div className="rk-workers__flab">プロンプト引数名 (任意、デフォルト "prompt")</div>
            <Input value={promptParam} onChange={(e) => setPromptParam(e.target.value)} placeholder="prompt" />
          </>
        )}
        <div className="rk-workers__flab">能力</div>
        <div className="rk-workers__card-caps">
          {ALL_CAPABILITIES.map((c) => (
            <button
              key={c}
              className={`rk-workers__cap${capabilities.includes(c) ? " rk-workers__cap--on" : ""}`}
              onClick={() => toggleCap(c)}
              type="button"
            >
              {c}
            </button>
          ))}
        </div>
        <div className="rk-workers__runacts">
          <button className="rk-workers__sbtn" onClick={onClose} disabled={busy}>キャンセル</button>
          <button className="rk-workers__sbtn rk-workers__sbtn--pri" disabled={!canSubmit || busy} onClick={submit}>
            {busy ? "追加中…" : "追加"}
          </button>
        </div>
      </div>
    </div>
  );
}
