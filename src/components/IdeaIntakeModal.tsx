import { useState } from "react";
import { Modal } from "./Modal";
import type { WorkflowStep } from "../types/workflow";
import { recommend, type Recommendation } from "../lib/ideaRecommendation";

type Props = {
  nextIndex: number;
  onCancel: () => void;
  onCreate: (step: WorkflowStep) => void;
  onEditManually: (seed: { role: string; aiName: string; promptTemplate: string }) => void;
};

const inputClass =
  "w-full border border-border rounded-lg px-3 py-2 text-[13px] bg-bg focus:outline-none focus:ring-2 focus:ring-accent/40";

export function IdeaIntakeModal({ nextIndex, onCancel, onCreate, onEditManually }: Props) {
  const [text, setText] = useState("");
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);

  function handleAsk() {
    if (!text.trim()) return;
    setRecommendation(recommend(text));
  }

  function handleCreate() {
    if (!recommendation) return;
    const step: WorkflowStep = {
      id: `step_${Date.now()}`,
      index: nextIndex,
      ai_name: recommendation.service,
      role: "Ideator（アイデア出し）",
      status: "pending",
      input_files: [],
      output_files: ["workspace/docs/ideas.md"],
      prompt_template: text.trim(),
      command_template: null,
    };
    onCreate(step);
  }

  return (
    <Modal title="何を作りたいですか？" onClose={onCancel}>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted leading-relaxed">
          役割やAIを先に決める必要はありません。思いついたことをそのまま書いてください。内容に応じて、向いていそうなAIを提案します。
        </span>
        <textarea
          className={`${inputClass} min-h-[110px] resize-y`}
          placeholder="例）家計簿をつけるのが面倒なので、レシートを撮るだけで自動で記録してくれるアプリが欲しい"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setRecommendation(null);
          }}
          autoFocus
        />
      </div>

      {!recommendation ? (
        <div className="flex justify-end pt-1">
          <button
            onClick={handleAsk}
            disabled={!text.trim()}
            className="px-4 py-2 rounded-[9px] bg-accent text-white text-[13px] font-semibold disabled:opacity-40"
          >
            おすすめのAIを聞く
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-bg border border-borderSoft">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B5563A" strokeWidth="2" className="shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 2.5v3.2M12 18.3v3.2M21.5 12h-3.2M5.7 12H2.5M18.3 5.7l-2.3 2.3M8 13.7l-2.3 2.3M18.3 18.3l-2.3-2.3M8 10.3L5.7 8" />
            </svg>
            <div className="text-[13px] leading-relaxed">
              <span className="font-semibold text-accent">{recommendation.service}</span> がおすすめです。
              <div className="text-muted mt-0.5">{recommendation.reason}</div>
            </div>
          </div>
          <span className="text-[11.5px] text-muted">
            ※ 内容に含まれる言葉から機械的に判定した目安です。しっくり来なければ下から手動で選び直せます。
          </span>
          <div className="flex justify-between items-center pt-1">
            <button
              onClick={() =>
                onEditManually({ role: "Ideator（アイデア出し）", aiName: recommendation.service, promptTemplate: text.trim() })
              }
              className="text-[12.5px] text-muted hover:text-ink underline"
            >
              自分でAIを選び直す／詳しく編集する
            </button>
            <button onClick={handleCreate} className="px-4 py-2 rounded-[9px] bg-accent text-white text-[13px] font-semibold">
              このAIでステップを作る
            </button>
          </div>
        </>
      )}

      <div className="flex justify-start pt-1 border-t border-borderSoft mt-1">
        <button onClick={onCancel} className="mt-3 px-4 py-2 rounded-[9px] border border-border text-[13px] font-semibold">
          キャンセル
        </button>
      </div>
    </Modal>
  );
}
