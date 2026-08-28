import { useState } from "react";
import { Modal } from "./Modal";

type Props = {
  onCancel: () => void;
  onCreate: (name: string) => void;
};

const inputClass =
  "w-full border border-border rounded-lg px-3 py-2 text-[13px] bg-bg focus:outline-none focus:ring-2 focus:ring-accent/40";

export function NewProjectModal({ onCancel, onCreate }: Props) {
  const [name, setName] = useState("");

  function handleCreate() {
    if (!name.trim()) return;
    onCreate(name.trim());
  }

  return (
    <Modal title="新しいプロジェクト" onClose={onCancel}>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted leading-relaxed">
          プロジェクトごとにワークフローとファイルが分かれます。名前は後からいつでも変えられます。
        </span>
        <input
          className={inputClass}
          placeholder="例）サッカー日本代表のサイト"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          autoFocus
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 rounded-[9px] border border-border text-[13px] font-semibold">
          キャンセル
        </button>
        <button
          onClick={handleCreate}
          disabled={!name.trim()}
          className="px-4 py-2 rounded-[9px] bg-accent text-white text-[13px] font-semibold disabled:opacity-40"
        >
          作成する
        </button>
      </div>
    </Modal>
  );
}
