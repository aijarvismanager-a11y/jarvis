import { useState } from "react";
import { Modal } from "./Modal";
import type { AiService, AiServiceList } from "../types/aiService";

type Props = {
  services: AiServiceList;
  onCancel: () => void;
  onSave: (services: AiServiceList) => void;
};

const inputClass =
  "w-full border border-border rounded-lg px-2.5 py-1.5 text-[13px] bg-bg focus:outline-none focus:ring-2 focus:ring-accent/40";

function makeId() {
  return `svc_${Date.now()}`;
}

export function SettingsModal({ services, onCancel, onSave }: Props) {
  const [list, setList] = useState<AiServiceList>(services);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  function updateField(id: string, patch: Partial<AiService>) {
    setList((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function removeService(id: string) {
    setList((prev) => prev.filter((s) => s.id !== id));
  }

  function addService() {
    if (!newName.trim()) return;
    setList((prev) => [...prev, { id: makeId(), name: newName.trim(), url: newUrl.trim() || null }]);
    setNewName("");
    setNewUrl("");
  }

  return (
    <Modal title="AIサービスの管理" onClose={onCancel}>
      <div className="flex flex-col gap-2">
        {list.map((svc) => (
          <div key={svc.id} className="flex items-center gap-2">
            <input
              className={inputClass}
              value={svc.name}
              onChange={(e) => updateField(svc.id, { name: e.target.value })}
              placeholder="サービス名"
            />
            <input
              className={inputClass}
              value={svc.url ?? ""}
              onChange={(e) => updateField(svc.id, { url: e.target.value.trim() || null })}
              placeholder="URL（CLIツール等は空欄）"
            />
            <button onClick={() => removeService(svc.id)} className="p-1.5 opacity-50 hover:opacity-100 shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8A3A2A" strokeWidth="2">
                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
              </svg>
            </button>
          </div>
        ))}
        {list.length === 0 && <span className="text-[12.5px] text-muted">登録されているAIサービスはありません</span>}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-borderSoft">
        <input
          className={inputClass}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新しいサービス名"
        />
        <input
          className={inputClass}
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          placeholder="URL（任意）"
        />
        <button
          onClick={addService}
          disabled={!newName.trim()}
          className="p-1.5 text-accent disabled:opacity-30 shrink-0"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 rounded-[9px] border border-border text-[13px] font-semibold">
          キャンセル
        </button>
        <button
          onClick={() => onSave(list)}
          className="px-4 py-2 rounded-[9px] bg-accent text-white text-[13px] font-semibold"
        >
          保存
        </button>
      </div>
    </Modal>
  );
}
