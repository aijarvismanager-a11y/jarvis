import { useCallback, useEffect, useState } from "react";

/**
 * Three-way preference: light/dark/system (spec §42). `data-theme` on
 * <html> always holds the RESOLVED value ("light"|"dark") since that's what
 * every CSS variable keys off of — "system" is never written there, only
 * to localStorage as the user's stated preference. The pre-paint bootstrap
 * script in index.html already resolves any non-"light"/"dark" stored value
 * (missing key, or literal "system") via `matchMedia`, so storing "system"
 * needed no bootstrap change — only this hook needed to (a) expose it as a
 * selectable third state instead of collapsing to "system" only implicitly
 * when nothing is stored, and (b) live-track OS changes instead of
 * resolving once at boot.
 */
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
const KEY = "jarvis-theme";
const CYCLE: ThemePreference[] = ["light", "dark", "system"];

function systemPrefersDark(): boolean {
  if (typeof matchMedia === "undefined") return false;
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

function storedPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* ignore */ }
  return "system";
}

function resolve(pref: ThemePreference): ResolvedTheme {
  return pref === "system" ? (systemPrefersDark() ? "dark" : "light") : pref;
}

function applyResolved(t: ResolvedTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", t);
}

export function useTheme(): [ResolvedTheme, ThemePreference, (next?: ThemePreference) => void] {
  const [preference, setPreferenceState] = useState<ThemePreference>(storedPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(storedPreference()));

  // Re-sync on mount in case the bootstrap resolved a different value.
  useEffect(() => {
    const pref = storedPreference();
    setPreferenceState(pref);
    setResolved(resolve(pref));
  }, []);

  // Live-track OS changes while following system — the old implementation
  // only ever resolved once at page load.
  useEffect(() => {
    if (preference !== "system" || typeof matchMedia === "undefined") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next: ResolvedTheme = mq.matches ? "dark" : "light";
      setResolved(next);
      applyResolved(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  const set = useCallback((next?: ThemePreference) => {
    setPreferenceState((prev) => {
      const p = next ?? CYCLE[(CYCLE.indexOf(prev) + 1) % CYCLE.length]!;
      try { localStorage.setItem(KEY, p); } catch { /* ignore */ }
      const r = resolve(p);
      setResolved(r);
      applyResolved(r);
      return p;
    });
  }, []);

  return [resolved, preference, set];
}
