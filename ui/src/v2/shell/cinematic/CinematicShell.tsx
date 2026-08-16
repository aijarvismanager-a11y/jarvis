import React, { useMemo, useState } from "react";
import { useJarvisState } from "../JarvisStateContext";
import { BootSplash } from "../BootSplash";
import { AgentOrbit } from "./AgentOrbit";
import { deriveCoreStatus } from "./coreStatus";
import "./CinematicShell.css";

/**
 * Cinematic UI Phase 31/32 — Cinematic Shell, Central Core, and Agent Orbit
 * (spec §7-13, §36-38). Renders in place of the Normal Mode main surface
 * when `useCinematicMode()` reports `"cinematic"` (wired in `AppShell.tsx`).
 *
 * Deliberately thin: every number shown here is read from
 * `useJarvisState()`/`useAgentsData()` — no dummy data, no placeholder
 * animation not tied to something real, per the spec's anti-dummy-data rule
 * (§78) that the Phase 28/30/31 docs all call out. The Core itself and the
 * orbiting Agent nodes live in `AgentOrbit.tsx` (Phase 32) — the spec's
 * "PA at the center of the Orbit" and "Central Core" are the same node, not
 * two overlapping ones. The animated Handoff packet + ticker (Phase 33,
 * `HandoffPacket.tsx`) are wired into `AgentOrbit.tsx` too, scoped to the
 * pinned project via `activeProjectId` below. Sub-Pebble/global Emergency
 * Stop/Awareness toggle (Phase 34) and Focus Mode (Phase 35, `../focus/
 * FocusMode.tsx` — a separate `uiMode === "focus"` branch in `AppShell.tsx`,
 * not part of this component) are built elsewhere.
 */

function providerSummary(providerStatus: ReturnType<typeof useJarvisState>["providerStatus"]) {
  let online = 0, error = 0, unknown = 0;
  for (const p of providerStatus) {
    if (p.status === "online") online++;
    else if (p.status === "error") error++;
    else unknown++;
  }
  return { online, error, unknown, total: providerStatus.length };
}

export function CinematicShell() {
  // A brief entrance transition reusing the app's own BootSplash rather than
  // a new implementation (per the Phase 28 plan's explicit instruction) —
  // "pulse" is the lightest/quickest temperament, matching a mode switch
  // rather than a full cold start. autoReadyMs bounds it since nothing
  // external fires `jarvis:boot-ready` for this reuse site.
  const [entering, setEntering] = useState(true);

  const {
    activeProjectId,
    activeProjectOptions,
    activeProjectDetail,
    activeProjectDetailLoading,
    providerStatus,
    providerStatusLoading,
  } = useJarvisState();

  const projectName = useMemo(
    () => activeProjectOptions.find((p) => p.id === activeProjectId)?.name ?? null,
    [activeProjectOptions, activeProjectId],
  );

  const status = useMemo(
    () =>
      deriveCoreStatus({
        hasActiveProject: activeProjectId != null,
        totalTasks: activeProjectDetail?.totalTasks ?? 0,
        taskCounts: activeProjectDetail?.taskCounts ?? {},
      }),
    [activeProjectId, activeProjectDetail],
  );

  const providers = useMemo(() => providerSummary(providerStatus), [providerStatus]);

  return (
    <div className="cin-shell" data-status={status.toLowerCase()} role="region" aria-label="Cinematic Mode">
      {entering && (
        <BootSplash variant="pulse" autoReadyMs={900} onDone={() => setEntering(false)} />
      )}

      <div className="cin-project-strip">
        {activeProjectId == null ? "No project pinned" : projectName ?? "Pinned project"}
      </div>

      <AgentOrbit coreStatus={status} projectId={activeProjectId} />

      <div className="cin-readout">
        <div className="cin-stat">
          <span className="k">Tasks</span>
          <span className="v">
            {activeProjectDetailLoading && !activeProjectDetail
              ? "…"
              : activeProjectDetail
                ? activeProjectDetail.totalTasks
                : "—"}
          </span>
        </div>
        <div className="cin-stat">
          <span className="k">Agents on project</span>
          <span className="v">{activeProjectDetail?.agentPerformance.length ?? "—"}</span>
        </div>
        <div className="cin-stat">
          <span className="k">Providers</span>
          <span className="v">
            {providerStatusLoading && providers.total === 0
              ? "…"
              : providers.total === 0
                ? "—"
                : `${providers.online} online${providers.error > 0 ? ` · ${providers.error} error` : ""}`}
          </span>
        </div>
      </div>

      <div className="cin-hint">Switch modes from the top bar to return to the standard dashboard.</div>
    </div>
  );
}
