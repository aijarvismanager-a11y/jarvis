import { useEffect, useState } from "react";

const STORAGE_KEY = "ai-orchestrator-welcomed";

export function WelcomeBanner() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // localStorage unavailable — dismissal just won't persist across reloads
    }
  }

  if (dismissed) return null;

  return (
    <div className="flex items-start gap-4 px-6 py-4 border-b border-border" style={{ background: "color-mix(in oklch, #B5563A 6%, white)" }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#B5563A" strokeWidth="1.8" className="shrink-0 mt-0.5">
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2.5v3.2M12 18.3v3.2M21.5 12h-3.2M5.7 12H2.5M18.3 5.7l-2.3 2.3M8 13.7l-2.3 2.3M18.3 18.3l-2.3-2.3M8 10.3L5.7 8" />
      </svg>
      <div className="flex-1 text-[13px] leading-relaxed text-ink">
        <div className="font-semibold mb-1">はじめに：まずは左の「ワークフロー」からステップを1つクリックしてください</div>
        <div className="text-muted">
          このアプリは、複数のAIに工程ごとの作業を順番にリレーしていくための道具です。
          <b className="text-ink">左</b>で工程（アイデア出し→設計→実装…）を選ぶと、<b className="text-ink">中央</b>にそのままAIへ渡せるプロンプトが用意され、
          作業結果は<b className="text-ink">右</b>のArtifactsで確認できます。詳しい使い方は
          <a href="/MANUAL.html" target="_blank" rel="noreferrer" className="mx-1">取扱説明書</a>
          をご覧ください。
        </div>
      </div>
      <button
        onClick={dismiss}
        className="shrink-0 px-3 py-1.5 rounded-lg border border-border bg-white text-[12.5px] font-semibold"
      >
        わかった
      </button>
    </div>
  );
}
