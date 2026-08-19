import React, { useEffect, useState } from "react";
import type {
  STTProvider,
  SettingsHook,
  TTSProvider,
} from "../useSettingsData";

const EDGE_VOICES = [
  { id: "en-US-AriaNeural", label: "Aria（米国・女性）" },
  { id: "en-US-GuyNeural", label: "Guy（米国・男性）" },
  { id: "en-GB-SoniaNeural", label: "Sonia（英国・女性）" },
  { id: "en-AU-NatashaNeural", label: "Natasha（豪州・女性）" },
  { id: "en-US-JennyNeural", label: "Jenny（米国・女性）" },
  { id: "en-US-DavisNeural", label: "Davis（米国・男性）" },
];

const EDGE_RATES = [
  { id: "-20%", label: "遅い" },
  { id: "+0%", label: "普通" },
  { id: "+15%", label: "速い" },
  { id: "+30%", label: "非常に速い" },
];

const SARVAM_LANGUAGES = [
  "en-IN",
  "hi-IN",
  "ta-IN",
  "te-IN",
  "kn-IN",
  "ml-IN",
];

const SARVAM_SPEAKERS = [
  "anushka",
  "amit",
  "priya",
  "rohan",
  "simran",
  "kabir",
  "arya",
  "hitesh",
];

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
}

export function ChannelsTab({
  data,
  onToast,
}: {
  data: SettingsHook;
  onToast: (text: string, tone?: "ok" | "warn") => void;
}) {
  const { channelStatus, channelCfg, sttCfg, ttsCfg } = data;

  // Telegram form
  const [tgToken, setTgToken] = useState("");
  const [tgAllowed, setTgAllowed] = useState("");

  // Discord form
  const [dcToken, setDcToken] = useState("");
  const [dcAllowed, setDcAllowed] = useState("");
  const [dcGuild, setDcGuild] = useState("");

  // STT form
  const [sttKey, setSttKey] = useState("");
  const [sttEndpoint, setSttEndpoint] = useState("http://localhost:8080");
  const [sttServerType, setSttServerType] = useState("whisper_cpp");

  // TTS extras
  const [elKey, setElKey] = useState("");
  const [elVoices, setElVoices] = useState<ElevenLabsVoice[]>([]);
  const [elVoicesLoading, setElVoicesLoading] = useState(false);
  const [sarvKey, setSarvKey] = useState("");

  // Seed editable fields from the server config. Depend on the primitive
  // *values*, not the `channelCfg`/`sttCfg` objects: those get a fresh
  // reference on every 10s settings poll, so depending on the object would
  // re-seed (and clobber in-progress typing) on each poll. Value deps only
  // re-fire when the server value actually changes (e.g. after a save).
  const tgAllowedServer = channelCfg?.telegram.allowed_users.join(", ") ?? "";
  const dcAllowedServer = channelCfg?.discord.allowed_users.join(", ") ?? "";
  const dcGuildServer = channelCfg?.discord.guild_id ?? "";

  useEffect(() => {
    if (!channelCfg) return;
    setTgAllowed(tgAllowedServer);
    setDcAllowed(dcAllowedServer);
    setDcGuild(dcGuildServer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tgAllowedServer, dcAllowedServer, dcGuildServer]);

  useEffect(() => {
    if (sttCfg?.local_endpoint) setSttEndpoint(sttCfg.local_endpoint);
    if (sttCfg?.local_server_type) setSttServerType(sttCfg.local_server_type);
  }, [sttCfg?.local_endpoint, sttCfg?.local_server_type]);

  useEffect(() => {
    if (ttsCfg?.provider !== "elevenlabs") return;
    if (!ttsCfg?.elevenlabs?.has_api_key) return;
    setElVoicesLoading(true);
    fetch("/api/tts/voices?provider=elevenlabs")
      .then((r) => (r.ok ? r.json() : []))
      .then((v) => setElVoices(Array.isArray(v) ? v : []))
      .catch(() => setElVoices([]))
      .finally(() => setElVoicesLoading(false));
  }, [ttsCfg?.provider, ttsCfg?.elevenlabs?.has_api_key]);

  return (
    <div>
      {/* Telegram */}
      <section className="v2-set__section">
        <div className="v2-set__section-head">
          <div>
            <h3 className="v2-set__section-title">Telegram</h3>
            <div className="v2-set__section-sub">
              @BotFather経由のボット。トークン変更後は再起動が必要です。
            </div>
          </div>
          <span className={"v2-set__chip " + (channelStatus?.channels.telegram ? "v2-set__chip--ok" : "")}>
            {channelStatus?.channels.telegram ? "接続済み" : "未接続"}
          </span>
        </div>

        <label className="v2-set__toggle-row">
          <button
            type="button"
            className="v2-set__toggle"
            data-checked={!!channelCfg?.telegram.enabled}
            aria-checked={!!channelCfg?.telegram.enabled}
            role="switch"
            onClick={async () => {
              const r = await data.setTelegram({
                enabled: !channelCfg?.telegram.enabled,
              });
              onToast(r.message, r.ok ? "ok" : "warn");
            }}
          />
          <span>Telegramを有効化</span>
          {channelCfg?.telegram.has_token && (
            <span className="v2-set__chip" style={{ marginLeft: "auto" }}>
              トークン設定済み
            </span>
          )}
        </label>

        <div className="v2-set__field">
          <label className="v2-set__field-label">ボットトークン</label>
          <input
            className="v2-set__input"
            type="password"
            placeholder="空欄のままにすると既存の値を維持します"
            value={tgToken}
            onChange={(e) => setTgToken(e.target.value)}
          />
        </div>
        <div className="v2-set__field">
          <label className="v2-set__field-label">許可するユーザーID（カンマ区切り）</label>
          <input
            className="v2-set__input"
            type="text"
            value={tgAllowed}
            onChange={(e) => setTgAllowed(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="v2-set__btn v2-set__btn--primary"
            onClick={async () => {
              const allowed = tgAllowed
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map(Number)
                .filter((n) => Number.isFinite(n));
              const r = await data.setTelegram({
                bot_token: tgToken || undefined,
                allowed_users: allowed,
              });
              if (r.ok) setTgToken("");
              onToast(r.message, r.ok ? "ok" : "warn");
            }}
          >
            Telegramを保存
          </button>
        </div>
      </section>

      {/* Discord */}
      <section className="v2-set__section">
        <div className="v2-set__section-head">
          <div>
            <h3 className="v2-set__section-title">Discord</h3>
            <div className="v2-set__section-sub">
              discord.com/developers経由のボット。Message Content Intentを有効化してください。再起動が必要です。
            </div>
          </div>
          <span className={"v2-set__chip " + (channelStatus?.channels.discord ? "v2-set__chip--ok" : "")}>
            {channelStatus?.channels.discord ? "接続済み" : "未接続"}
          </span>
        </div>

        <label className="v2-set__toggle-row">
          <button
            type="button"
            className="v2-set__toggle"
            data-checked={!!channelCfg?.discord.enabled}
            aria-checked={!!channelCfg?.discord.enabled}
            role="switch"
            onClick={async () => {
              const r = await data.setDiscord({
                enabled: !channelCfg?.discord.enabled,
              });
              onToast(r.message, r.ok ? "ok" : "warn");
            }}
          />
          <span>Discordを有効化</span>
          {channelCfg?.discord.has_token && (
            <span className="v2-set__chip" style={{ marginLeft: "auto" }}>
              トークン設定済み
            </span>
          )}
        </label>

        <div className="v2-set__field">
          <label className="v2-set__field-label">ボットトークン</label>
          <input
            className="v2-set__input"
            type="password"
            placeholder="空欄のままにすると既存の値を維持します"
            value={dcToken}
            onChange={(e) => setDcToken(e.target.value)}
          />
        </div>
        <div className="v2-set__field">
          <label className="v2-set__field-label">許可するユーザーID（カンマ区切り）</label>
          <input
            className="v2-set__input"
            type="text"
            value={dcAllowed}
            onChange={(e) => setDcAllowed(e.target.value)}
          />
        </div>
        <div className="v2-set__field">
          <label className="v2-set__field-label">ギルドID（任意、特定のサーバーに限定する場合）</label>
          <input
            className="v2-set__input"
            type="text"
            value={dcGuild}
            onChange={(e) => setDcGuild(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="v2-set__btn v2-set__btn--primary"
            onClick={async () => {
              const allowed = dcAllowed
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              const r = await data.setDiscord({
                bot_token: dcToken || undefined,
                allowed_users: allowed,
                guild_id: dcGuild || undefined,
              });
              if (r.ok) setDcToken("");
              onToast(r.message, r.ok ? "ok" : "warn");
            }}
          >
            Discordを保存
          </button>
        </div>
      </section>

      {/* STT */}
      <section className="v2-set__section">
        <div className="v2-set__section-head">
          <div>
            <h3 className="v2-set__section-title">音声文字起こし（STT）</h3>
            <div className="v2-set__section-sub">
              TelegramとDiscordでの音声メッセージを有効化します。再起動が必要です。
            </div>
          </div>
        </div>

        <div className="v2-set__field">
          <label className="v2-set__field-label">プロバイダー</label>
          <select
            className="v2-set__select"
            value={sttCfg?.provider ?? "openai"}
            onChange={async (e) => {
              const r = await data.setSTTProvider(e.target.value as STTProvider);
              onToast(r.message, r.ok ? "ok" : "warn");
            }}
          >
            <option value="openai">OpenAI Whisper</option>
            <option value="groq">Groq Whisper</option>
            <option value="sarvam">Sarvam AI</option>
            <option value="local">ローカルWhisper（whisper.cpp）</option>
          </select>
        </div>

        {(sttCfg?.provider === "openai" ||
          sttCfg?.provider === "groq" ||
          sttCfg?.provider === "sarvam") && (
          <div className="v2-set__field">
            <label className="v2-set__field-label">{sttCfg?.provider} のAPIキー</label>
            <div style={{ display: "flex", gap: "var(--s-2)" }}>
              <input
                className="v2-set__input"
                type="password"
                placeholder="空欄のままにすると既存の値を維持します"
                value={sttKey}
                onChange={(e) => setSttKey(e.target.value)}
              />
              <button
                type="button"
                className="v2-set__btn v2-set__btn--primary"
                disabled={!sttKey}
                onClick={async () => {
                  if (!sttCfg) return;
                  const r = await data.setSTTProvider(
                    sttCfg.provider as STTProvider,
                    { api_key: sttKey },
                  );
                  if (r.ok) setSttKey("");
                  onToast(r.message, r.ok ? "ok" : "warn");
                }}
              >
                キーを保存
              </button>
            </div>
            <p className="v2-set__hint">
              {(sttCfg?.provider === "openai" && sttCfg?.has_openai_key) ||
              (sttCfg?.provider === "groq" && sttCfg?.has_groq_key) ||
              (sttCfg?.provider === "sarvam" && sttCfg?.has_sarvam_key)
                ? "APIキー設定済みです。"
                : "キーは設定されていません。"}
            </p>
          </div>
        )}

        {sttCfg?.provider === "local" && (
          <>
            <div className="v2-set__field">
              <label className="v2-set__field-label">Whisperエンドポイント</label>
              <input
                className="v2-set__input"
                value={sttEndpoint}
                onChange={(e) => setSttEndpoint(e.target.value)}
              />
            </div>
            <div className="v2-set__field">
              <label className="v2-set__field-label">サーバータイプ</label>
              <select
                className="v2-set__select"
                value={sttServerType}
                onChange={(e) => setSttServerType(e.target.value)}
              >
                <option value="whisper_cpp">whisper.cpp</option>
                <option value="openai_compatible">OpenAI互換</option>
              </select>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="v2-set__btn v2-set__btn--primary"
                onClick={async () => {
                  const r = await data.setSTTProvider("local", {
                    endpoint: sttEndpoint,
                    server_type: sttServerType,
                  });
                  onToast(r.message, r.ok ? "ok" : "warn");
                }}
              >
                ローカルSTTを保存
              </button>
            </div>
          </>
        )}
      </section>

      {/* TTS */}
      <section className="v2-set__section">
        <div className="v2-set__section-head">
          <div>
            <h3 className="v2-set__section-title">音声合成（TTS）</h3>
            <div className="v2-set__section-sub">
              ダッシュボード経由でのJarvisの音声応答。ホットリロードされます。
            </div>
          </div>
        </div>

        <label className="v2-set__toggle-row">
          <button
            type="button"
            className="v2-set__toggle"
            data-checked={!!ttsCfg?.enabled}
            aria-checked={!!ttsCfg?.enabled}
            role="switch"
            onClick={async () => {
              const r = await data.setTTS({ enabled: !ttsCfg?.enabled });
              onToast(r.message, r.ok ? "ok" : "warn");
            }}
          />
          <span>TTSを有効化</span>
        </label>

        <div className="v2-set__field">
          <label className="v2-set__field-label">プロバイダー</label>
          <select
            className="v2-set__select"
            value={ttsCfg?.provider ?? "edge"}
            onChange={async (e) => {
              const r = await data.setTTS({ provider: e.target.value as TTSProvider });
              onToast(r.message, r.ok ? "ok" : "warn");
            }}
          >
            <option value="edge">Edge TTS（無料）</option>
            <option value="elevenlabs">ElevenLabs（APIキー）</option>
            <option value="sarvam">Sarvam AI（インド系言語）</option>
          </select>
        </div>

        {ttsCfg?.provider === "edge" && (
          <>
            <div className="v2-set__field">
              <label className="v2-set__field-label">音声</label>
              <select
                className="v2-set__select"
                value={ttsCfg?.voice ?? "en-US-AriaNeural"}
                onChange={async (e) => {
                  const r = await data.setTTS({ voice: e.target.value });
                  onToast(r.message, r.ok ? "ok" : "warn");
                }}
              >
                {EDGE_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="v2-set__field">
              <label className="v2-set__field-label">話速</label>
              <select
                className="v2-set__select"
                value={ttsCfg?.rate ?? "+0%"}
                onChange={async (e) => {
                  const r = await data.setTTS({ rate: e.target.value });
                  onToast(r.message, r.ok ? "ok" : "warn");
                }}
              >
                {EDGE_RATES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {ttsCfg?.provider === "elevenlabs" && (
          <>
            <p className="v2-set__hint">
              APIキーは elevenlabs.io/app/settings/api-keys から取得してください。
            </p>
            <div className="v2-set__field">
              <label className="v2-set__field-label">ElevenLabs APIキー</label>
              <div style={{ display: "flex", gap: "var(--s-2)" }}>
                <input
                  className="v2-set__input"
                  type="password"
                  placeholder="空欄のままにすると既存の値を維持します"
                  value={elKey}
                  onChange={(e) => setElKey(e.target.value)}
                />
                <button
                  type="button"
                  className="v2-set__btn v2-set__btn--primary"
                  disabled={!elKey}
                  onClick={async () => {
                    const r = await data.setTTS({
                      elevenlabs: { api_key: elKey },
                    });
                    if (r.ok) setElKey("");
                    onToast(r.message, r.ok ? "ok" : "warn");
                  }}
                >
                  キーを保存
                </button>
              </div>
              <p className="v2-set__hint">
                {ttsCfg?.elevenlabs?.has_api_key
                  ? "APIキー設定済みです。"
                  : "キーが未設定です。先に保存すると音声リストが読み込まれます。"}
              </p>
            </div>
            <div className="v2-set__field">
              <label className="v2-set__field-label">音声</label>
              {elVoicesLoading ? (
                <p className="v2-set__hint">音声を読み込み中…</p>
              ) : elVoices.length > 0 ? (
                <select
                  className="v2-set__select"
                  value={ttsCfg?.elevenlabs?.voice_id ?? ""}
                  onChange={async (e) => {
                    const r = await data.setTTS({
                      elevenlabs: { voice_id: e.target.value },
                    });
                    onToast(r.message, r.ok ? "ok" : "warn");
                  }}
                >
                  <option value="">デフォルト（Rachel）</option>
                  {elVoices.map((v) => (
                    <option key={v.voice_id} value={v.voice_id}>
                      {v.name} ({v.category})
                    </option>
                  ))}
                </select>
              ) : (
                <p className="v2-set__hint">音声を読み込むには先にAPIキーを保存してください。</p>
              )}
            </div>
            <div className="v2-set__field">
              <label className="v2-set__field-label">モデル</label>
              <select
                className="v2-set__select"
                value={ttsCfg?.elevenlabs?.model ?? "eleven_flash_v2_5"}
                onChange={async (e) => {
                  const r = await data.setTTS({
                    elevenlabs: { model: e.target.value },
                  });
                  onToast(r.message, r.ok ? "ok" : "warn");
                }}
              >
                <option value="eleven_flash_v2_5">Flash v2.5（高速・低遅延）</option>
                <option value="eleven_multilingual_v2">Multilingual v2（高品質）</option>
              </select>
            </div>
          </>
        )}

        {ttsCfg?.provider === "sarvam" && (
          <>
            <p className="v2-set__hint">インド系言語向けの高品質TTSです。</p>
            <div className="v2-set__field">
              <label className="v2-set__field-label">Sarvamサブスクリプションキー</label>
              <div style={{ display: "flex", gap: "var(--s-2)" }}>
                <input
                  className="v2-set__input"
                  type="password"
                  placeholder="空欄のままにすると既存の値を維持します"
                  value={sarvKey}
                  onChange={(e) => setSarvKey(e.target.value)}
                />
                <button
                  type="button"
                  className="v2-set__btn v2-set__btn--primary"
                  disabled={!sarvKey}
                  onClick={async () => {
                    const r = await data.setTTS({
                      sarvam: { api_key: sarvKey },
                    });
                    if (r.ok) setSarvKey("");
                    onToast(r.message, r.ok ? "ok" : "warn");
                  }}
                >
                  キーを保存
                </button>
              </div>
              <p className="v2-set__hint">
                {ttsCfg?.sarvam?.has_api_key ? "APIキー設定済みです。" : "キーは設定されていません。"}
              </p>
            </div>
            <div className="v2-set__field">
              <label className="v2-set__field-label">モデル</label>
              <select
                className="v2-set__select"
                value={ttsCfg?.sarvam?.model ?? "bulbul:v3"}
                onChange={async (e) => {
                  const r = await data.setTTS({
                    sarvam: { model: e.target.value },
                  });
                  onToast(r.message, r.ok ? "ok" : "warn");
                }}
              >
                <option value="bulbul:v3">Bulbul v3</option>
                <option value="bulbul:v2">Bulbul v2</option>
              </select>
            </div>
            <div className="v2-set__field">
              <label className="v2-set__field-label">言語</label>
              <select
                className="v2-set__select"
                value={ttsCfg?.sarvam?.language ?? "en-IN"}
                onChange={async (e) => {
                  const r = await data.setTTS({
                    sarvam: { language: e.target.value },
                  });
                  onToast(r.message, r.ok ? "ok" : "warn");
                }}
              >
                {SARVAM_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="v2-set__field">
              <label className="v2-set__field-label">話者</label>
              <select
                className="v2-set__select"
                value={ttsCfg?.sarvam?.speaker ?? "anushka"}
                onChange={async (e) => {
                  const r = await data.setTTS({
                    sarvam: { speaker: e.target.value },
                  });
                  onToast(r.message, r.ok ? "ok" : "warn");
                }}
              >
                {SARVAM_SPEAKERS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="v2-set__field">
              <label className="v2-set__field-label">サンプリングレート</label>
              <select
                className="v2-set__select"
                value={ttsCfg?.sarvam?.sampling_rate ?? 48000}
                onChange={async (e) => {
                  const r = await data.setTTS({
                    sarvam: { sampling_rate: Number(e.target.value) },
                  });
                  onToast(r.message, r.ok ? "ok" : "warn");
                }}
              >
                <option value={16000}>16 kHz</option>
                <option value={24000}>24 kHz</option>
                <option value={48000}>48 kHz（高音質）</option>
              </select>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
