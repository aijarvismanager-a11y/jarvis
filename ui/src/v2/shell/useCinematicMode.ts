import { useCallback, useEffect, useState } from "react";

/**
 * Normal/Cinematic/Focus UI mode (spec §3-6, §51). Phase 30 — copies
 * useTheme.ts's exact shape per the Phase 28 audit's recommendation
 * (docs/CINEMATIC_UI_AUDIT.md §9): own `data-*` attribute on <html> +
 * localStorage key + `[mode, set]` hook, no new state-management pattern.
 *
 * Unlike theme, this doesn't need index.html's pre-paint bootstrap: no CSS
 * or component yet reads `data-ui-mode` (Cinematic Shell/Core is Phase 31,
 * Focus Mode is Phase 35), so there is no flash-of-wrong-mode to prevent.
 * Once a later phase makes `data-ui-mode` visually load-bearing, add the
 * same inline pre-paint script index.html already has for `data-theme`.
 */
export type UIMode = "normal" | "cinematic" | "focus";
const KEY = "jarvis-ui-mode";
const MODES: UIMode[] = ["normal", "cinematic", "focus"];

function currentMode(): UIMode {
  if (typeof document === "undefined") return "normal";
  const attr = document.documentElement.getAttribute("data-ui-mode");
  return attr === "cinematic" || attr === "focus" ? attr : "normal";
}

function applyMode(m: UIMode) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-ui-mode", m);
  try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
}

export function useCinematicMode(): [UIMode, (next?: UIMode) => void] {
  const [mode, setMode] = useState<UIMode>(currentMode);

  // Re-sync on mount and apply the persisted preference — unlike theme
  // there's no pre-paint bootstrap, so the attribute needs setting here.
  useEffect(() => {
    let stored: UIMode | null = null;
    try {
      const v = localStorage.getItem(KEY);
      if (v === "normal" || v === "cinematic" || v === "focus") stored = v;
    } catch { /* ignore */ }
    if (stored) applyMode(stored);
    setMode(stored ?? currentMode());
  }, []);

  const set = useCallback((next?: UIMode) => {
    setMode((prev) => {
      const m: UIMode = next ?? MODES[(MODES.indexOf(prev) + 1) % MODES.length]!;
      applyMode(m);
      return m;
    });
  }, []);

  return [mode, set];
}
