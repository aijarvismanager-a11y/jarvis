import { useState } from "react";
import { Modal } from "./Modal";
import type { WorkflowStep } from "../types/workflow";

type Props = {
  step: WorkflowStep;
  onCancel: () => void;
  onSave: (promptTemplate: string, commandTemplate: string | null) => void;
};

const inputClass =
  "w-full border border-border rounded-lg px-3 py-2 text-[13px] bg-bg focus:outline-none focus:ring-2 focus:ring-accent/40";
const labelClass = "text-[11px] font-semibold text-muted uppercase tracking-wide";

export function EditTemplateModal({ step, onCancel, onSave }: Props) {
  const [promptTemplate, setPromptTemplate] = useState(step.prompt_template);
  const [commandTemplate, setCommandTemplate] = useState(step.command_template ?? "");

  return (
    <Modal title={`テンプレートを編集 — ${step.role}`} onClose={onCancel}>
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>プロンプトテンプレート</span>
        <textarea
          className={`${inputClass} min-h-[120px] resize-y`}
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>
          Claude Code コマンド（空欄の場合、担当AIが「Claude Code」を含むステップは入力・出力ファイルから自動生成されます。「ローカルで実行」で使う場合は
          <code className="mx-1 px-1 rounded bg-bg">-p --permission-mode acceptEdits</code>
          を付けないと対話モードで待機してタイムアウトします）
        </span>
        <input className={inputClass} value={commandTemplate} onChange={(e) => setCommandTemplate(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 rounded-[9px] border border-border text-[13px] font-semibold">
          キャンセル
        </button>
        <button
          onClick={() => onSave(promptTemplate.trim(), commandTemplate.trim() || null)}
          disabled={!promptTemplate.trim()}
          className="px-4 py-2 rounded-[9px] bg-accent text-white text-[13px] font-semibold disabled:opacity-40"
        >
          保存
        </button>
      </div>
    </Modal>
  );
}
