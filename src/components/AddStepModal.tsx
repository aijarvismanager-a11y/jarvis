import { useState } from "react";
import { Modal } from "./Modal";
import type { WorkflowStep } from "../types/workflow";
import { TASK_CATEGORIES } from "../lib/taskCategories";

type Props = {
  projectId: string;
  nextIndex: number;
  initial?: { role: string; aiName: string; promptTemplate: string };
  onCancel: () => void;
  onCreate: (step: WorkflowStep) => void;
  onUpsertService: (name: string, url: string) => void;
};

// Users type paths relative to their own project ("docs/x.md"); stored
// paths are "workspace/<projectId>/docs/x.md" so the server can resolve
// them under that project's own folder.
function toFileList(text: string, projectId: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("workspace/") ? s : `workspace/${projectId}/${s}`));
}

const inputClass =
  "w-full border border-border rounded-lg px-3 py-2 text-[13px] bg-bg focus:outline-none focus:ring-2 focus:ring-accent/40";
const labelClass = "text-[11px] font-semibold text-muted uppercase tracking-wide";

export function AddStepModal({ projectId, nextIndex, initial, onCancel, onCreate, onUpsertService }: Props) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [role, setRole] = useState(initial?.role ?? "");
  const [aiName, setAiName] = useState(initial?.aiName ?? "");
  const [aiUrl, setAiUrl] = useState("");
  const [inputFiles, setInputFiles] = useState("");
  const [outputFiles, setOutputFiles] = useState(initial ? "docs/ideas.md" : "");
  const [promptTemplate, setPromptTemplate] = useState(initial?.promptTemplate ?? "");
  const [commandTemplate, setCommandTemplate] = useState("");

  const selectedCategory = TASK_CATEGORIES.find((c) => c.id === categoryId) ?? null;

  const canSubmit = role.trim() && aiName.trim() && promptTemplate.trim();

  function applyCategory(id: string) {
    setCategoryId(id);
    const cat = TASK_CATEGORIES.find((c) => c.id === id);
    if (!cat || cat.id === "custom") return;
    setRole(cat.role);
    setAiName(cat.recommendedAi);
    setPromptTemplate(cat.promptTemplate);
    setInputFiles(cat.inputHint);
    setOutputFiles(cat.outputHint);
  }

  function handleSubmit() {
    if (!canSubmit) return;
    if (aiUrl.trim()) onUpsertService(aiName, aiUrl);
    const step: WorkflowStep = {
      id: `step_${Date.now()}`,
      index: nextIndex,
      ai_name: aiName.trim(),
      role: role.trim(),
      status: "pending",
      input_files: toFileList(inputFiles, projectId),
      output_files: toFileList(outputFiles, projectId),
      prompt_template: promptTemplate.trim(),
      command_template: commandTemplate.trim() || null,
    };
    onCreate(step);
  }

  return (
    <Modal title="新しいステップを追加" onClose={onCancel}>
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>どんな作業をしたいですか？（選ぶとAIと項目が自動で埋まります）</span>
        <div className="flex flex-wrap gap-1.5">
          {TASK_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => applyCategory(cat.id)}
              className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold border transition-colors"
              style={
                categoryId === cat.id
                  ? { background: "#B5563A", color: "white", borderColor: "#B5563A" }
                  : { background: "#FFFFFF", color: "#2B2A26", borderColor: "#E9E4D9" }
              }
            >
              {cat.label}
            </button>
          ))}
        </div>
        {selectedCategory && selectedCategory.reason && (
          <div className="flex items-start gap-2 mt-0.5 px-3 py-2 rounded-lg bg-bg border border-borderSoft">
            <span className="text-[12px] leading-relaxed text-muted">
              <span className="font-semibold text-ink">おすすめ: {selectedCategory.recommendedAi}</span> —{" "}
              {selectedCategory.reason}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>役割（例: Reviewer（設計レビュー））</span>
        <input className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>担当AI（例: Claude Code (CLI)）</span>
        <input className={inputClass} value={aiName} onChange={(e) => setAiName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>AIのリンク（任意・入力すると「開く」ボタンが使えるようになります）</span>
        <input
          className={inputClass}
          placeholder="https://..."
          value={aiUrl}
          onChange={(e) => setAiUrl(e.target.value)}
        />
      </div>
      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-1.5">
          <span className={labelClass}>入力ファイル（カンマ区切り、例: docs/x.md）</span>
          <input className={inputClass} value={inputFiles} onChange={(e) => setInputFiles(e.target.value)} />
        </div>
        <div className="flex-1 flex flex-col gap-1.5">
          <span className={labelClass}>出力ファイル（カンマ区切り、例: docs/y.md）</span>
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
