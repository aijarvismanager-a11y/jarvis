import React, { useEffect, useRef, useState } from "react";
import { useLiveData } from "../LiveDataContext";
import type { HandoffEvent } from "../../../hooks/useWebSocket";
import "./HandoffPacket.css";

/**
 * Cinematic UI Phase 33 — animated Handoff packet + live ticker (spec
 * §29-30), consuming the new `handoff_event` WS push (this same phase; see
 * `src/comms/websocket.ts`'s `handoff_event` doc comment for the backend
 * contract) instead of re-deriving transitions from `AIManagerRoom`'s 8s
 * poll of `GET .../projects/:id/handoffs`.
 *
 * Deliberately doesn't animate a packet between two arbitrary orbit nodes:
 * a Handoff's `from_agent`/`to_agent` are `TaskDispatcher` template ids
 * (e.g. `task_research`) or `MANAGER_AGENT_ID` ('manager'), not
 * `AgentRosterEntry.roleId` values — there's no reliable mapping from one
 * identifier space to the other, and guessing one would put a packet at a
 * screen position not actually backed by the handoff's real endpoints
 * (the spec's anti-dummy-data rule, §78). The one endpoint that IS always
 * exactly known is 'manager' — it's the same node as the Central Core
 * (`AgentOrbit.tsx`'s `.cin-core-node`, Phase 31/32) — so the flight
 * animation only claims what it can back: "a handoff arrived at / departed
 * from the Core", direction-only. The `from`/`to` text label in the ticker
 * carries the specific, real agent ids.
 *
 * Two components, split so `<HandoffPacketLayer>` can be placed inside
 * `AgentOrbit.tsx`'s `.cin-orbit-canvas` (its `top: 6%/48%` keyframes are
 * percentages of the canvas, not the whole shell) while `<HandoffTicker>`
 * renders as a normal flow element below it.
 */

export function formatHandoffAgentLabel(id: string): string {
  if (id === "manager") return "Manager";
  if (id.startsWith("task_")) {
    const rest = id.slice("task_".length);
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return id;
}

function useRelevantHandoffs(projectId: string | null): HandoffEvent[] {
  const { handoffEvents } = useLiveData();
  return projectId
    ? handoffEvents.filter((e) => e.project_id == null || e.project_id === projectId)
    : handoffEvents;
}

const FLIGHT_MS = 1400;
const TICKER_LIMIT = 5;

type Packet = { key: string; event: HandoffEvent; direction: "inbound" | "outbound" | null };

export function HandoffPacketLayer({ projectId = null }: { projectId?: string | null }) {
  const relevant = useRelevantHandoffs(projectId);
  const [flying, setFlying] = useState<Packet[]>([]);
  const seenCount = useRef<number | null>(null);

  useEffect(() => {
    // First mount: record the current backlog length without animating it —
    // the WS event buffer is capped at 100 and persists across mode
    // switches, so replaying everything already in it on entry would be a
    // burst of animations for handoffs that happened while Cinematic Mode
    // wasn't even open.
    if (seenCount.current === null) {
      seenCount.current = relevant.length;
      return;
    }
    if (relevant.length <= seenCount.current) {
      seenCount.current = relevant.length;
      return;
    }
    const fresh = relevant.slice(seenCount.current);
    seenCount.current = relevant.length;
    const packets: Packet[] = fresh.map((event) => ({
      key: event.message_id,
      event,
      direction: event.to_agent === "manager" ? "inbound" : event.from_agent === "manager" ? "outbound" : null,
    }));
    setFlying((prev) => [...prev, ...packets]);
    for (const p of packets) {
      window.setTimeout(() => {
        setFlying((prev) => prev.filter((x) => x.key !== p.key));
      }, FLIGHT_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevant.length]);

  return (
    <div className="cin-packet-layer" aria-hidden="true">
      {flying.map((p) => (
        <span
          key={p.key}
          className="cin-packet"
          data-direction={p.direction ?? "inbound"}
          data-status={p.event.status}
        />
      ))}
    </div>
  );
}

export function HandoffTicker({ projectId = null }: { projectId?: string | null }) {
  const relevant = useRelevantHandoffs(projectId);
  const recent = relevant.slice(-TICKER_LIMIT).reverse();

  return (
    <div className="cin-handoff-ticker" aria-live="polite">
      {recent.length > 0 ? (
        recent.map((e) => (
          <span key={e.message_id} className="cin-handoff-row">
            <span className="cin-handoff-dot" data-status={e.status} aria-hidden="true" />
            <span className="cin-handoff-from">{formatHandoffAgentLabel(e.from_agent)}</span>
            <span className="cin-handoff-arrow" aria-hidden="true">→</span>
            <span className="cin-handoff-to">{formatHandoffAgentLabel(e.to_agent)}</span>
            <span className="cin-handoff-status">{e.status}</span>
          </span>
        ))
      ) : (
        <span className="cin-handoff-empty">No handoffs yet.</span>
      )}
    </div>
  );
}
