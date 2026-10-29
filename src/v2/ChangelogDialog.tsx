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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="更新履歴" onClick={onClose}>
      <div className="my-6 w-full max-w-xl rounded-xl border border-border bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-serif text-[20px] font-semibold">更新履歴</h2>
          <Button variant="ghost" onClick={onClose}>閉じる</Button>
        </div>
        {version && <p className="mt-1 text-[12px] text-muted">いまのバージョン {version}</p>}
        <div className="mt-3 space-y-4">
          {CHANGELOG.map((c) => (
            <section key={c.version}>
              <h3 className="text-[14px] font-semibold">v{c.version} <span className="ml-1 text-[12px] font-normal text-muted">{c.date}</span></h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px]">
                {c.items.map((t) => <li key={t}>{t}</li>)}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
