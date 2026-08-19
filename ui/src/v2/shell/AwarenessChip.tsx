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
      aria-label={`認識機能 ${enabled ? "有効" : "無効"} — クリックで${enabled ? "無効化" : "有効化"}`}
      title={
        enabled
          ? "認識機能 有効 — デスクトップの状況把握がオンです。クリックで無効化。"
          : "認識機能 無効。クリックでデスクトップの状況把握を有効化。"
      }
    >
      <span className="rs-dot" style={{ background: enabled ? "var(--ok)" : "var(--faint)" }} />
      認識
    </button>
  );
}
