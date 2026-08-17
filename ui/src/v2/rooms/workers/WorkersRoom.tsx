import React, { useMemo, useState, useEffect } from "react";
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
} from "./useWorkersData";
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

export function WorkersRoomBody({ mode }: { mode: RoomBodyMode }) {
  const data = useWorkersData();
  const [runOpen, setRunOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const selectedHandoff = useMemo(
    () => data.handoffs.find((h) => h.task_id === selectedTaskId) ?? null,
    [data.handoffs, selectedTaskId],
  );

  return (
    <div className={`rk-workers rk-workers--${mode}`} style={{ position: "relative" }}>
      <div className="rk-workers__tool">
        <span className="rk-workers__title">Workers</span>
        <span className="rk-workers__sub">AI status · task · handoff</span>
        <button className="rk-workers__icbtn" onClick={data.refresh} aria-label="Refresh">
          <Icon icon={RefreshCw} size="sm" />
        </button>
        <button className="rk-workers__new" onClick={() => setAddOpen(true)}>Add worker</button>
        <button className="rk-workers__new" onClick={() => setRunOpen((v) => !v)}>
          {runOpen ? "Close" : "Run task"}
        </button>
      </div>

      {runOpen && (
        <RunPanel
          workers={data.workers}
          busy={data.running}
          onRun={async (input) => {
            const r = await data.runTask(input);
            if (r.ok) {
              setToast({
                text: `${r.outcome.worker}: ${r.outcome.result.status}`,
                tone: r.outcome.result.status === "completed" ? "ok" : "warn",
              });
              setSelectedTaskId(input.task_id);
              setRunOpen(false);
            } else {
              setToast({ text: r.message, tone: "warn" });
            }
            return r.ok;
          }}
        />
      )}

      <div className="rk-workers__body">
        <div className="rk-workers__cards">
          {data.loading && data.workers.length === 0 ? (
            <Skeleton lines={4} />
          ) : data.workers.length === 0 ? (
            <EmptyState title="No Workers registered">
              JARVIS didn't find any external AI Workers on this daemon.
            </EmptyState>
          ) : (
            data.workers.map((w) => (
              <WorkerCard
                key={w.name}
                worker={w}
                onToggle={async (enabled) => {
                  const r = await data.setEnabled(w.name, enabled);
                  setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
                }}
                onRemove={
                  w.type === "custom"
                    ? async () => {
                        const r = await data.removeWorker(w.name);
                        setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
                      }
                    : undefined
                }
              />
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
              <EmptyState title="No handoffs yet">
                Run a task and its Handoff will show up here — the same file an external AI Worker reads to hand work back.
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

      {toast && <div className="rk-workers__toast"><Toast tone={toast.tone === "ok" ? "ok" : "hold"}>{toast.text}</Toast></div>}
    </div>
  );
}

export function WorkersRoom() {
  return (
    <RoomShell title="Workers" subtitle="AI status · task · handoff" breadcrumb={["Workers"]}>
      <WorkersRoomBody mode="expanded" />
    </RoomShell>
  );
}

function WorkerCard({
  worker,
  onToggle,
  onRemove,
}: {
  worker: WorkerSummary;
  onToggle: (enabled: boolean) => void;
  onRemove?: () => void;
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
        <span>timeout {Math.round(worker.timeout_ms / 1000)}s</span>
        <span>retry {worker.retry}</span>
      </div>
      <div className="rk-workers__card-toggle">
        <span className="rk-workers__flab" style={{ marginBottom: 0 }}>enabled</span>
        <Switch on={worker.enabled} onClick={() => onToggle(!worker.enabled)} />
      </div>
      {onRemove && (
        <button className="rk-workers__sbtn" onClick={onRemove}>Remove</button>
      )}
    </div>
  );
}

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
        <div className="rk-workers__card-meta">files: {handoff.files.join(", ")}</div>
      )}
      <div className="rk-workers__card-meta">next: {handoff.next_action}</div>
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

  const submit = async () => {
    if (!prompt.trim() || busy) return;
    const ok = await onRun({
      task_id: `task_${Date.now()}`,
      template,
      prompt: prompt.trim(),
      ...(worker ? { worker } : {}),
    });
    if (ok) setPrompt("");
  };

  return (
    <div className="rk-workers__runpanel">
      <div className="rk-workers__runrow">
        <div>
          <div className="rk-workers__flab">template</div>
          <Select value={template} onChange={(e) => setTemplate(e.target.value as TaskTemplate)}>
            {TEMPLATES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </div>
        <div>
          <div className="rk-workers__flab">worker (optional)</div>
          <Select value={worker} onChange={(e) => setWorker(e.target.value)}>
            <option value="">auto (Router picks)</option>
            {workers.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
          </Select>
        </div>
      </div>
      <div>
        <div className="rk-workers__flab">prompt</div>
        <textarea
          className="rk-workers__textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should this Worker do?"
          autoFocus
        />
      </div>
      <div className="rk-workers__runacts">
        <button className="rk-workers__sbtn rk-workers__sbtn--pri" disabled={busy || !prompt.trim()} onClick={submit}>
          {busy ? "Running…" : "Run"}
        </button>
      </div>
    </div>
  );
}

const ALL_CAPABILITIES: readonly WorkerCapability[] = ["code", "research", "write", "plan", "image", "general"];

/** Registers a CommandWorker at runtime (spec §10, completion checklist "Workerを追加できる") — any CLI, no code change. */
function AddWorkerDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (input: { name: string; binary: string; args: string[]; capabilities: WorkerCapability[] }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [binary, setBinary] = useState("");
  const [argsText, setArgsText] = useState("{prompt}");
  const [capabilities, setCapabilities] = useState<WorkerCapability[]>(["general"]);
  const [busy, setBusy] = useState(false);

  const toggleCap = (c: WorkerCapability) => {
    setCapabilities((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const canSubmit = name.trim() && binary.trim() && capabilities.length > 0;

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    const args = argsText.split(/\s+/).filter(Boolean);
    const ok = await onAdd({ name: name.trim(), binary: binary.trim(), args, capabilities });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <div className="rk-workers__overlay" onClick={() => !busy && onClose()}>
      <div className="rk-workers__dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="rk-workers__dialog-title">Add worker</div>
        <div className="rk-workers__dialog-sub">
          Wires in any CLI already on this machine as a Worker. Use <code>{"{prompt}"}</code> in args where the task prompt should go — omit it and the prompt is appended as the last argument.
        </div>
        <div className="rk-workers__flab">name</div>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my_tool" autoFocus />
        <div className="rk-workers__flab">binary</div>
        <Input value={binary} onChange={(e) => setBinary(e.target.value)} placeholder="my-tool" />
        <div className="rk-workers__flab">args (space-separated)</div>
        <Input value={argsText} onChange={(e) => setArgsText(e.target.value)} placeholder="-p {prompt} --quiet" mono />
        <div className="rk-workers__flab">capabilities</div>
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
          <button className="rk-workers__sbtn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="rk-workers__sbtn rk-workers__sbtn--pri" disabled={!canSubmit || busy} onClick={submit}>
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
