import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Icon } from "../../ui";
import { StatusChip, EmptyState, Skeleton, Toast, type Tone } from "../../ui/roomkit";
import { RoomShell } from "../RoomShell";
import {
  useAIManagerData,
  type Project,
  type ProjectStatus,
  type ProjectTask,
  type ProjectTaskStatus,
  type Handoff,
  type AgentPerformance,
  type CouncilVerdict,
} from "./useAIManagerData";
import "./AIManagerRoom.css";

export type RoomBodyMode = "inline" | "expanded";

const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  active: "run",
  paused: "hold",
  completed: "ok",
  archived: "mut",
};

const TASK_COLUMNS: ProjectTaskStatus[] = [
  "PENDING", "PLANNING", "READY", "RUNNING", "WAITING", "BLOCKED", "REVIEW", "QA", "COMPLETED", "FAILED", "CANCELLED",
];

const TASK_STATUS_TONE: Record<ProjectTaskStatus, Tone> = {
  PENDING: "mut", PLANNING: "mut", READY: "mut", RUNNING: "run", WAITING: "hold",
  BLOCKED: "hold", REVIEW: "hold", QA: "hold", COMPLETED: "ok", FAILED: "fail", CANCELLED: "mut",
};

export function AIManagerRoomBody({ mode }: { mode: RoomBodyMode }) {
  const data = useAIManagerData();
  const [createOpen, setCreateOpen] = useState(false);
  const [councilOpen, setCouncilOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const selected = useMemo(
    () => data.projects.find((p) => p.id === data.selectedId) ?? null,
    [data.projects, data.selectedId],
  );

  const byStatus = useMemo(() => {
    const map = new Map<ProjectTaskStatus, ProjectTask[]>();
    for (const s of TASK_COLUMNS) map.set(s, []);
    for (const t of data.tasks) {
      if (t.project_status) map.get(t.project_status)?.push(t);
    }
    return map;
  }, [data.tasks]);

  const occupiedColumns = TASK_COLUMNS.filter(
    (s) => s === "PENDING" || s === "RUNNING" || s === "COMPLETED" || (byStatus.get(s)?.length ?? 0) > 0,
  );

  return (
    <div className="rk-aim">
      <div className="rk-aim__tool">
        <span className="rk-aim__title">AI Manager</span>
        <span className="rk-aim__sub">projects · tasks · decisions</span>
        <button className="rk-aim__icbtn" onClick={data.refresh} aria-label="Refresh">
          <Icon icon={RefreshCw} size="sm" />
        </button>
        <button className="rk-aim__new" onClick={() => setCreateOpen(true)}>New project</button>
      </div>

      <div className="rk-aim__body">
        <div className="rk-aim__list">
          {data.error ? (
            <div className="rk-aim__msg">{data.error}</div>
          ) : data.loading && data.projects.length === 0 ? (
            <div className="rk-aim__empty"><Skeleton lines={4} /></div>
          ) : data.projects.length === 0 ? (
            <div className="rk-aim__empty">
              <EmptyState title="No projects yet">
                Press <b>New project</b> to describe what you want done — JARVIS plans it into tasks and runs them.
              </EmptyState>
            </div>
          ) : (
            data.projects.map((p) => (
              <ProjectRow key={p.id} project={p} selected={p.id === data.selectedId} onClick={() => data.selectProject(p.id)} />
            ))
          )}
        </div>

        <div className="rk-aim__detail">
          {!selected ? (
            <div className="rk-aim__empty"><EmptyState title="Select a project">Pick a project on the left to see its task board and decisions.</EmptyState></div>
          ) : (
            <>
              <div className="rk-aim__dh">
                <div>
                  <div className="rk-aim__dn">{selected.name}</div>
                  <div className="rk-aim__dm">{selected.template} · {selected.execution_mode}</div>
                </div>
                <StatusChip tone={PROJECT_STATUS_TONE[selected.status]} dot>{selected.status}</StatusChip>
                <button className="rk-aim__council-btn" onClick={() => setCouncilOpen(true)}>Ask the Council</button>
                {selected.status === "active" && (
                  <button
                    className="rk-aim__sbtn"
                    onClick={async () => {
                      const r = await data.updateStatus(selected.id, "paused");
                      setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
                    }}
                  >
                    Pause
                  </button>
                )}
              </div>

              {selected.description && <div className="rk-aim__desc">{selected.description}</div>}

              {data.detailLoading && data.tasks.length === 0 ? (
                <div className="rk-aim__empty"><Skeleton lines={4} /></div>
              ) : (
                <div className="rk-aim__board">
                  {occupiedColumns.map((status) => {
                    const items = byStatus.get(status) ?? [];
                    return (
                      <div className="rk-aim__col" key={status}>
                        <div className="rk-aim__colh">{status.toLowerCase()}<span className="c">{items.length}</span></div>
                        <div className="rk-aim__col-scroll">
                          {items.length === 0 ? (
                            <div className="rk-aim__col-empty">—</div>
                          ) : (
                            items.map((t) => (
                              <TaskCard
                                key={t.id}
                                task={t}
                                onResume={async (input) => {
                                  const r = await data.resumeTask(selected.id, t.id, input);
                                  setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
                                }}
                              />
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="rk-aim__decisions">
                <div className="rk-aim__dlabel">decisions</div>
                {data.decisions.length === 0 ? (
                  <div className="rk-aim__col-empty">No decisions recorded yet.</div>
                ) : (
                  data.decisions.map((d) => (
                    <div key={d.id} className="rk-aim__decision">
                      <div className="rk-aim__decision-statement">{d.statement}</div>
                      {d.reason && <div className="rk-aim__decision-reason">{d.reason}</div>}
                      <div className="rk-aim__decision-meta">{d.made_by} · {new Date(d.created_at).toLocaleDateString()}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="rk-aim__handoffs">
                <div className="rk-aim__dlabel">handoffs</div>
                {data.handoffs.length === 0 ? (
                  <div className="rk-aim__col-empty">No handoffs filed yet.</div>
                ) : (
                  data.handoffs.map((h) => <HandoffCard key={h.id} handoff={h} />)
                )}
              </div>

              {data.agentPerformance.length > 0 && (
                <div className="rk-aim__perf">
                  <div className="rk-aim__dlabel">agent performance</div>
                  {data.agentPerformance.map((p) => (
                    <AgentPerformanceRow key={p.agent} perf={p} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {createOpen && (
        <CreateProjectDialog
          busy={data.running}
          onClose={() => setCreateOpen(false)}
          onCreate={async (input) => {
            const r = await data.runProject(input);
            setToast({ text: r.ok ? `Project "${input.name}" is running.` : r.message, tone: r.ok ? "ok" : "warn" });
            if (r.ok) setCreateOpen(false);
            return r.ok;
          }}
        />
      )}

      {councilOpen && selected && (
        <CouncilDialog
          onClose={() => setCouncilOpen(false)}
          onAsk={(question) => data.askCouncil(selected.id, question)}
        />
      )}

      {toast && <div className="rk-aim__toast"><Toast tone={toast.tone === "ok" ? "ok" : "hold"}>{toast.text}</Toast></div>}
    </div>
  );
}

export function AIManagerRoom() {
  return (
    <RoomShell title="AI Manager" subtitle="projects · tasks · decisions" breadcrumb={["AI Manager"]}>
      <AIManagerRoomBody mode="expanded" />
    </RoomShell>
  );
}

function ProjectRow({ project, selected, onClick }: { project: Project; selected: boolean; onClick: () => void }) {
  return (
    <button className={`rk-aim__row${selected ? " rk-aim__row--sel" : ""}`} onClick={onClick}>
      <span className="rk-aim__row-t">{project.name}</span>
      <span className="rk-aim__row-end">
        <StatusChip tone={PROJECT_STATUS_TONE[project.status]}>{project.status}</StatusChip>
      </span>
    </button>
  );
}

function TaskCard({ task, onResume }: { task: ProjectTask; onResume: (input: string) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [resumeInput, setResumeInput] = useState("");
  const [resuming, setResuming] = useState(false);
  const hasQaReport = task.qa_report !== null;
  const isWaiting = task.project_status === "WAITING";

  return (
    <div className="rk-aim__card" onClick={() => (hasQaReport || isWaiting) && setExpanded((e) => !e)}>
      <div className="rk-aim__card-t">{task.title ?? "Untitled task"}</div>
      <div className="rk-aim__card-meta">
        <StatusChip tone={task.project_status ? TASK_STATUS_TONE[task.project_status] : "mut"}>{task.priority}</StatusChip>
        {task.assigned_agent && <span className="rk-aim__asg">{task.assigned_agent}</span>}
        {task.retry_count > 0 && <span className="rk-aim__asg">retry {task.retry_count}/{task.max_retries}</span>}
      </div>

      {expanded && hasQaReport && task.qa_report && (
        <div className="rk-aim__card-qa">
          {task.qa_report.checks.map((c) => (
            <div key={c.name} className={`rk-aim__qa-check ${c.automated && !c.passed ? "rk-aim__qa-check--fail" : "rk-aim__qa-check--pass"}`}>
              <span>{c.automated ? (c.passed ? "✓" : "✗") : "–"}</span>
              <span className="rk-aim__qa-check-name">{c.name}</span>
              <span className="rk-aim__qa-check-summary">{c.summary}</span>
            </div>
          ))}
        </div>
      )}

      {expanded && isWaiting && (
        <div className="rk-aim__resume" onClick={(e) => e.stopPropagation()}>
          <div className="rk-aim__resume-q">This task is waiting for your input to continue.</div>
          <div className="rk-aim__resume-row">
            <input
              className="rk-aim__resume-input"
              value={resumeInput}
              onChange={(e) => setResumeInput(e.target.value)}
              placeholder="Type your answer…"
              onKeyDown={(e) => e.key === "Enter" && resumeInput.trim() && !resuming && void submitResume()}
            />
            <button
              className="rk-aim__sbtn rk-aim__sbtn--pri"
              disabled={!resumeInput.trim() || resuming}
              onClick={() => void submitResume()}
            >
              {resuming ? "…" : "Resume"}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  async function submitResume() {
    setResuming(true);
    try {
      await onResume(resumeInput.trim());
      setResumeInput("");
    } finally {
      setResuming(false);
    }
  }
}

function HandoffCard({ handoff }: { handoff: Handoff }) {
  const h = handoff.handoff;
  return (
    <div className="rk-aim__handoff">
      <div className="rk-aim__handoff-route">{handoff.from_agent} → {handoff.to_agent}</div>
      <div className="rk-aim__handoff-summary">{h?.summary ?? "(non-handoff report)"}</div>
      {h && h.open_questions.length > 0 && (
        <div className="rk-aim__handoff-meta">Open question: {h.open_questions.join("; ")}</div>
      )}
      {h && h.warnings.length > 0 && <div className="rk-aim__handoff-meta">⚠ {h.warnings.join("; ")}</div>}
      <div className="rk-aim__handoff-meta">{h?.status ?? handoff.priority} · {new Date(handoff.created_at).toLocaleString()}</div>
    </div>
  );
}

function AgentPerformanceRow({ perf }: { perf: AgentPerformance }) {
  const successPct = perf.success_rate !== null ? `${Math.round(perf.success_rate * 100)}%` : "—";
  const avgDuration = perf.average_duration_ms !== null ? `${Math.round(perf.average_duration_ms / 1000)}s avg` : "";
  return (
    <div className="rk-aim__perf-row">
      <span className="rk-aim__perf-agent">{perf.agent}</span>
      <span className="rk-aim__perf-stat">{perf.tasks_completed} done</span>
      {perf.tasks_failed > 0 && <span className="rk-aim__perf-stat">{perf.tasks_failed} failed</span>}
      <span className="rk-aim__perf-stat">{successPct} success</span>
      {avgDuration && <span className="rk-aim__perf-stat">{avgDuration}</span>}
    </div>
  );
}

function CouncilDialog({
  onClose,
  onAsk,
}: {
  onClose: () => void;
  onAsk: (question: string) => Promise<{ ok: true; verdict: CouncilVerdict } | { ok: false; message: string }>;
}) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<CouncilVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await onAsk(question.trim());
    if (r.ok) setVerdict(r.verdict);
    else setError(r.message);
    setBusy(false);
  };

  return (
    <div className="rk-aim__overlay" onClick={() => !busy && onClose()}>
      <div className="rk-aim__dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="rk-aim__dialog-head">
          <div className="rk-aim__dialog-title">Ask the Council</div>
          <div className="rk-aim__dialog-sub">Fans a question out to Cheap/Balanced/Quality seats in parallel, then synthesizes a verdict. Recorded as a project Decision.</div>
        </div>
        <div className="rk-aim__dialog-body">
          {!verdict ? (
            <div>
              <div className="rk-aim__flab">question</div>
              <textarea
                className="rk-aim__textarea"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What should the council weigh in on?"
                rows={3}
                autoFocus
              />
              {error && <div className="rk-aim__msg">{error}</div>}
            </div>
          ) : (
            <div>
              {verdict.opinions.map((op) => (
                <div key={op.seat} className="rk-aim__council-opinion">
                  <div className="rk-aim__council-opinion-head">{op.seat} ({op.mode}){op.confidence !== null ? ` · confidence ${Math.round(op.confidence * 100)}%` : ""}</div>
                  <div>{op.error ? `Error: ${op.error}` : op.content}</div>
                </div>
              ))}
              {verdict.contradictions.length > 0 && (
                <div className="rk-aim__msg">Contradictions: {verdict.contradictions.join("; ")}</div>
              )}
              <div className="rk-aim__dlabel" style={{ marginTop: 8 }}>synthesis</div>
              <div className="rk-aim__council-synthesis">{verdict.synthesis}</div>
            </div>
          )}
        </div>
        <div className="rk-aim__dialog-acts">
          <button className="rk-aim__sbtn" onClick={onClose}>{verdict ? "Close" : "Cancel"}</button>
          {!verdict && (
            <button className="rk-aim__sbtn rk-aim__sbtn--pri" onClick={ask} disabled={busy || !question.trim()}>
              {busy ? "Convening…" : "Convene"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateProjectDialog({
  busy,
  onClose,
  onCreate,
}: {
  busy: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; request: string }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [request, setRequest] = useState("");

  const submit = async () => {
    if (!name.trim() || !request.trim()) return;
    await onCreate({ name: name.trim(), request: request.trim() });
  };

  return (
    <div className="rk-aim__overlay" onClick={() => !busy && onClose()}>
      <div className="rk-aim__dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="rk-aim__dialog-head">
          <div className="rk-aim__dialog-title">New project</div>
          <div className="rk-aim__dialog-sub">Describe what you want done. JARVIS plans it into tasks and runs them — this can take a while for multi-step projects.</div>
        </div>
        <div className="rk-aim__dialog-body">
          <div>
            <div className="rk-aim__flab">name</div>
            <input className="rk-aim__input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Transfer Chronicle" autoFocus />
          </div>
          <div>
            <div className="rk-aim__flab">request</div>
            <textarea className="rk-aim__textarea" value={request} onChange={(e) => setRequest(e.target.value)} placeholder="What should JARVIS build or do?" rows={4} />
          </div>
        </div>
        <div className="rk-aim__dialog-acts">
          <button className="rk-aim__sbtn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="rk-aim__sbtn rk-aim__sbtn--pri" onClick={submit} disabled={busy || !name.trim() || !request.trim()}>
            {busy ? "Running…" : "Start project"}
          </button>
        </div>
      </div>
    </div>
  );
}
