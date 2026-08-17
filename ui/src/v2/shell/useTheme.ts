import { useCallback, useEffect, useMemo, useState } from "react";

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
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  // Re-sync on mount in case the bootstrap resolved a different value.
  useEffect(() => {
    setPreferenceState(storedPreference());
  }, []);

  // Live-track OS changes while following system — the old implementation
  // only ever resolved once at page load. Only attach while `preference`
  // is actually "system": otherwise every OS light/dark toggle would call
  // setSystemDark() (and force a re-render of every useTheme() consumer)
  // for a user who explicitly picked light or dark and will never observe
  // a different `resolved` value.
  useEffect(() => {
    if (preference !== "system" || typeof matchMedia === "undefined") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    // The listener is detached while `preference !== "system"` (see above),
    // so `systemDark` can go stale if the OS setting changed during that
    // window. Re-sync it the moment "system" is (re-)selected, instead of
    // waiting for the next OS-level toggle to happen to fire.
    setSystemDark(mq.matches);
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  // Derived, not manually synced — the previous implementation stored
  // `resolved` as its own state set from three separate places (mount,
  // matchMedia listener, and set()), which could drift out of sync with
  // `preference`/`systemDark` if any one of them missed an update.
  const resolved = useMemo<ResolvedTheme>(
    () => (preference === "system" ? (systemDark ? "dark" : "light") : preference),
    [preference, systemDark],
  );

  useEffect(() => {
    applyResolved(resolved);
  }, [resolved]);

  const set = useCallback((next?: ThemePreference) => {
    setPreferenceState((prev) => {
      const p = next ?? CYCLE[(CYCLE.indexOf(prev) + 1) % CYCLE.length]!;
      try { localStorage.setItem(KEY, p); } catch { /* ignore */ }
      return p;
    });
  }, []);

  return [resolved, preference, set];
}
