import { useState } from "react";
import { TEXT_SIZES, applyTextSize, readTextSize, type TextSizeId } from "./textSize";

/** 文字の大きさ: 標準 / 大 / 特大. The choice is remembered on this PC. */
export function TextSizeControl() {
  const [size, setSize] = useState<TextSizeId>(readTextSize);
  const pick = (id: TextSizeId) => {
    setSize(id);
    applyTextSize(id);
  };
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-panel px-2 py-1" role="group" aria-label="文字の大きさ" title="画面の文字の大きさを変えます">
      <span className="text-[12px] text-muted">文字</span>
      {TEXT_SIZES.map((s) => (
        <button key={s.id} type="button" aria-pressed={size === s.id} onClick={() => pick(s.id)} className={`rounded px-2 py-0.5 text-[13px] font-semibold ${size === s.id ? "bg-accent text-white" : "hover:bg-sidebar"}`}>
          {s.label}
        </button>
      ))}
    </div>
  );
}
