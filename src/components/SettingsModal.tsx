import { useState } from "react";
import { Modal } from "./Modal";
import type { AiService, AiServiceList } from "../types/aiService";
import { fetchOllamaStatus, type OllamaConfig, type OllamaStatus } from "../lib/api";

type Props = {
  services: AiServiceList;
  ollamaConfig: OllamaConfig;
  onCancel: () => void;
  onSave: (services: AiServiceList) => void;
  onSaveOllamaConfig: (config: OllamaConfig) => void;
};

const inputClass =
  "w-full border border-border rounded-lg px-2.5 py-1.5 text-[13px] bg-bg focus:outline-none focus:ring-2 focus:ring-accent/40";

function makeId() {
  return `svc_${Date.now()}`;
}

export function SettingsModal({ services, ollamaConfig, onCancel, onSave, onSaveOllamaConfig }: Props) {
  const [list, setList] = useState<AiServiceList>(services);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [ollamaDraft, setOllamaDraft] = useState<OllamaConfig>(ollamaConfig);
  const [checkingOllama, setCheckingOllama] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);

  async function checkOllama() {
    setCheckingOllama(true);
    setOllamaStatus(null);
    try {
      setOllamaStatus(await fetchOllamaStatus(ollamaDraft.baseUrl));
    } finally {
      setCheckingOllama(false);
    }
  }

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

      <div className="flex flex-col gap-2 pt-2 border-t border-borderSoft">
        <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
          ローカルLLM（Ollama）
        </span>
        <span className="text-[12px] text-muted leading-relaxed -mt-1">
          手元のPCで動く無料モデルです。API課金なし・外部送信なし。あらかじめ
          <a href="https://ollama.com" target="_blank" rel="noreferrer" className="text-accent underline">
            Ollama
          </a>
          をインストールし、使いたいモデルを取得しておいてください（例: <code>ollama pull llama3.2</code>）。
        </span>
        <div className="flex items-center gap-2">
          <input
            className={inputClass}
            value={ollamaDraft.baseUrl}
            onChange={(e) => setOllamaDraft((d) => ({ ...d, baseUrl: e.target.value }))}
            placeholder="http://localhost:11434"
          />
          <input
            className={inputClass}
            value={ollamaDraft.model}
            onChange={(e) => setOllamaDraft((d) => ({ ...d, model: e.target.value }))}
            placeholder="モデル名（例: llama3.2）"
          />
          <button
            onClick={checkOllama}
            disabled={checkingOllama}
            className="shrink-0 px-3 py-1.5 rounded-lg border border-border text-[12.5px] font-semibold disabled:opacity-50"
          >
            {checkingOllama ? "確認中..." : "接続確認"}
          </button>
        </div>
        {ollamaStatus && (
          <span className="text-[12px]" style={{ color: ollamaStatus.connected ? "#3F6B52" : "#8A3A2A" }}>
            {ollamaStatus.connected
              ? ollamaStatus.models.length > 0
                ? `接続できました。インストール済みモデル: ${ollamaStatus.models.join(", ")}`
                : "接続できました（モデルが1つも取得されていません）"
              : "接続できませんでした。Ollamaが起動しているか、URLを確認してください。"}
          </span>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 rounded-[9px] border border-border text-[13px] font-semibold">
          キャンセル
        </button>
        <button
          onClick={() => {
            onSave(list);
            onSaveOllamaConfig(ollamaDraft);
          }}
          className="px-4 py-2 rounded-[9px] bg-accent text-white text-[13px] font-semibold"
        >
          保存
        </button>
      </div>
    </Modal>
  );
}
