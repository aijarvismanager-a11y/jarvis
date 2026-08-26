import { useState } from "react";
import type { WorkflowStep } from "../types/workflow";

const STATUS_META: Record<WorkflowStep["status"], { label: string; color: string; bg: string }> = {
  done: { label: "完了", color: "#3F6B52", bg: "color-mix(in oklch, #3F6B52 14%, white)" },
  active: { label: "進行中", color: "#B5563A", bg: "color-mix(in oklch, #B5563A 14%, white)" },
  pending: { label: "未着手", color: "#8A8578", bg: "#F1EFEA" },
};

type Props = {
  step: WorkflowStep;
  prompt: string;
  loadingPrompt: boolean;
  onAdvance: () => void;
  onEditTemplate: () => void;
};

export function PromptPane({ step, prompt, loadingPrompt, onAdvance, onEditTemplate }: Props) {
  const [copied, setCopied] = useState(false);
  const meta = STATUS_META[step.status];

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard permission denied — silently ignore, button just won't confirm
    }
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-panel">
      <div className="px-7 pt-5 pb-3.5 border-b border-borderSoft">
        <div className="flex items-center gap-2.5">
          <span className="font-serif text-xl font-semibold">{step.role}</span>
          <span
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: meta.bg, color: meta.color }}
          >
            {meta.label}
          </span>
        </div>
        <div className="mt-1 text-[13px] text-muted">担当AI: {step.ai_name}</div>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-5 flex flex-col gap-4.5">
        <div className="flex gap-6">
          <div className="flex-1 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">入力ファイル</span>
            <span className="text-[13px] font-mono">
              {step.input_files.length ? step.input_files.join(" / ") : "なし（起点ステップ）"}
            </span>
          </div>
          <div className="flex-1 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">出力ファイル</span>
            <span className="text-[13px] font-mono">{step.output_files.join(" / ")}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">生成されたプロンプト</span>
          <div className="border border-border rounded-xl p-4 bg-bg text-[13.5px] leading-relaxed whitespace-pre-line min-h-[80px]">
            {loadingPrompt ? "入力ファイルを読み込み中..." : prompt}
          </div>
          <div className="flex gap-2.5 mt-0.5">
            <button
              onClick={handleCopy}
              disabled={loadingPrompt}
              className="flex items-center gap-1.5 px-4 py-2 rounded-[9px] bg-accent text-white text-[13px] font-semibold disabled:opacity-50"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              {copied ? "コピーしました" : "プロンプトをコピー"}
            </button>
            <button
              onClick={onEditTemplate}
              className="px-4 py-2 rounded-[9px] border border-border bg-white text-[13px] font-semibold"
            >
              テンプレートを編集
            </button>
          </div>
        </div>

        {step.command_template && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
              Claude Code 実行コマンド
            </span>
            <div className="flex items-center justify-between gap-3 rounded-[10px] px-3.5 py-3 bg-ink text-[#F4EFE4] font-mono text-[12.5px]">
              <span>{step.command_template}</span>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#F4EFE4"
                strokeWidth="2"
                className="shrink-0"
              >
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            </div>
          </div>
        )}
      </div>

      <div className="px-7 py-3.5 border-t border-borderSoft flex justify-end">
        <button
          onClick={onAdvance}
          disabled={step.status === "done"}
          className="px-5 py-2.5 rounded-[9px] bg-ink text-white text-[13.5px] font-semibold disabled:opacity-40"
        >
          成果物の回収を完了し、次のステップへ
        </button>
      </div>
    </div>
  );
}
