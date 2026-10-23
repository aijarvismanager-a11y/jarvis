import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function Button({ variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-accent text-white hover:bg-accent-hover",
    ghost: "bg-panel text-ink border border-border hover:bg-sidebar",
    danger: "bg-panel text-[#9B2C2C] border border-[#E7C4C4] hover:bg-[#FBEFEF]",
  }[variant];
  return <button {...rest} className={`rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${styles} ${className}`} />;
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-panel p-4 ${className}`}>
      {title && <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h2>}
      {children}
    </section>
  );
}

const TONES = { neutral: "bg-sidebar text-muted", ok: "bg-[#E6F0EA] text-status-done", warn: "bg-[#FBF1DC] text-[#8A6212]", bad: "bg-[#FBEAEA] text-[#9B2C2C]", info: "bg-[#EAF0F8] text-[#2F5A8A]" };
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Details({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-borderSoft bg-bg px-3 py-2">
      <summary className="cursor-pointer select-none text-[12.5px] text-muted group-open:mb-2">{summary}</summary>
      {children}
    </details>
  );
}

export function ErrorBar({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-[#E7C4C4] bg-[#FBEFEF] px-3 py-2 text-[13px] text-[#9B2C2C]">
      <span className="whitespace-pre-wrap">{message}</span>
      <button onClick={onClose} className="shrink-0 font-semibold" aria-label="閉じる">×</button>
    </div>
  );
}

/** Runs `load` now and every `ms` while the tab is visible; returns a manual refresh. */
export function usePoll(load: () => Promise<void>, ms: number, deps: unknown[]): () => void {
  const loadRef = useRef(load);
  loadRef.current = load;
  const refresh = useCallback(() => void loadRef.current().catch(() => {}), []);
  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, ms);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, refresh, ...deps]);
  return refresh;
}

/** Wraps an async action: shows errors, blocks double clicks. */
export function useAction(onError: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [onError],
  );
  return { busy, run };
}
