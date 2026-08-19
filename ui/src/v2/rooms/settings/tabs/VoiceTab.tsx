import React from "react";
import type { RealtimeReasoningEffort, SettingsHook } from "../useSettingsData";
import { Chip } from "../../../ui";

/** OpenAI realtime voices (gpt-realtime-2). */
const REALTIME_VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "sage", "shimmer", "verse"];

const REASONING_EFFORTS: ReadonlyArray<{ id: RealtimeReasoningEffort; label: string }> = [
  { id: "minimal", label: "最小 - 最速・最も簡略" },
  { id: "low", label: "低 - デフォルト・低遅延" },
  { id: "medium", label: "中 - バランス型" },
  { id: "high", label: "高 - より熟考する" },
  { id: "xhigh", label: "最高 - 最も熟考する・遅延/コスト最大" },
];

export function VoiceTab({
  data,
  onToast,
}: {
  data: SettingsHook;
  onToast: (text: string, tone?: "ok" | "warn") => void;
}) {
  const voice = data.voiceCfg;
  const rt = voice?.realtime;

  const statusChip = !rt?.enabled
    ? { label: "オフ", tone: undefined }
    : rt.available
      ? { label: "有効", tone: "ok" as const }
      : { label: "OpenAIキーなし", tone: "warn" as const };

  return (
    <div className="v2-set__tabpane">
      <section className="v2-set__section">
        <div className="v2-set__section-head">
          <div>
            <h3 className="v2-set__section-title">プレミアム リアルタイムボイス</h3>
            <div className="v2-set__section-sub">
              OpenAIのgpt-realtime-2による音声対音声変換 - 低遅延、自然な会話の
              ターン交代、会話中に推論します。設定 &gt; LLM のOpenAIプロバイダーキーを
              再利用します（OpenAIから課金され、約$0.30/分）。デフォルトはオフで、
              標準の音声パイプラインには影響しません。
            </div>
          </div>
          <Chip tone={statusChip.tone}>{statusChip.label}</Chip>
        </div>

        <label className="v2-set__toggle-row">
          <button
            type="button"
            className="v2-set__toggle"
            data-checked={!!rt?.enabled}
            aria-checked={!!rt?.enabled}
            role="switch"
            onClick={async () => {
              const r = await data.setVoiceConfig({ realtime: { enabled: !rt?.enabled } });
              onToast(r.message, r.ok ? "ok" : "warn");
            }}
          />
          <span>プレミアム リアルタイムボイスを有効化</span>
        </label>

        {rt?.enabled && (
          <>
            {!rt.available && (
              <p className="v2-set__hint" data-tone="warn">
                有効化されていますが、OpenAIプロバイダーが設定されていません。設定 &gt; LLM で追加してください。
                それまではJARVISは標準の音声パイプラインを使用します。
              </p>
            )}

            {/* Voice */}
            <div className="v2-set__field">
              <label className="v2-set__field-label">音声</label>
              <select
                className="v2-set__select"
                value={rt.voice ?? "marin"}
                onChange={async (e) => {
                  const r = await data.setVoiceConfig({ realtime: { voice: e.target.value } });
                  onToast(r.message, r.ok ? "ok" : "warn");
                }}
              >
                {REALTIME_VOICES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            {/* Reasoning effort */}
            <div className="v2-set__field">
              <label className="v2-set__field-label">推論の強度</label>
              <select
                className="v2-set__select"
                value={rt.reasoning_effort ?? "low"}
                onChange={async (e) => {
                  const r = await data.setVoiceConfig({
                    realtime: { reasoning_effort: e.target.value as RealtimeReasoningEffort },
                  });
                  onToast(r.message, r.ok ? "ok" : "warn");
                }}
              >
                {REASONING_EFFORTS.map((eff) => (
                  <option key={eff.id} value={eff.id}>
                    {eff.label}
                  </option>
                ))}
              </select>
              <p className="v2-set__hint">
                強度を高めるほど回答は熟考されますが、遅延とコストが増加します。日常使いには
                「低」から始めてください。
              </p>
            </div>

            {/* Cost guards */}
            <div className="v2-set__field">
              <label className="v2-set__field-label">最大セッション時間（分）</label>
              <select
                className="v2-set__select"
                value={String(rt.max_session_minutes ?? 10)}
                onChange={async (e) => {
                  const r = await data.setVoiceConfig({
                    realtime: { max_session_minutes: Number(e.target.value) },
                  });
                  onToast(r.message, r.ok ? "ok" : "warn");
                }}
              >
                {[5, 10, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m}分
                  </option>
                ))}
              </select>
              <p className="v2-set__hint">
                コストの暴走を防ぐため、この上限に達するとセッションは自動的に終了します。
              </p>
            </div>

            <p className="v2-set__hint" data-tone="warn">
              リアルタイムセッションが有効な間、音声は継続的にOpenAIへストリーミングされます。
              リアルタイムセッション中はツール呼び出しが自動承認されます（強制拒否は引き続き適用されます）。
              使用状況はplatform.openai.comで確認できます。
            </p>
          </>
        )}
      </section>
    </div>
  );
}
