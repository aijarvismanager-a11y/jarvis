import React, { useEffect, useMemo, useState } from "react";
import { useJarvisState } from "../JarvisStateContext";
import { StatusChip } from "../../ui/roomkit";
import { TASK_STATUS_TONE } from "../../rooms/aiManager/AIManagerRoom";
import type { ProjectTask } from "../../rooms/aiManager/useAIManagerData";
import { pickDefaultFocusTask } from "./taskFocus";
import "./FocusMode.css";

/**
 * Cinematic UI Phase 35 — Focus Mode (spec §7, "single-task view"). Renders
 * in place of the Normal Mode main surface when `useCinematicMode()`
 * reports `"focus"` (wired in `AppShell.tsx`), the third branch that
 * previously fell back to Normal Mode ("shown for now" — Phase 30/31's own
 * doc comments both said so explicitly).
 *
 * Deliberately thin, per the Phase 28 plan's own framing ("mostly
 * presentational once Phase 29's state layer exists"): every field shown
 * here already exists on `ProjectTask` (`useAIManagerData.ts`), reached via
 * `useJarvisState().activeProjectDetail.tasks` (Phase 29) — no new backend
 * work, no dummy data. Reuses `TASK_STATUS_TONE`/`StatusChip` from
 * `AIManagerRoom.tsx` rather than inventing a second status-colour
 * vocabulary, and calls the same `POST .../tasks/:taskId/resume` endpoint
 * `AIManagerRoom`'s own WAITING-task UI uses (Phase 11-A) — written as a
 * small local fetch here rather than pulling in the whole
 * `useAIManagerData()` hook (which owns a large independent 8s poll +
 * mutation surface unrelated to viewing one task; same reasoning Phase 29
 * used to keep `JarvisStateContext` from absorbing it).
 */

function labeled(label: string, value: React.ReactNode) {
  if (value == null || value === "") return null;
  return (
    <div className="foc-field">
      <span className="foc-field-k">{label}</span>
      <span className="foc-field-v">{value}</span>
    </div>
  );
}

async function resumeTask(projectId: string, taskId: string, input: string): Promise<{ ok: boolean; message: string }> {
  try {
    const resp = await fetch(
      `/api/ai-manager/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/resume`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      },
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(text || `HTTP ${resp.status}`);
    }
    return { ok: true, message: "Task resumed." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to resume task." };
  }
}

export function FocusMode() {
  const { activeProjectId, activeProjectOptions, activeProjectDetail, activeProjectDetailLoading } = useJarvisState();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [resumeInput, setResumeInput] = useState("");
  const [resuming, setResuming] = useState(false);
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);

  const tasks = activeProjectDetail?.tasks ?? [];
  const projectName = useMemo(
    () => activeProjectOptions.find((p) => p.id === activeProjectId)?.name ?? null,
    [activeProjectOptions, activeProjectId],
  );

  // A fresh pin (or the pinned project's task list arriving/changing) drops
  // any manual selection that no longer exists, falling back to the most
  // urgent task again rather than silently focusing a stale/vanished one.
  useEffect(() => {
    if (selectedTaskId && !tasks.some((t) => t.id === selectedTaskId)) {
      setSelectedTaskId(null);
    }
  }, [tasks, selectedTaskId]);

  const focusedTask: ProjectTask | null = selectedTaskId
    ? tasks.find((t) => t.id === selectedTaskId) ?? null
    : pickDefaultFocusTask(tasks);

  const index = focusedTask ? tasks.findIndex((t) => t.id === focusedTask.id) : -1;

  const step = (dir: 1 | -1) => {
    if (tasks.length === 0 || index === -1) return;
    const next = (index + dir + tasks.length) % tasks.length;
    setSelectedTaskId(tasks[next]!.id);
    setResumeMessage(null);
  };

  const submitResume = async () => {
    if (!activeProjectId || !focusedTask || !resumeInput.trim() || resuming) return;
    setResuming(true);
    setResumeMessage(null);
    const result = await resumeTask(activeProjectId, focusedTask.id, resumeInput.trim());
    setResuming(false);
    setResumeMessage(result.message);
    if (result.ok) setResumeInput("");
  };

  return (
    <div className="foc-shell" role="region" aria-label="Focus Mode">
      <div className="foc-project-strip">
        {activeProjectId == null ? "No project pinned" : projectName ?? "Pinned project"}
      </div>

      {activeProjectId == null ? (
        <div className="foc-empty">Pin a project from Talk to focus on its tasks here.</div>
      ) : activeProjectDetailLoading && tasks.length === 0 ? (
        <div className="foc-empty">Loading…</div>
      ) : !focusedTask ? (
        <div className="foc-empty">This project has no tasks yet.</div>
      ) : (
        <div className="foc-card" data-status={(focusedTask.project_status ?? "pending").toLowerCase()}>
          <div className="foc-nav">
            <button type="button" className="foc-nav-btn" onClick={() => step(-1)} disabled={tasks.length < 2} aria-label="Previous task">
              ‹
            </button>
            <span className="foc-nav-pos">{index + 1} of {tasks.length}</span>
            <button type="button" className="foc-nav-btn" onClick={() => step(1)} disabled={tasks.length < 2} aria-label="Next task">
              ›
            </button>
          </div>

          <div className="foc-title">{focusedTask.title ?? "Untitled task"}</div>
          <div className="foc-meta">
            <StatusChip tone={focusedTask.project_status ? TASK_STATUS_TONE[focusedTask.project_status] : "mut"} dot>
              {focusedTask.project_status ?? "pending"}
            </StatusChip>
            <span className="foc-priority">{focusedTask.priority}</span>
          </div>

          <div className="foc-fields">
            {labeled("Assigned agent", focusedTask.assigned_agent)}
            {labeled(
              "Assigned model",
              focusedTask.assigned_provider
                ? `${focusedTask.assigned_provider}${focusedTask.assigned_model ? `/${focusedTask.assigned_model}` : ""}`
                : null,
            )}
            {labeled("Next agent", focusedTask.next_agent)}
            {focusedTask.retry_count > 0 && labeled("Retries", `${focusedTask.retry_count}/${focusedTask.max_retries}`)}
            {focusedTask.approval_required && labeled("Approval", "required")}
          </div>

          {focusedTask.dependencies.length > 0 && (
            <div className="foc-section">
              <div className="foc-section-h">Dependencies</div>
              {focusedTask.dependencies.map((depId) => {
                const dep = tasks.find((t) => t.id === depId);
                return (
                  <div key={depId} className="foc-row">
                    <span className="foc-row-name">{dep?.title ?? depId}</span>
                    {dep?.project_status && <span className="foc-row-sub">{dep.project_status.toLowerCase()}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {focusedTask.artifacts.length > 0 && (
            <div className="foc-section">
              <div className="foc-section-h">Artifacts</div>
              {focusedTask.artifacts.map((path) => (
                <div key={path} className="foc-row">
                  <span className="foc-row-name">{path}</span>
                </div>
              ))}
            </div>
          )}

          {focusedTask.qa_report && (
            <div className="foc-section">
              <div className="foc-section-h">QA — {focusedTask.qa_report.passed ? "passed" : "failed"}</div>
              {focusedTask.qa_report.checks.map((c) => (
                <div key={c.name} className={`foc-row${c.automated && !c.passed ? " foc-row--fail" : ""}`}>
                  <span className="foc-row-name">{c.automated ? (c.passed ? "✓" : "✗") : "–"} {c.name}</span>
                  <span className="foc-row-sub">{c.summary}</span>
                </div>
              ))}
            </div>
          )}

          {focusedTask.project_status === "WAITING" && (
            <div className="foc-resume">
              <div className="foc-resume-q">This task is waiting for your input to continue.</div>
              <div className="foc-resume-row">
                <input
                  className="foc-resume-input"
                  value={resumeInput}
                  onChange={(e) => setResumeInput(e.target.value)}
                  placeholder="Type your answer…"
                  onKeyDown={(e) => e.key === "Enter" && resumeInput.trim() && !resuming && void submitResume()}
                />
                <button
                  type="button"
                  className="foc-resume-btn"
                  disabled={!resumeInput.trim() || resuming}
                  onClick={() => void submitResume()}
                >
                  {resuming ? "…" : "Resume"}
                </button>
              </div>
              {resumeMessage && <div className="foc-resume-msg">{resumeMessage}</div>}
            </div>
          )}
        </div>
      )}

      <div className="foc-hint">Switch modes from the top bar to return to the standard dashboard.</div>
    </div>
  );
}
