import { useEffect, useRef, type ReactNode } from "react";

/** A header menu that goes away like any menu: choosing an item, pressing outside it or Esc closes it. */
export function HeaderMenu({ summary, title, label, children }: { summary: ReactNode; title: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = () => ref.current?.removeAttribute("open");
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current?.open) {
        close();
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <details ref={ref} className="relative">
      <summary className="cursor-pointer list-none rounded-lg border border-border bg-panel px-3.5 py-2 text-[13px] font-semibold hover:bg-sidebar" title={title} aria-label={label}>{summary}</summary>
      <div className="absolute right-0 z-20 mt-1 flex w-64 flex-col gap-1 rounded-lg border border-border bg-panel p-1.5 shadow-md" onClick={() => ref.current?.removeAttribute("open")}>
        {children}
      </div>
    </details>
  );
}
