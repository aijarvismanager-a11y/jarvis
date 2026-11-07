import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { goalText, shortGoal } from "./labels";

export function Button({ variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-accent text-white hover:bg-accent-hover",
    ghost: "bg-panel text-ink border border-border hover:bg-sidebar",
    danger: "bg-panel text-[#9B2C2C] border border-[#E7C4C4] hover:bg-[#FBEFEF]",
  }[variant];
  return <button {...rest} className={`rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${styles} ${className}`} />;
}

/** `fold`: the card is a collapsible section (closed unless `open`), so a long screen shows only what matters first. */
export function Card({ title, children, className = "", fold = false, open = false }: { title?: ReactNode; children: ReactNode; className?: string; fold?: boolean; open?: boolean }) {
  if (fold) {
    return (
      <details open={open} className={`group rounded-xl border border-border bg-panel ${className}`}>
        <summary className="flex cursor-pointer select-text items-center gap-2 p-4 text-[13px] font-semibold marker:content-none">
          <span aria-hidden className="text-muted transition-transform group-open:rotate-90">▸</span>
          <span className="flex flex-wrap items-center gap-2">{title}</span>
        </summary>
        <div className="px-4 pb-4">{children}</div>
      </details>
    );
  }
  return (
    <section className={`rounded-xl border border-border bg-panel p-4 ${className}`}>
      {title && <h2 className="mb-3 text-[11px] font-semibold tracking-wide text-muted">{title}</h2>}
      {children}
    </section>
  );
}

const TONES = { neutral: "bg-sidebar text-muted", ok: "bg-[#E6F0EA] text-status-done", warn: "bg-[#FBF1DC] text-[#8A6212]", bad: "bg-[#FBEAEA] text-[#9B2C2C]", info: "bg-[#EAF0F8] text-[#2F5A8A]" };
/** A request's text: long ones show a one-line heading and open to the full text on demand. */
export function GoalText({ goal, className = "" }: { goal: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const { head, long } = shortGoal(goal);
  if (!long) return <p className={className}>{head}</p>;
  return (
    <div>
      <p className={className}>{open ? goalText(goal) : head}</p>
      <button type="button" className="mt-1 text-[12px] text-accent hover:underline" onClick={() => setOpen(!open)}>{open ? "閉じる" : "全文を見る"}</button>
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Details({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-borderSoft bg-bg px-3 py-2">
      <summary className="cursor-pointer select-text text-[12.5px] text-muted group-open:mb-2">{summary}</summary>
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
