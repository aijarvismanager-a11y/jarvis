import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SettingsHook } from "../useSettingsData";
import { confirmDialog } from "../../../ui/ConfirmDialog";

/** Phase 13-D: /api/image/generations row shape (src/vault/image-generations.ts). */
type ImageGeneration = {
  id: string;
  prompt: string;
  revised_prompt: string | null;
  provider: string;
  model: string;
  file_paths: string[];
  created_at: number;
};

export function IntegrationsTab({
  data,
  onToast,
}: {
  data: SettingsHook;
  onToast: (text: string, tone?: "ok" | "warn") => void;
}) {
  const g = data.google;
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [phase, setPhase] = useState<"idle" | "saving" | "authenticating">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Phase 13-B: Image Agent + GitHub credentials.
  const [openaiImageKey, setOpenaiImageKey] = useState("");
  const [geminiImageKey, setGeminiImageKey] = useState("");
  const [githubToken, setGithubToken] = useState("");

  const handleSaveImageKey = async (provider: "openai-image" | "gemini-image", key: string, clear: () => void) => {
    if (!key.trim()) return;
    const r = await data.saveImageProviderKey(provider, key.trim());
    onToast(r.message, r.ok ? "ok" : "warn");
    if (r.ok) clear();
  };

  const handleSaveGithubToken = async () => {
    if (!githubToken.trim()) return;
    const r = await data.saveGitHubToken(githubToken.trim());
    onToast(r.message, r.ok ? "ok" : "warn");
    if (r.ok) setGithubToken("");
  };

  // Phase 13-D: past generations, fetched on demand rather than on the
  // settings room's 10s poll - this is a browse-once list, not live state.
  const [generations, setGenerations] = useState<ImageGeneration[] | null>(null);
  const [generationsLoading, setGenerationsLoading] = useState(false);

  const loadGenerations = async () => {
    setGenerationsLoading(true);
    try {
      const r = await fetch("/api/image/generations?limit=20");
      if (r.ok) setGenerations((await r.json()) as ImageGeneration[]);
    } finally {
      setGenerationsLoading(false);
    }
  };

  // Listen for the OAuth popup completion event
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.data === "google-auth-complete") {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setPhase("idle");
        onToast("接続しました。GmailとCalendarのオブザーバーを起動しています。", "ok");
        data.refresh();
      }
    },
    [data, onToast],
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  const handleSaveCredentials = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      onToast("Client IDとClient Secretの両方が必要です。", "warn");
      return;
    }
    setPhase("saving");
    const r = await data.saveGoogleCredentials({
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
    });
    onToast(r.message, r.ok ? "ok" : "warn");
    if (r.ok) {
      setClientId("");
      setClientSecret("");
    }
    setPhase("idle");
  };

  const handleConnect = async () => {
    const r = await data.initGoogleAuth();
    if (!r.ok) {
      onToast(r.message, "warn");
      return;
    }
    setPhase("authenticating");
    window.open(r.auth_url, "google-auth", "width=600,height=700");

    // Polling fallback (in case the popup can't postMessage back)
    let polls = 0;
    pollRef.current = setInterval(async () => {
      polls++;
      if (polls > 40) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setPhase("idle");
        onToast("認証がタイムアウトしました。もう一度お試しください。", "warn");
        return;
      }
      try {
        const status = await fetch("/api/auth/google/status").then((r) => r.json());
        if (status?.is_authenticated) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setPhase("idle");
          onToast(
            "接続しました。GmailとCalendarのオブザーバーを起動しています。",
            "ok",
          );
          data.refresh();
        }
      } catch {
        /* poll error — ignore */
      }
    }, 3000);
  };

  const handleDisconnect = async () => {
    if (!await confirmDialog("Googleとの接続を解除しますか? 再接続するには再認証が必要です。")) return;
    const r = await data.disconnectGoogle();
    onToast(r.message, r.ok ? "ok" : "warn");
  };

  return (
    <div>
      <section className="v2-set__section">
        <div className="v2-set__section-head">
          <div>
            <h3 className="v2-set__section-title">Google</h3>
            <div className="v2-set__section-sub">
              GmailとGoogleカレンダーに接続します(読み取り専用)。接続/切断後は再起動が必要です。
            </div>
          </div>
          {g && (
            <span
              className={
                "v2-set__chip " +
                (g.status === "connected"
                  ? "v2-set__chip--ok"
                  : g.status === "credentials_saved"
                    ? "v2-set__chip--warn"
                    : "")
              }
            >
              {g.status === "connected"
                ? "接続済み"
                : g.status === "credentials_saved"
                  ? "認証情報を保存済み"
                  : g.status.replace(/_/g, " ")}
            </span>
          )}
        </div>

        {!g ? (
          <div className="v2-set__empty">Google のステータスを読み込み中…</div>
        ) : g.status === "not_configured" && phase !== "saving" ? (
          <>
            <p className="v2-set__hint">
              Google Cloud Console &gt; APIs &amp; Credentials からOAuth2認証情報を取得する必要があります。
            </p>
            <div className="v2-set__section" style={{ marginBottom: 0 }}>
              <div className="v2-set__field-label">セットアップ手順</div>
              <ol style={{ margin: 0, paddingLeft: 20, color: "var(--ink-2)", fontSize: "var(--text-xs)", lineHeight: 1.7 }}>
                <li>
                  Google Cloudプロジェクトで<strong>Gmail API</strong>と<strong>Google Calendar API</strong>を有効化する
                </li>
                <li>
                  <strong>OAuth 2.0 Client ID</strong>を作成する(タイプ: ウェブアプリケーション)
                </li>
                <li>
                  次のAuthorized redirect URIを追加する:
                  <code className="v2-set__code v2-set__code--block">
                    http://localhost:3142/api/auth/google/callback
                  </code>
                </li>
                <li>下にClient IDとClient Secretを貼り付ける</li>
              </ol>
            </div>
            <div className="v2-set__field">
              <label className="v2-set__field-label">Client ID</label>
              <input
                className="v2-set__input"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </div>
            <div className="v2-set__field">
              <label className="v2-set__field-label">Client secret</label>
              <input
                className="v2-set__input"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="v2-set__btn v2-set__btn--primary"
                onClick={handleSaveCredentials}
              >
                認証情報を保存
              </button>
            </div>
          </>
        ) : phase === "saving" ? (
          <div className="v2-set__empty">保存中…</div>
        ) : g.status === "credentials_saved" && phase === "idle" ? (
          <>
            <p className="v2-set__hint">認証情報を保存しました。Googleアカウントを接続して認可してください。</p>
            <div style={{ display: "flex", gap: "var(--s-2)", flexWrap: "wrap" }}>
              <button
                type="button"
                className="v2-set__btn v2-set__btn--primary"
                onClick={handleConnect}
              >
                Googleアカウントを接続
              </button>
            </div>
            <p className="v2-set__hint">新しいウィンドウで同意画面が開きます。</p>
          </>
        ) : phase === "authenticating" ? (
          <div className="v2-set__empty">ポップアップでGoogleの認可を待っています…</div>
        ) : (
          /* connected */
          <>
            <div className="v2-set__row">
              <span className="v2-set__row-label">Gmail</span>
              <span className="v2-set__row-value">
                <span className="v2-set__dot v2-set__dot--ok" /> 読み取り専用
              </span>
            </div>
            <div className="v2-set__row">
              <span className="v2-set__row-label">Google Calendar</span>
              <span className="v2-set__row-value">
                <span className="v2-set__dot v2-set__dot--ok" /> 読み取り専用
              </span>
            </div>
            {g.token_expiry && (
              <div className="v2-set__row">
                <span className="v2-set__row-label">トークンの有効期限</span>
                <span className="v2-set__row-value">
                  {new Date(g.token_expiry).toLocaleString()}
                </span>
              </div>
            )}
            {g.scopes.length > 0 && (
              <div className="v2-set__field">
                <label className="v2-set__field-label">スコープ</label>
                <div className="v2-set__chip-row">
                  {g.scopes.map((s) => (
                    <span key={s} className="v2-set__chip" title={s}>
                      {s.replace(/^https?:\/\/[^/]+\//, "")}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="v2-set__btn v2-set__btn--danger"
                onClick={handleDisconnect}
              >
                Googleとの接続を解除
              </button>
            </div>
          </>
        )}
      </section>

      <section className="v2-set__section">
        <div className="v2-set__section-head">
          <div>
            <h3 className="v2-set__section-title">Image Agent</h3>
            <div className="v2-set__section-sub">
              image_generate用のプロバイダーキー(Phase 8)。即座に反映され、再起動は不要です。
            </div>
          </div>
        </div>

        <div className="v2-set__field">
          <label className="v2-set__field-label">
            OpenAI (gpt-image-1 / dall-e-3)
            {data.imageProviders?.providers["openai-image"].has_api_key && (
              <span className="v2-set__chip v2-set__chip--ok" style={{ marginLeft: 8 }}>保存済み</span>
            )}
          </label>
          <div style={{ display: "flex", gap: "var(--s-2)" }}>
            <input
              className="v2-set__input"
              type="password"
              placeholder="sk-..."
              value={openaiImageKey}
              onChange={(e) => setOpenaiImageKey(e.target.value)}
            />
            <button
              type="button"
              className="v2-set__btn v2-set__btn--primary"
              onClick={() => handleSaveImageKey("openai-image", openaiImageKey, () => setOpenaiImageKey(""))}
              disabled={!openaiImageKey.trim()}
            >
              保存
            </button>
          </div>
        </div>

        <div className="v2-set__field">
          <label className="v2-set__field-label">
            Gemini (Imagen)
            {data.imageProviders?.providers["gemini-image"].has_api_key && (
              <span className="v2-set__chip v2-set__chip--ok" style={{ marginLeft: 8 }}>保存済み</span>
            )}
          </label>
          <div style={{ display: "flex", gap: "var(--s-2)" }}>
            <input
              className="v2-set__input"
              type="password"
              placeholder="AIza..."
              value={geminiImageKey}
              onChange={(e) => setGeminiImageKey(e.target.value)}
            />
            <button
              type="button"
              className="v2-set__btn v2-set__btn--primary"
              onClick={() => handleSaveImageKey("gemini-image", geminiImageKey, () => setGeminiImageKey(""))}
              disabled={!geminiImageKey.trim()}
            >
              保存
            </button>
          </div>
        </div>

        <div className="v2-set__field">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <label className="v2-set__field-label">最近の生成履歴</label>
            <button type="button" className="v2-set__btn" onClick={loadGenerations} disabled={generationsLoading}>
              {generationsLoading ? "読み込み中…" : generations === null ? "読み込む" : "更新"}
            </button>
          </div>
          {generations !== null && (
            generations.length === 0 ? (
              <div className="v2-set__hint">まだ画像は生成されていません。</div>
            ) : (
              <div>
                {generations.map((g) => (
                  <div key={g.id} className="v2-set__row" title={g.file_paths.join("\n")}>
                    <span className="v2-set__row-label" style={{ maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {g.prompt}
                    </span>
                    <span className="v2-set__row-value">
                      {g.provider} · {g.file_paths.length}ファイル · {new Date(g.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </section>

      <section className="v2-set__section">
        <div className="v2-set__section-head">
          <div>
            <h3 className="v2-set__section-title">GitHub</h3>
            <div className="v2-set__section-sub">
              Git操作用のパーソナルアクセストークン(Phase 7)。push/force-push/deleteは引き続き権限で制御されます。
            </div>
          </div>
          {data.github && (
            <span className={"v2-set__chip " + (data.github.has_token ? "v2-set__chip--ok" : "")}>
              {data.github.has_token ? "接続済み" : "未接続"}
            </span>
          )}
        </div>

        <div className="v2-set__field">
          <label className="v2-set__field-label">パーソナルアクセストークン</label>
          <div style={{ display: "flex", gap: "var(--s-2)" }}>
            <input
              className="v2-set__input"
              type="password"
              placeholder="ghp_..."
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
            />
            <button
              type="button"
              className="v2-set__btn v2-set__btn--primary"
              onClick={handleSaveGithubToken}
              disabled={!githubToken.trim()}
            >
              保存
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
