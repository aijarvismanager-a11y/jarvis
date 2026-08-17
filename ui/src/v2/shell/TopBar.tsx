import React from "react";
import { useV2Route } from "../router";
import { ROOM_NAV_ENTRIES } from "../palette/types";
import type { ConnectionState } from "./Header";
import type { VoiceState } from "./VoiceRail";
import { useTheme } from "./useTheme";
import { useCinematicMode, type UIMode } from "./useCinematicMode";
import { EmergencyChip } from "./EmergencyChip";
import { AwarenessChip } from "./AwarenessChip";
import { DemoModeChip } from "./DemoModeChip";

/**
 * Top bar — 44px, never two rows. Left: room name + contextual actions
 * (Now contributes Arrange). Right: the daemon dot, the live state chip,
 * Quick open (⌘K), and the bell. The state chip is the only live colour.
 */

const ROOM_TITLES: Record<string, string> = Object.fromEntries(
  ROOM_NAV_ENTRIES.map((e) => [e.key, e.label]),
);

const STATE_LABEL: Record<VoiceState, string> = {
  idle: "idle",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
  "awaiting-approval": "asking",
  muted: "muted",
};

const STATE_HUE: Record<VoiceState, string> = {
  idle: "var(--faint)",
  listening: "var(--listen)",
  thinking: "var(--ink2)",
  speaking: "var(--speak)",
  "awaiting-approval": "var(--hold)",
  muted: "var(--faint)",
};

const DAEMON: Record<ConnectionState, { cls: string; hue: string; label: string }> = {
  live: { cls: "", hue: "var(--ok)", label: "daemon · online" },
  degraded: { cls: "hold", hue: "var(--hold)", label: "daemon · degraded · reconnecting" },
  offline: { cls: "bad", hue: "var(--listen)", label: "offline" },
};

// Cinematic/Focus have no dedicated surface yet (Phase 31/35) — Normal Mode
// renders unchanged regardless of this switch's value today. The label says
// so rather than pretending the mode already does something, per the spec's
// anti-dummy-data rule (docs/CINEMATIC_UI_AUDIT.md §11, spec §78/§79-80).
const MODE_META: Record<UIMode, { label: string; icon: string; note: string }> = {
  normal: { label: "Normal", icon: "▢", note: "Standard dashboard" },
  cinematic: { label: "Cinematic", icon: "◈", note: "Central Core view — live project/task/agent/provider status" },
  focus: { label: "Focus", icon: "◎", note: "Single-task view — the pinned project's most urgent task, one at a time" },
};

export function TopBar({
  connection,
  voiceState,
  arranging,
  onArrange,
  onOpenPalette,
  notificationCount,
  notificationsOpen,
  onToggleNotifications,
}: {
  connection: ConnectionState;
  voiceState: VoiceState;
  arranging: boolean;
  onArrange: () => void;
  onOpenPalette: () => void;
  notificationCount?: number;
  notificationsOpen?: boolean;
  onToggleNotifications?: () => void;
}) {
  const route = useV2Route();
  const [theme, toggleTheme] = useTheme();
  const [uiMode, cycleUiMode] = useCinematicMode();
  const isNow = route.kind !== "room";
  const title = route.kind === "room" ? ROOM_TITLES[route.key] ?? route.key : "Now";
  const daemon = DAEMON[connection];
  const count = notificationCount ?? 0;

  return (
    <div className={`rs-top${connection === "offline" ? " off" : ""}`}>
      <span className="rm">{title}</span>
      {isNow && (
        <button className={`rs-abtn${arranging ? " on" : ""}`} onClick={onArrange} aria-pressed={arranging}>
          {arranging ? "Done" : "Arrange"}
        </button>
      )}

      <div className="right">
        <span className={`rs-chip ${daemon.cls}`}>
          <span className="rs-dot" style={{ background: daemon.hue }} />
          {daemon.label}
        </span>

        {connection !== "offline" && (
          <span className="rs-chip hold" aria-live="polite">
            <span className="rs-dot" style={{ background: STATE_HUE[voiceState] }} />
            <span className="rs-stl">{STATE_LABEL[voiceState]}</span>
          </span>
        )}

        <DemoModeChip />
        <EmergencyChip />
        <AwarenessChip />

        <button
          className={`rs-chip${uiMode !== "normal" ? " hold" : ""}`}
          onClick={() => cycleUiMode()}
          aria-label={`UI mode: ${MODE_META[uiMode].label}. Click to switch.`}
          title={MODE_META[uiMode].note}
        >
          {MODE_META[uiMode].icon} {MODE_META[uiMode].label}
        </button>

        <button
          className="rs-chip"
          onClick={() => toggleTheme()}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? "● dark" : "○ light"}
        </button>

        <button className="rs-chip" onClick={onOpenPalette} aria-label="Quick open">⌘K</button>

        {onToggleNotifications && (
          <button
            className={`rs-bell${notificationsOpen ? " on" : ""}`}
            onClick={onToggleNotifications}
            aria-label={`Notifications${count > 0 ? `, ${count} unread` : ""}`}
            aria-expanded={notificationsOpen}
          >
            <span className="bb">⌥N</span>
            {count > 0 && <span className="bn">{count > 9 ? "9+" : count}</span>}
          </button>
        )}
      </div>
    </div>
  );
}
