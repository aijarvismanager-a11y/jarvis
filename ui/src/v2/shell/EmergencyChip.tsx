import React, { useEffect, useRef, useState } from "react";
import { useEmergencyStatus } from "./useEmergencyStatus";
import { confirmDialog } from "../ui/ConfirmDialog";
import type { EmergencyState } from "../rooms/authority/useAuthorityData";

/**
 * Phase 34-B — global Emergency Stop, reachable from anywhere (spec §32
 * explicitly wants this, not just from the Authority Room — the Phase 28
 * audit's confirmed gap). `AuthorityRoom.tsx`'s `EmergencyBand` stays as
 * the Room's own always-visible version (unchanged); this is a second,
 * lighter surface for the same backend state/actions, matching the "no
 * confirm dialog anywhere" gap the Phase 34 research found in
 * `EmergencyBand` too — this version adds the branded `confirmDialog()`
 * for the two actions that actually interrupt live work (Pause, Kill);
 * Resume/Reset are recovery actions and stay one-click, same risk tier as
 * `EmergencyBand`'s own unconfirmed Resume/Reset buttons.
 */

const META: Record<EmergencyState, { label: string; hue: string }> = {
  normal: { label: "通常", hue: "var(--ok)" },
  paused: { label: "一時停止中", hue: "var(--hold)" },
  killed: { label: "強制停止", hue: "var(--listen)" },
};

export function EmergencyChip() {
  const { state, setEmergency } = useEmergencyStatus();
  const [open, setOpen] = useState(false);
  const [acting, setActing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Unknown until the initial fetch (or a live push) resolves — no chip
  // rather than guessing a state that might be wrong.
  if (state === null) return null;

  const meta = META[state];

  const act = async (transition: "pause" | "resume" | "kill" | "reset") => {
    if (transition === "pause" || transition === "kill") {
      const verb = transition === "pause" ? "一時停止" : "強制停止";
      const ok = await confirmDialog(
        `すべてのエージェント実行を${verb}しますか?\n${
          transition === "kill"
            ? "実行中のツール呼び出しはすべて即座に停止し、再開には明示的なリセットが必要です。"
            : "再開するまでツールの実行は一時停止します。"
        }`,
        { danger: transition === "kill" },
      );
      if (!ok) return;
    }
    setActing(true);
    try {
      await setEmergency(transition);
    } finally {
      setActing(false);
      setOpen(false);
    }
  };

  return (
    <div className="rs-emerg" ref={rootRef}>
      <button
        type="button"
        className={`rs-chip${state !== "normal" ? " hold" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`グローバル緊急停止 — ${meta.label}`}
        title="グローバル緊急停止"
      >
        <span className="rs-dot" style={{ background: meta.hue }} />
        {meta.label}
      </button>
      {open && (
        <div className="rs-emerg-menu" role="menu">
          {state === "normal" && (
            <>
              <button type="button" role="menuitem" disabled={acting} onClick={() => act("pause")}>一時停止</button>
              <button type="button" role="menuitem" className="danger" disabled={acting} onClick={() => act("kill")}>強制停止</button>
            </>
          )}
          {state === "paused" && (
            <>
              <button type="button" role="menuitem" disabled={acting} onClick={() => act("resume")}>再開</button>
              <button type="button" role="menuitem" className="danger" disabled={acting} onClick={() => act("kill")}>強制停止</button>
            </>
          )}
          {state === "killed" && (
            <button type="button" role="menuitem" disabled={acting} onClick={() => act("reset")}>リセット</button>
          )}
        </div>
      )}
    </div>
  );
}
