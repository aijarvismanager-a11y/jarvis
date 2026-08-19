import React, { useMemo, useState } from "react";
import {
  useAgentsData,
  useFullTaskResponse,
  formatAgentActivityText,
  agentInitials,
  type AgentRosterEntry,
} from "../../rooms/agents/useAgentsData";
import { CORE_STATUS_LABEL, type CoreStatus } from "./coreStatus";
import { HandoffPacketLayer, HandoffTicker } from "./HandoffPacket";
import "./AgentOrbit.css";

/**
 * Cinematic UI Phase 32 — Agent Orbit (spec §9-13). The Phase 28 audit
 * flagged a decision point here: reuse `@xyflow/react` (used today only by
 * `WorkflowEditor.tsx`) or extend the CSS-only Orbital View already shipped
 * in `AgentsRoom.tsx`. Resolved in favor of the CSS approach — it's already
 * real-data-bound, proven, and per `docs/CINEMATIC_UI_AUDIT.md` §8 "less
 * new dependency surface, matches what's already shipped". This component
 * doesn't reuse `AgentsRoom.tsx`'s JSX/CSS directly (that Room's chrome is
 * styled for a list-based dashboard, not the immersive Core), but reuses
 * every piece of *real data and logic* it can: `useAgentsData()` (roster
 * matching, live status), `ROSTER`'s orbital coordinates convention
 * (mirrored below, not reimported, since the layout math here answers to
 * the Core's dimensions, not the Room's), and the shared
 * `formatAgentActivityText()`/`useFullTaskResponse()` helpers extracted
 * from `AgentsRoom.tsx` this same phase so both surfaces describe events
 * identically instead of maintaining two copies.
 *
 * The Central Core (Phase 31) is rendered here too, at the roster's own PA
 * position — the spec's "Central Core" and "PA at the center of the Agent
 * Orbit" are the same node, not two overlapping ones.
 */

export function AgentOrbit({
  coreStatus,
  projectId = null,
}: {
  coreStatus: CoreStatus;
  /** Phase 33 — scopes the Handoff ticker/packet to the pinned project, when one is pinned. */
  projectId?: string | null;
}) {
  const { roster, liveActivity } = useAgentsData();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  const pa = roster.find((a) => a.isPrimary);
  const specialists = roster.filter((a) => !a.isPrimary);
  const selected = selectedRoleId ? roster.find((a) => a.roleId === selectedRoleId) ?? null : null;
  const selectedResultShown = Boolean(selected && !selected.live?.busy && selected.live?.latest_task?.result);
  const selectedFullResponse = useFullTaskResponse(selected?.live?.latest_task, selectedResultShown);

  const ticker = useMemo(() => liveActivity.slice(0, 6), [liveActivity]);

  const toggle = (roleId: string) => setSelectedRoleId((prev) => (prev === roleId ? null : roleId));

  return (
    <div className="cin-orbit">
      <div className="cin-orbit-canvas">
        <div className="cin-orbit-ring inner" aria-hidden="true" />
        <div className="cin-orbit-ring outer" aria-hidden="true" />

        {pa && (
          <button
            type="button"
            className="cin-core-node"
            style={{ left: pa.orbital.left, top: pa.orbital.top }}
            onClick={() => toggle(pa.roleId)}
            aria-pressed={selectedRoleId === pa.roleId}
            title={`${pa.name} — ${CORE_STATUS_LABEL[coreStatus]}`}
            data-status={coreStatus.toLowerCase()}
          >
            <span className="cin-core-visual" aria-hidden="true">
              <span className="cin-ring r1" />
              <span className="cin-ring r2" />
              <span className="cin-orb" />
            </span>
            <span className="cin-core-node-label">{CORE_STATUS_LABEL[coreStatus]}</span>
          </button>
        )}

        {specialists.map((a) => (
          <AgentOrbNode
            key={a.roleId}
            agent={a}
            selected={selectedRoleId === a.roleId}
            onClick={() => toggle(a.roleId)}
          />
        ))}

        <HandoffPacketLayer projectId={projectId} />
      </div>

      {selected && !selected.isPrimary && (
        <div className="cin-orbit-detail">
          <div className="cin-orbit-detail-head">
            <span className="cin-orbit-detail-name">{selected.name}</span>
            <span className="cin-orbit-detail-state" data-active={selected.isActive}>
              {selected.isActive ? "稼働中" : "待機中"}
            </span>
          </div>
          {selected.live?.current_task && (
            <div className="cin-orbit-detail-task">{selected.live.current_task}</div>
          )}
          {!selected.live?.busy && selected.live?.latest_task?.result && (
            <div className="cin-orbit-detail-result">
              {selectedFullResponse ?? selected.live.latest_task.result.response}
            </div>
          )}
          {!selected.live && <div className="cin-orbit-detail-task">現在起動していません。</div>}
        </div>
      )}

      <div className="cin-orbit-ticker">
        {ticker.length > 0 ? (
          ticker.map((e, i) => (
            <span key={`${e.id}-${i}`} className="cin-orbit-ticker-row">
              <span className="cin-orbit-ticker-dot" data-event={e.eventType} aria-hidden="true" />
              <span className="cin-orbit-ticker-agent">{e.agentName}</span>
              <span className="cin-orbit-ticker-text">{formatAgentActivityText(e)}</span>
            </span>
          ))
        ) : (
          <span className="cin-orbit-ticker-empty">最近のエージェント活動はありません。</span>
        )}
      </div>

      <HandoffTicker projectId={projectId} />
    </div>
  );
}

function AgentOrbNode({
  agent,
  selected,
  onClick,
}: {
  agent: AgentRosterEntry;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="cin-agent-orb"
      data-ring={agent.ring}
      data-active={agent.isActive}
      data-selected={selected}
      style={{ left: agent.orbital.left, top: agent.orbital.top }}
      onClick={onClick}
      aria-pressed={selected}
      title={agent.name}
    >
      <span className="cin-agent-orb-txt">{agentInitials(agent.name)}</span>
    </button>
  );
}
