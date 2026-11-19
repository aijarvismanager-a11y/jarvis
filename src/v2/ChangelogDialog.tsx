import { useEffect } from "react";
import { CHANGELOG } from "./changelog";
import { Button } from "./ui";

export function ChangelogDialog({ onClose, version }: { onClose: () => void; version: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    // a side panel, not a full-screen window: the page behind it stays visible and usable while it is read
    <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-[420px] overflow-y-auto border-l border-border bg-panel p-5 shadow-xl" aria-label="更新履歴">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-serif text-[20px] font-semibold">更新履歴</h2>
        <Button variant="ghost" onClick={onClose}>閉じる</Button>
      </div>
      {version && <p className="mt-1 text-[12px] text-muted">いまのバージョン {version}</p>}
      {/* the newest versions are open, the older ones fold away (there are dozens) */}
      <div className="mt-3 divide-y divide-borderSoft rounded-lg border border-borderSoft">
        {CHANGELOG.map((c, i) => (
          <details key={c.version} open={i < 2} className="group px-3 py-2">
            <summary className="cursor-pointer text-[14px] font-semibold marker:content-none">
              <span aria-hidden className="mr-1.5 text-muted">▸</span>v{c.version} <span className="ml-1 text-[12px] font-normal text-muted">{c.date}</span>
            </summary>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px]">
              {c.items.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </details>
        ))}
      </div>
    </aside>
  );
}
