import { Modal } from "./Modal";
import { BUILTIN_TEMPLATES, type BuiltinTemplate } from "../lib/builtinTemplates";

type Props = {
  onCancel: () => void;
  onSelectTemplate: (template: BuiltinTemplate) => void;
  onFreeform: () => void;
};

export function NewProjectModal({ onCancel, onSelectTemplate, onFreeform }: Props) {
  return (
    <Modal title="新しいプロジェクト" onClose={onCancel}>
      <p className="text-[12.5px] text-muted leading-relaxed -mt-1">
        よくある進め方ならテンプレートから始めると、工程・担当AI・プロンプトが一通り揃った状態でスタートできます。もちろん後から自由に編集できます。
      </p>

      <div className="flex flex-col gap-2">
        {BUILTIN_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelectTemplate(t)}
            className="flex flex-col items-start gap-0.5 text-left rounded-xl border border-border p-3.5 hover:border-accent"
          >
            <span className="text-[13.5px] font-bold text-ink">{t.label}</span>
            <span className="text-[12px] text-muted">{t.description}</span>
            <span className="text-[11px] text-muted font-mono mt-1">
              {t.template.steps.map((s) => s.role.replace(/（.*）/, "")).join(" → ")}
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <div className="flex-1 h-px bg-borderSoft" />
        <span className="text-[11.5px] text-muted">または</span>
        <div className="flex-1 h-px bg-borderSoft" />
      </div>

      <button
        onClick={onFreeform}
        className="w-full text-left rounded-xl border border-dashed border-border p-3.5 hover:border-accent hover:text-accent text-[13px] font-semibold text-muted"
      >
        自由に始める（アイデア出しから、1ステップずつ自分で組む）
      </button>

      <div className="flex justify-end pt-1">
        <button onClick={onCancel} className="px-4 py-2 rounded-[9px] border border-border text-[13px] font-semibold">
          キャンセル
        </button>
      </div>
    </Modal>
  );
}
