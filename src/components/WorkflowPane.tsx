import type { WorkflowStep } from "../types/workflow";

const STATUS_META: Record<WorkflowStep["status"], { label: string; color: string; bg: string }> = {
  done: { label: "完了", color: "#3F6B52", bg: "color-mix(in oklch, #3F6B52 14%, white)" },
  active: { label: "進行中", color: "#B5563A", bg: "color-mix(in oklch, #B5563A 14%, white)" },
  pending: { label: "未着手", color: "#8A8578", bg: "#F1EFEA" },
};

type Props = {
  steps: WorkflowStep[];
  selectedStepId: string | null;
  onSelect: (id: string) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
};

export function WorkflowPane({ steps, selectedStepId, onSelect, onMove, onAdd, onDelete }: Props) {
  return (
    <div className="flex flex-col w-[280px] shrink-0 border-r border-border bg-sidebar">
      <div className="flex items-center justify-between px-4 pt-4 pb-2.5">
        <span className="text-xs font-semibold text-muted tracking-wide uppercase">ワークフロー</span>
        <button onClick={onAdd} className="flex items-center gap-1 text-accent text-xs font-semibold px-1.5 py-1 rounded-md">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          追加
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-3 flex flex-col gap-1.5">
        {steps.length === 0 && (
          <div className="flex flex-col items-center gap-2.5 text-center px-3 py-8">
            <span className="text-[13px] font-semibold text-ink">まだステップがありません</span>
            <span className="text-[12px] text-muted leading-relaxed">
              上の「＋追加」から最初のステップ（アイデア出しなど）を作成すると、ここに表示されます。
            </span>
            <button
              onClick={onAdd}
              className="mt-1 px-3.5 py-1.5 rounded-lg bg-accent text-white text-[12.5px] font-semibold"
            >
              最初のステップを追加する
            </button>
          </div>
        )}
        {steps.map((step, i) => {
          const meta = STATUS_META[step.status];
          const selected = step.id === selectedStepId;
          return (
            <div
              key={step.id}
              onClick={() => onSelect(step.id)}
              className="flex flex-col gap-2 px-2.5 py-2.5 rounded-[10px] cursor-pointer"
              style={{ background: selected ? "color-mix(in oklch, #B5563A 10%, white)" : "transparent" }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-px"
                    style={{ background: meta.bg, color: meta.color }}
                  >
                    {step.index}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className={`text-[13px] leading-tight ${selected ? "font-bold" : "font-medium"}`}>
                      {step.role}
                    </span>
                    <span className="text-[11.5px] text-muted">{step.ai_name}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-0.5">
                  <button
                    className="p-0.5 opacity-55 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMove(i, -1);
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2B2A26" strokeWidth="2.3">
                      <path d="M18 15l-6-6-6 6" />
                    </svg>
                  </button>
                  <button
                    className="p-0.5 opacity-55 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMove(i, 1);
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2B2A26" strokeWidth="2.3">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between pl-7">
                <span
                  className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ background: meta.bg, color: meta.color }}
                >
                  {meta.label}
                </span>
                <button
                  className="p-0.5 opacity-40 hover:opacity-100"
                  title="ステップを削除"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(step.id);
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8A3A2A" strokeWidth="2">
                    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-3 border-t border-border text-[11.5px] text-muted leading-relaxed">
        矢印ボタンで実行順を変更できます。
      </div>
    </div>
  );
}
