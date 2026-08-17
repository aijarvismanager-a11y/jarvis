import React from "react";
import { useDemoMode } from "./useDemoMode";

/**
 * Persistent "not real data" badge (spec §79-80). Renders nothing while the
 * initial health check hasn't loaded or once loaded reports demo mode is
 * off — a deployment that isn't in demo mode should show no chip at all,
 * not an "off" chip implying the toggle exists, per the same anti-dummy-data
 * rule every Cinematic-series phase has followed (see AwarenessChip).
 */
export function DemoModeChip() {
  const demoMode = useDemoMode();

  if (!demoMode) return null;

  return (
    <span
      className="rs-chip bad"
      role="status"
      aria-label="Demo mode — this deployment is showing non-real data"
      title="Demo mode: this deployment is showing non-real data, not a live JARVIS instance"
    >
      <span className="rs-dot" style={{ background: "var(--listen)" }} />
      demo mode
    </span>
  );
}
