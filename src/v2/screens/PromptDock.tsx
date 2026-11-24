import { useState } from "react";
import { dockMode, isSendKey } from "../dock";

/** The one place to give an instruction, pinned to the bottom of the screen like Claude Code's prompt box. */
export function PromptDock({ status, planWaiting, busy, onSend }: { status: string | null; planWaiting: boolean; busy: boolean; onSend: (kind: ReturnType<typeof dockMode>["kind"], text: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const mode = dockMode(status, planWaiting);
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    if (mode.confirm && !window.confirm(mode.confirm)) return;
    if (await onSend(mode.kind, t)) setText(""); // kept when it failed, so nothing typed is lost
  };
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-border bg-bg/95 px-4 pb-3 pt-2 backdrop-blur lg:-mx-6 lg:px-6" role="region" aria-label="指示を入力">
      <div className="mx-auto flex max-w-[900px] items-end gap-2">
        <textarea
          aria-label="AIへの指示"
          value={text}
          rows={1}
          maxLength={4000}
          disabled={busy}
          placeholder={mode.placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (isSendKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) { e.preventDefault(); void send(); } }}
          className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-panel px-3.5 py-2.5 text-[14px] leading-relaxed outline-none [field-sizing:content] focus:border-accent disabled:opacity-60"
        />
        <button type="button" disabled={busy || !text.trim()} onClick={() => void send()} className="h-[44px] shrink-0 rounded-xl bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50">{busy ? "送信中…" : mode.button}</button>
      </div>
      <p className="mx-auto mt-1 max-w-[900px] text-[11.5px] text-muted">{mode.hint}</p>
    </div>
  );
}
