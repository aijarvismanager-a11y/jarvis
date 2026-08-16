import React from "react";
import { useAwareness } from "./useAwareness";

/**
 * Phase 34-C — Awareness/Privacy live toggle (spec §39). Renders nothing
 * while the initial status hasn't loaded, and nothing at all if the daemon
 * has no `awarenessService` configured (`available === false`) — a "off"
 * chip would misleadingly imply a working toggle that isn't actually
 * there, per the anti-dummy-data rule every Cinematic-series phase has
 * followed.
 */
export function AwarenessChip() {
  const { enabled, available, busy, toggle } = useAwareness();

  if (!available || enabled === null) return null;

  return (
    <button
      type="button"
      className="rs-chip"
      onClick={toggle}
      disabled={busy}
      aria-pressed={enabled}
      aria-label={`Awareness ${enabled ? "active" : "off"} — click to ${enabled ? "disable" : "enable"}`}
      title={
        enabled
          ? "Awareness active — desktop context observation is on. Click to disable."
          : "Awareness off. Click to enable desktop context observation."
      }
    >
      <span className="rs-dot" style={{ background: enabled ? "var(--ok)" : "var(--faint)" }} />
      awareness
    </button>
  );
}
