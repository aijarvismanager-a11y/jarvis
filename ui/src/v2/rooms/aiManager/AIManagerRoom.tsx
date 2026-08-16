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
  type CostMode,
  type ExecutionMode,
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

const COST_MODES: readonly CostMode[] = ["cheap", "balanced", "quality"];
const EXECUTION_MODES: readonly ExecutionMode[] = ["auto", "assisted", "manual"];

/** Shared with the Cinematic Shell's Focus Mode (Phase 35) so both surfaces use one status vocabulary. */
export const TASK_STATUS_TONE: Record<ProjectTaskStatus, Tone> = {
  PENDING: "mut", PLANNING: "mut", READY: "mut", RUNNING: "run", WAITING: "hold",
  BLOCKED: "hold", REVIEW: "hold", QA: "hold", COMPLETED: "ok", FAILED: "fail", CANCELLED: "mut",
};

export function AIManagerRoomBody({ mode }: { mode: RoomBodyMode }) {
  const data = useAIManagerData();
  const [createOpen, setCreateOpen] = useState(false);
  const [councilOpen, setCouncilOpen] = useState(false);
  const [githubActionOpen, setGithubActionOpen] = useState(false);
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

  // Phase 15-C: a superseded self-healing retry gets its own `tasks` row,
  // CANCELLED with parent_task_id pointing at the winning task (see
  // manager-agent.ts runSubtask), specifically so it stays queryable rather
  // than project_id=NULL. It's not a real board item - nest it under the
  // winning task instead of showing it as a loose CANCELLED card.
  const priorAttemptsByParent = useMemo(() => {
    const map = new Map<string, ProjectTask[]>();
    for (const t of data.tasks) {
      if (t.parent_task_id && t.project_status === "CANCELLED") {
        const list = map.get(t.parent_task_id) ?? [];
        list.push(t);
        map.set(t.parent_task_id, list);
      }
    }
    return map;
  }, [data.tasks]);

  const byStatus = useMemo(() => {
    const map = new Map<ProjectTaskStatus, ProjectTask[]>();
    for (const s of TASK_COLUMNS) map.set(s, []);
    for (const t of data.tasks) {
      if (t.parent_task_id && t.project_status === "CANCELLED") continue;
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
                  <div className="rk-aim__dm">{selected.template}</div>
                </div>
                <select
                  className="rk-aim__cost-select"
                  value={selected.execution_mode}
                  onChange={async (e) => {
                    const r = await data.updateExecutionMode(selected.id, e.target.value as ExecutionMode);
                    setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
                  }}
                  aria-label="Execution mode"
                  title="Auto/Assisted/Manual — how often the Manager pauses for confirmation"
                >
                  {EXECUTION_MODES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <select
                  className="rk-aim__cost-select"
                  value={selected.cost_mode}
                  onChange={async (e) => {
                    const r = await data.updateCostMode(selected.id, e.target.value as CostMode);
                    setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
                  }}
                  aria-label="Cost mode"
                  title="Cheap/Balanced/Quality — overrides each subtask template's default tier"
                >
                  {COST_MODES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <StatusChip tone={PROJECT_STATUS_TONE[selected.status]} dot>{selected.status}</StatusChip>
                {/* Phase 20-B: completed_at was already typed/fetched but never rendered. */}
                {selected.status === "completed" && selected.completed_at && (
                  <span className="rk-aim__dh-completed">Completed {new Date(selected.completed_at).toLocaleString()}</span>
                )}
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

              <RulesEditor
                rules={selected.rules}
                onSave={async (rules) => {
                  const r = await data.updateProjectRules(selected.id, rules);
                  setToast({ text: r.message, tone: r.ok ? "ok" : "warn" });
                }}
              />

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
                                allTasks={data.tasks}
                                priorAttempts={priorAttemptsByParent.get(t.id) ?? []}
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

              <div className="rk-aim__handoffs">
                <div className="rk-aim__dh">
                  <div className="rk-aim__dlabel" title="Not project-scoped — audit_trail has no project_id, so this is recent git/GitHub tool activity daemon-wide.">
                    recent github activity
                  </div>
                  <button className="rk-aim__sbtn" onClick={() => setGithubActionOpen(true)}>GitHub action</button>
                </div>
                {data.githubActivity.length === 0 ? (
                  <div className="rk-aim__col-empty">No GitHub activity yet.</div>
                ) : (
                  data.githubActivity.map((g) => (
                    <div key={g.id} className="rk-aim__decision">
                      <div className="rk-aim__decision-statement">{g.tool_name}</div>
                      <div className="rk-aim__decision-meta">
                        {g.authority_decision}{g.executed ? "" : " · not executed"} · {new Date(g.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))
                )}
              </div>
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

      {githubActionOpen && (
        <GitHubActionDialog
          onClose={() => setGithubActionOpen(false)}
          onRun={data.githubAction}
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

function TaskCard({
  task,
  allTasks,
  priorAttempts,
  onResume,
}: {
  task: ProjectTask;
  allTasks: ProjectTask[];
  priorAttempts: ProjectTask[];
  onResume: (input: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [resumeInput, setResumeInput] = useState("");
  const [resuming, setResuming] = useState(false);
  const hasQaReport = task.qa_report !== null;
  const isWaiting = task.project_status === "WAITING";
  const hasHealingDetail = task.healing_attempts.length > 0;
  const hasArtifacts = task.artifacts.length > 0;
  const hasDependencies = task.dependencies.length > 0;

  return (
    <div className="rk-aim__card" onClick={() => (hasQaReport || isWaiting || hasHealingDetail || hasArtifacts || hasDependencies) && setExpanded((e) => !e)}>
      <div className="rk-aim__card-t">{task.title ?? "Untitled task"}</div>
      <div className="rk-aim__card-meta">
        <StatusChip tone={task.project_status ? TASK_STATUS_TONE[task.project_status] : "mut"}>{task.priority}</StatusChip>
        {task.assigned_agent && <span className="rk-aim__asg">{task.assigned_agent}</span>}
        {task.assigned_provider && (
          <span className="rk-aim__asg">{task.assigned_provider}{task.assigned_model ? `/${task.assigned_model}` : ""}</span>
        )}
        {task.retry_count > 0 && <span className="rk-aim__asg">retry {task.retry_count}/{task.max_retries}</span>}
        {task.next_agent && <span className="rk-aim__asg">→ {task.next_agent}</span>}
        {task.approval_required && <span className="rk-aim__asg">needs approval</span>}
      </div>

      {expanded && hasDependencies && (
        <div className="rk-aim__card-qa">
          {task.dependencies.map((depId) => {
            const dep = allTasks.find((x) => x.id === depId);
            return (
              <div key={depId} className="rk-aim__qa-check">
                <span>·</span>
                <span className="rk-aim__qa-check-name">{dep?.title ?? depId}</span>
                {dep?.project_status && <span className="rk-aim__qa-check-summary">{dep.project_status.toLowerCase()}</span>}
              </div>
            );
          })}
        </div>
      )}

      {expanded && hasArtifacts && (
        <div className="rk-aim__card-qa">
          {task.artifacts.map((path) => (
            <div key={path} className="rk-aim__qa-check">
              <span>·</span>
              <span className="rk-aim__qa-check-name">{path}</span>
            </div>
          ))}
        </div>
      )}

      {expanded && hasHealingDetail && (
        <div className="rk-aim__card-qa">
          {task.healing_attempts.map((a) => {
            const isFinal = a.attempt === task.healing_attempts.length;
            return (
              <div key={a.attempt} className="rk-aim__qa-check">
                <span>{a.attempt}</span>
                <span className="rk-aim__qa-check-name">{a.strategy}</span>
                <span className="rk-aim__qa-check-summary">
                  {a.template}/{a.mode}
                  {a.failure_class !== "none" ? ` — ${a.failure_class}` : ""}
                  {isFinal ? "" : " (superseded)"}
                </span>
              </div>
            );
          })}
          {priorAttempts.length > 0 && (
            <div className="rk-aim__qa-check-summary">
              {priorAttempts.length} prior attempt task{priorAttempts.length === 1 ? "" : "s"} kept for reference.
            </div>
          )}
        </div>
      )}

      {expanded && hasQaReport && task.qa_report && (
        <div className="rk-aim__card-qa">
          {/* Phase 21-B: ran_at was already fetched/typed on qa_report but
              never rendered - no indication anywhere of when QA last ran. */}
          <div className="rk-aim__qa-ran-at">QA ran {new Date(task.qa_report.ran_at).toLocaleString()}</div>
          {task.qa_report.checks.map((c) => (
            <div key={c.name} className={`rk-aim__qa-check ${c.automated && !c.passed ? "rk-aim__qa-check--fail" : "rk-aim__qa-check--pass"}`}>
              <span>{c.automated ? (c.passed ? "✓" : "✗") : "–"}</span>
              <span className="rk-aim__qa-check-name">{c.name}</span>
              <span className="rk-aim__qa-check-summary">{c.summary}</span>
              {/* Phase 18-B: `detail` was fetched/typed but never rendered -
                  only surface it for a failed check, where it's the useful
                  diagnostic beyond the one-line summary. */}
              {c.automated && !c.passed && c.detail && (
                <span className="rk-aim__qa-check-detail">{c.detail}</span>
              )}
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

/** Phase 16-A: `project.rules` live-editable list, mirrors the decisions/handoffs list styling. */
function RulesEditor({ rules, onSave }: { rules: string[]; onSave: (rules: string[]) => Promise<void> }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const addRule = async () => {
    const trimmed = draft.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onSave([...rules, trimmed]);
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  const removeRule = async (index: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(rules.filter((_, i) => i !== index));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rk-aim__decisions">
      <div className="rk-aim__dlabel">rules</div>
      {rules.length === 0 ? (
        <div className="rk-aim__col-empty">No rules set — the Manager follows only the project request.</div>
      ) : (
        rules.map((rule, i) => (
          <div key={i} className="rk-aim__decision">
            <div className="rk-aim__decision-statement">{rule}</div>
            <button className="rk-aim__sbtn" style={{ marginTop: 6 }} disabled={busy} onClick={() => void removeRule(i)}>
              Remove
            </button>
          </div>
        ))
      )}
      <div className="rk-aim__resume-row">
        <input
          className="rk-aim__resume-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a rule…"
          onKeyDown={(e) => e.key === "Enter" && draft.trim() && !busy && void addRule()}
        />
        <button className="rk-aim__sbtn rk-aim__sbtn--pri" disabled={!draft.trim() || busy} onClick={() => void addRule()}>
          Add
        </button>
      </div>
    </div>
  );
}

function HandoffCard({ handoff }: { handoff: Handoff }) {
  const h = handoff.handoff;
  return (
    <div className="rk-aim__handoff">
      <div className="rk-aim__handoff-route">{handoff.from_agent} → {handoff.to_agent}</div>
      <div className="rk-aim__handoff-summary">{h?.summary ?? "(non-handoff report)"}</div>
      {/* Phase 21-A: instructions/artifacts/decisions were already returned
          by the server on every handoff but the type didn't declare them. */}
      {h && h.instructions.length > 0 && (
        <div className="rk-aim__handoff-meta">Instructions: {h.instructions.join("; ")}</div>
      )}
      {h && h.artifacts.length > 0 && (
        <div className="rk-aim__handoff-meta">Artifacts: {h.artifacts.join("; ")}</div>
      )}
      {h && h.decisions.length > 0 && (
        <div className="rk-aim__handoff-meta">Decisions: {h.decisions.join("; ")}</div>
      )}
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
  // Phase 19-C: llm_error_rate/tasks_cancelled/providers_used/models_used
  // were already computed by getAgentPerformance and typed here, but never
  // rendered.
  const llmErrorPct = perf.llm_error_rate !== null ? `${Math.round(perf.llm_error_rate * 100)}% LLM errors` : "";
  // Phase 20-A: llm_calls was already computed by getAgentPerformance and
  // typed here, but never rendered.
  return (
    <div className="rk-aim__perf-row">
      <span className="rk-aim__perf-agent">{perf.agent}</span>
      <span className="rk-aim__perf-stat">{perf.tasks_completed} done</span>
      {perf.tasks_failed > 0 && <span className="rk-aim__perf-stat">{perf.tasks_failed} failed</span>}
      {perf.tasks_cancelled > 0 && <span className="rk-aim__perf-stat">{perf.tasks_cancelled} cancelled</span>}
      <span className="rk-aim__perf-stat">{successPct} success</span>
      {avgDuration && <span className="rk-aim__perf-stat">{avgDuration}</span>}
      {perf.llm_calls > 0 && <span className="rk-aim__perf-stat">{perf.llm_calls} LLM calls</span>}
      {llmErrorPct && <span className="rk-aim__perf-stat">{llmErrorPct}</span>}
      {(perf.providers_used.length > 0 || perf.models_used.length > 0) && (
        <div className="rk-aim__perf-models">
          {perf.providers_used.length > 0 && (
            <span className="rk-aim__perf-models-item">{perf.providers_used.join(", ")}</span>
          )}
          {perf.models_used.length > 0 && (
            <span className="rk-aim__perf-models-item">{perf.models_used.join(", ")}</span>
          )}
        </div>
      )}
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
                  {/* Phase 18-B: `tier` was fetched/typed alongside `mode`
                      but never rendered - shows which tier (e.g. `high`)
                      the cost-mode-derived seat actually resolved to. */}
                  <div className="rk-aim__council-opinion-head">{op.seat} ({op.mode} · {op.tier}){op.confidence !== null ? ` · confidence ${Math.round(op.confidence * 100)}%` : ""}</div>
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

type GitHubActionTool = "github_create_issue" | "github_create_pr" | "github_pr_status" | "github_pr_review";
const GITHUB_ACTION_TOOLS: readonly GitHubActionTool[] = [
  "github_create_issue", "github_create_pr", "github_pr_status", "github_pr_review",
];
const GITHUB_ACTION_LABELS: Record<GitHubActionTool, string> = {
  github_create_issue: "Create issue",
  github_create_pr: "Create pull request",
  github_pr_status: "Check PR status",
  github_pr_review: "Submit PR review",
};

/** Phase 16-C: first interactive GitHub surface — 15-B only added a read-only activity log. */
function GitHubActionDialog({
  onClose,
  onRun,
}: {
  onClose: () => void;
  onRun: (input: {
    tool: GitHubActionTool;
    repo_path: string;
    title?: string;
    body?: string;
    head?: string;
    base?: string;
    number?: number;
    event?: string;
  }) => Promise<
    | { ok: true; result: string }
    | { ok: true; pending: true; approvalId: string }
    | { ok: false; message: string }
  >;
}) {
  const [tool, setTool] = useState<GitHubActionTool>("github_create_issue");
  const [repoPath, setRepoPath] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [head, setHead] = useState("");
  const [base, setBase] = useState("");
  const [number, setNumber] = useState("");
  const [event, setEvent] = useState<"APPROVE" | "REQUEST_CHANGES" | "COMMENT">("COMMENT");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needsTitle = tool === "github_create_issue" || tool === "github_create_pr";
  const needsHeadBase = tool === "github_create_pr";
  const needsNumber = tool === "github_pr_status" || tool === "github_pr_review";
  const needsEvent = tool === "github_pr_review";
  const canRun =
    repoPath.trim() &&
    (!needsTitle || title.trim()) &&
    (!needsHeadBase || (head.trim() && base.trim())) &&
    (!needsNumber || number.trim());

  const run = async () => {
    if (!canRun || busy) return;
    setBusy(true);
    setError(null);
    const r = await onRun({
      tool,
      repo_path: repoPath.trim(),
      title: needsTitle ? title.trim() : undefined,
      body: body.trim() || undefined,
      head: needsHeadBase ? head.trim() : undefined,
      base: needsHeadBase ? base.trim() : undefined,
      number: needsNumber ? Number(number) : undefined,
      event: needsEvent ? event : undefined,
    });
    if (!r.ok) setError(r.message);
    else if ("pending" in r) setResult(`Sent for approval (request ${r.approvalId.slice(0, 8)}…) - resolve it from the Authority tab.`);
    else setResult(r.result);
    setBusy(false);
  };

  return (
    <div className="rk-aim__overlay" onClick={() => !busy && onClose()}>
      <div className="rk-aim__dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="rk-aim__dialog-head">
          <div className="rk-aim__dialog-title">GitHub action</div>
          <div className="rk-aim__dialog-sub">Runs the same tool an agent would call, gated by the same authority check.</div>
        </div>
        <div className="rk-aim__dialog-body">
          {result === null ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div className="rk-aim__flab">action</div>
                <select className="rk-aim__cost-select" value={tool} onChange={(e) => setTool(e.target.value as GitHubActionTool)}>
                  {GITHUB_ACTION_TOOLS.map((t) => (
                    <option key={t} value={t}>{GITHUB_ACTION_LABELS[t]}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="rk-aim__flab">repo path</div>
                <input className="rk-aim__input" value={repoPath} onChange={(e) => setRepoPath(e.target.value)} placeholder="C:\path\to\repo" />
              </div>
              {needsTitle && (
                <div>
                  <div className="rk-aim__flab">title</div>
                  <input className="rk-aim__input" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
              )}
              {needsHeadBase && (
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div className="rk-aim__flab">head</div>
                    <input className="rk-aim__input" value={head} onChange={(e) => setHead(e.target.value)} placeholder="feature-branch" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="rk-aim__flab">base</div>
                    <input className="rk-aim__input" value={base} onChange={(e) => setBase(e.target.value)} placeholder="main" />
                  </div>
                </div>
              )}
              {needsNumber && (
                <div>
                  <div className="rk-aim__flab">PR number</div>
                  <input className="rk-aim__input" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="42" inputMode="numeric" />
                </div>
              )}
              {needsEvent && (
                <div>
                  <div className="rk-aim__flab">review</div>
                  <select className="rk-aim__cost-select" value={event} onChange={(e) => setEvent(e.target.value as typeof event)}>
                    <option value="APPROVE">Approve</option>
                    <option value="REQUEST_CHANGES">Request changes</option>
                    <option value="COMMENT">Comment</option>
                  </select>
                </div>
              )}
              {(tool === "github_create_issue" || tool === "github_create_pr" || tool === "github_pr_review") && (
                <div>
                  <div className="rk-aim__flab">body</div>
                  <textarea className="rk-aim__textarea" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
                </div>
              )}
              {error && <div className="rk-aim__msg">{error}</div>}
            </div>
          ) : (
            <div className="rk-aim__council-synthesis">{result}</div>
          )}
        </div>
        <div className="rk-aim__dialog-acts">
          <button className="rk-aim__sbtn" onClick={onClose}>{result !== null ? "Close" : "Cancel"}</button>
          {result === null && (
            <button className="rk-aim__sbtn rk-aim__sbtn--pri" onClick={run} disabled={busy || !canRun}>
              {busy ? "Running…" : "Run"}
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
  onCreate: (input: {
    name: string;
    request: string;
    execution_mode: ExecutionMode;
    cost_mode: CostMode;
  }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [request, setRequest] = useState("");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("assisted");
  const [costMode, setCostMode] = useState<CostMode>("balanced");

  const submit = async () => {
    if (!name.trim() || !request.trim()) return;
    await onCreate({
      name: name.trim(),
      request: request.trim(),
      execution_mode: executionMode,
      cost_mode: costMode,
    });
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
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div className="rk-aim__flab">execution mode</div>
              <select
                className="rk-aim__cost-select"
                value={executionMode}
                onChange={(e) => setExecutionMode(e.target.value as ExecutionMode)}
              >
                {EXECUTION_MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div className="rk-aim__flab">cost mode</div>
              <select
                className="rk-aim__cost-select"
                value={costMode}
                onChange={(e) => setCostMode(e.target.value as CostMode)}
              >
                {COST_MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
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
