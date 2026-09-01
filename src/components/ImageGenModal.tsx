import { useState } from "react";
import { Modal } from "./Modal";
import type { AiServiceList } from "../types/aiService";
import { IMAGE_SERVICE_IDS, IMAGE_SERVICE_SPECIALTIES, recommendImageService } from "../lib/imageRecommendation";

type Props = {
  aiServices: AiServiceList;
  onClose: () => void;
  onOpenService: (url: string) => void;
};

function fallbackCopy(text: string): boolean {
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(el);
  return ok;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return fallbackCopy(text);
  } catch {
    return fallbackCopy(text);
  }
}

export function ImageGenModal({ aiServices, onClose, onOpenService }: Props) {
  const imageServices = aiServices.filter((s) => IMAGE_SERVICE_IDS.includes(s.id));

  const [text, setText] = useState("");
  const [asked, setAsked] = useState(false);
  const [recommendedId, setRecommendedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleAsk() {
    if (!text.trim()) return;
    const rec = recommendImageService(text);
    setAsked(true);
    setRecommendedId(rec?.serviceId ?? null);
    setReason(rec?.reason ?? "");
    setSelectedId(rec?.serviceId ?? imageServices[0]?.id ?? null);
  }

  const selectedService = imageServices.find((s) => s.id === selectedId) ?? null;

  async function handleCopyAndOpen() {
    if (!selectedService?.url) return;
    if (text.trim()) {
      const ok = await copyText(text.trim());
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    }
    onOpenService(selectedService.url);
  }

  return (
    <Modal title="どんな画像を作りたいですか？" onClose={onClose}>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted leading-relaxed">
          欲しい画像の内容を書いてください。内容に応じて、向いていそうな画像生成AIを提案します。
        </span>
        <textarea
          className="w-full border border-border rounded-lg px-3 py-2 text-[13px] bg-bg focus:outline-none focus:ring-2 focus:ring-accent/40 min-h-[100px] resize-y"
          placeholder="例）商品ロゴ用に、文字入りのシンプルなアイコン画像が欲しい"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setAsked(false);
            setRecommendedId(null);
          }}
          autoFocus
        />
      </div>

      {!asked ? (
        <div className="flex justify-end pt-1">
          <button
            onClick={handleAsk}
            disabled={!text.trim()}
            className="px-4 py-2 rounded-[9px] bg-accent text-white text-[13px] font-semibold disabled:opacity-40"
          >
            おすすめの画像生成AIを聞く
          </button>
        </div>
      ) : (
        <>
          {recommendedId ? (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-bg border border-borderSoft">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B5563A" strokeWidth="2" className="shrink-0 mt-0.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              <div className="text-[13px] leading-relaxed">
                <span className="font-semibold text-accent">
                  {imageServices.find((s) => s.id === recommendedId)?.name ?? recommendedId}
                </span>{" "}
                がおすすめです。
                <div className="text-muted mt-0.5">{reason}</div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-bg border border-borderSoft">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A8578" strokeWidth="2" className="shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16h.01" />
              </svg>
              <div className="text-[13px] leading-relaxed text-muted">
                この内容からは、特に強くおすすめできるAIが見つかりませんでした。下のプルダウンに各AIの得意分野を載せているので、参考にして選んでください。
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
              使うAI（しっくり来なければ変更できます）
            </span>
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-[13px] bg-bg focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              {imageServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {IMAGE_SERVICE_SPECIALTIES[s.id] ? ` — ${IMAGE_SERVICE_SPECIALTIES[s.id]}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end pt-1">
            <button
              onClick={handleCopyAndOpen}
              disabled={!selectedService?.url}
              className="flex items-center gap-1.5 px-4 py-2 rounded-[9px] bg-accent text-white text-[13px] font-semibold disabled:opacity-40"
            >
              {copied ? "コピーしました → " : "プロンプトをコピーして "}
              {selectedService?.name ?? ""} を開く ↗
            </button>
          </div>
        </>
      )}

      <div className="flex justify-start pt-1 border-t border-borderSoft mt-1">
        <button onClick={onClose} className="mt-3 px-4 py-2 rounded-[9px] border border-border text-[13px] font-semibold">
          閉じる
        </button>
      </div>
    </Modal>
  );
}
