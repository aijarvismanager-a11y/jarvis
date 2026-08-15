import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Icon } from "../../ui";
import { StatusChip, EmptyState, Skeleton, Toast, type Tone } from "../../ui/roomkit";
import { RoomShell } from "../RoomShell";
import { useAIManagerData, type Project, type ProjectStatus, type ProjectTask, type ProjectTaskStatus } from "./useAIManagerData";
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
                            items.map((t) => <TaskCard key={t.id} task={t} />)
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

function TaskCard({ task }: { task: ProjectTask }) {
  return (
    <div className="rk-aim__card">
      <div className="rk-aim__card-t">{task.title ?? "Untitled task"}</div>
      <div className="rk-aim__card-meta">
        <StatusChip tone={task.project_status ? TASK_STATUS_TONE[task.project_status] : "mut"}>{task.priority}</StatusChip>
        {task.assigned_agent && <span className="rk-aim__asg">{task.assigned_agent}</span>}
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
