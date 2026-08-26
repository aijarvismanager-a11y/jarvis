import { useState } from "react";
import { Modal } from "./Modal";
import type { WorkflowStep } from "../types/workflow";

type Props = {
  nextIndex: number;
  onCancel: () => void;
  onCreate: (step: WorkflowStep) => void;
};

function toFileList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const inputClass =
  "w-full border border-border rounded-lg px-3 py-2 text-[13px] bg-bg focus:outline-none focus:ring-2 focus:ring-accent/40";
const labelClass = "text-[11px] font-semibold text-muted uppercase tracking-wide";

export function AddStepModal({ nextIndex, onCancel, onCreate }: Props) {
  const [role, setRole] = useState("");
  const [aiName, setAiName] = useState("");
  const [inputFiles, setInputFiles] = useState("");
  const [outputFiles, setOutputFiles] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [commandTemplate, setCommandTemplate] = useState("");

  const canSubmit = role.trim() && aiName.trim() && promptTemplate.trim();

  function handleSubmit() {
    if (!canSubmit) return;
    const step: WorkflowStep = {
      id: `step_${Date.now()}`,
      index: nextIndex,
      ai_name: aiName.trim(),
      role: role.trim(),
      status: "pending",
      input_files: toFileList(inputFiles),
      output_files: toFileList(outputFiles),
      prompt_template: promptTemplate.trim(),
      command_template: commandTemplate.trim() || null,
    };
    onCreate(step);
  }

  return (
    <Modal title="新しいステップを追加" onClose={onCancel}>
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>役割（例: Reviewer（設計レビュー））</span>
        <input className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>担当AI（例: Claude Code (CLI)）</span>
        <input className={inputClass} value={aiName} onChange={(e) => setAiName(e.target.value)} />
      </div>
      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-1.5">
          <span className={labelClass}>入力ファイル（カンマ区切り）</span>
          <input className={inputClass} value={inputFiles} onChange={(e) => setInputFiles(e.target.value)} />
        </div>
        <div className="flex-1 flex flex-col gap-1.5">
          <span className={labelClass}>出力ファイル（カンマ区切り）</span>
          <input className={inputClass} value={outputFiles} onChange={(e) => setOutputFiles(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>プロンプトテンプレート</span>
        <textarea
          className={`${inputClass} min-h-[80px] resize-y`}
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Claude Code コマンド（任意・CLI系ステップのみ）</span>
        <input className={inputClass} value={commandTemplate} onChange={(e) => setCommandTemplate(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 rounded-[9px] border border-border text-[13px] font-semibold">
          キャンセル
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="px-4 py-2 rounded-[9px] bg-accent text-white text-[13px] font-semibold disabled:opacity-40"
        >
          追加する
        </button>
      </div>
    </Modal>
  );
}
