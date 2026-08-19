import React, { useState } from "react";
import type { SettingsHook } from "../useSettingsData";
import { confirmDialog } from "../../../ui/ConfirmDialog";
// Embed the legacy config editor — it's a 200+ LOC YAML+form editor with
// its own modal chrome; rebuilding pixel-perfect adds a lot of LOC for a
// power-user surface. The retheme cascade on .v2-set__legacy-embed
// remaps --j-* → v2 tokens.
import { SidecarConfigEditor } from "../../../../components/settings/SidecarConfigEditor";

export function SidecarTab({
  data,
  onToast,
}: {
  data: SettingsHook;
  onToast: (text: string, tone?: "ok" | "warn") => void;
}) {
  const { sidecars } = data;
  const [enrollName, setEnrollName] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [enrollResult, setEnrollResult] = useState<{ token: string; name: string } | null>(null);
  const [configTarget, setConfigTarget] = useState<{ id: string; name: string } | null>(null);

  const handleEnroll = async () => {
    const name = enrollName.trim();
    if (!name) return;
    setEnrolling(true);
    const r = await data.enrollSidecar(name);
    if (r.ok) {
      setEnrollResult({ token: r.token, name: r.name });
      setEnrollName("");
      onToast(`「${r.name}」を登録しました。トークンは今すぐコピーしてください — 表示は一度限りです。`, "ok");
    } else {
      onToast(r.message, "warn");
    }
    setEnrolling(false);
  };

  const handleRevoke = async (id: string, name: string) => {
    if (!await confirmDialog(`サイドカー「${name}」を取り消しますか？ Jarvisへのアクセス権を失います。`)) return;
    const r = await data.revokeSidecar(id);
    onToast(r.message, r.ok ? "ok" : "warn");
  };

  const copyToken = () => {
    if (!enrollResult) return;
    // navigator.clipboard is undefined outside secure contexts (plain-HTTP
    // LAN dashboards), which would throw synchronously and skip the toast.
    if (!navigator.clipboard) {
      onToast("HTTP環境ではクリップボードを使用できません — トークンを手動で選択してください。", "warn");
      return;
    }
    navigator.clipboard.writeText(enrollResult.token).then(
      () => onToast("トークンをクリップボードにコピーしました。", "ok"),
      () => onToast("コピーに失敗しました — 手動で選択してください。", "warn"),
    );
  };

  return (
    <div>
      {/* Enroll new sidecar */}
      <section className="v2-set__section">
        <div className="v2-set__section-head">
          <div>
            <h3 className="v2-set__section-title">新しいサイドカーを登録</h3>
            <div className="v2-set__section-sub">
              発行されたトークンを対象マシンで実行すると、そのマシンにJarvisを拡張できます。
            </div>
          </div>
        </div>
        <div className="v2-set__field">
          <label className="v2-set__field-label">サイドカー名</label>
          <div style={{ display: "flex", gap: "var(--s-2)" }}>
            <input
              className="v2-set__input"
              placeholder="例: work-laptop"
              value={enrollName}
              onChange={(e) => setEnrollName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleEnroll()}
            />
            <button
              type="button"
              className="v2-set__btn v2-set__btn--primary"
              onClick={handleEnroll}
              disabled={enrolling || !enrollName.trim()}
            >
              {enrolling ? "登録中…" : "登録"}
            </button>
          </div>
        </div>

        {enrollResult && (
          <div className="v2-set__token-box">
            <div className="v2-set__token-label">
              「{enrollResult.name}」のトークン — 今すぐコピーしてください。表示は一度限りです
            </div>
            <code className="v2-set__code v2-set__code--block">
              jarvis --token {enrollResult.token}
            </code>
            <div style={{ display: "flex", gap: "var(--s-2)", justifyContent: "flex-end" }}>
              <button type="button" className="v2-set__btn" onClick={copyToken}>
                トークンをコピー
              </button>
              <button
                type="button"
                className="v2-set__btn"
                onClick={() => setEnrollResult(null)}
              >
                完了
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Enrolled sidecars list */}
      <section className="v2-set__section">
        <div className="v2-set__section-head">
          <div>
            <h3 className="v2-set__section-title">登録済みサイドカー</h3>
            <div className="v2-set__section-sub">
              {sidecars.length === 0
                ? "まだサイドカーが登録されていません。"
                : `サイドカー ${sidecars.length}台 · 接続中 ${data.stats.sidecarsConnected}台`}
            </div>
          </div>
        </div>

        {sidecars.length === 0 ? (
          <div className="v2-set__empty">上で1台登録して始めましょう。</div>
        ) : (
          <ul className="v2-set__sidecar-list" role="list">
            {sidecars.map((sc) => (
              <li key={sc.id} className="v2-set__sidecar">
                <span
                  className={
                    "v2-set__dot " + (sc.connected ? "v2-set__dot--ok" : "")
                  }
                />
                <span className="v2-set__sidecar-name">{sc.name}</span>
                <div className="v2-set__sidecar-meta">
                  {sc.hostname && <span>{sc.hostname}</span>}
                  {sc.os && sc.platform && <span>· {sc.os}/{sc.platform}</span>}
                  {sc.version && (
                    <span>
                      · v{sc.version}
                      {sc.update_status === "suggested" && (
                        <span style={{ color: "var(--warn)" }} title="このbrainには新しいバージョンのサイドカーを推奨します">
                          {" "}· 更新あり
                        </span>
                      )}
                      {sc.update_status === "dev" && (
                        <span style={{ opacity: 0.6 }} title="バージョン未付与のローカル開発ビルド — バージョン制限の対象外">
                          {" "}· 開発ビルド
                        </span>
                      )}
                    </span>
                  )}
                  {sc.capabilities && sc.capabilities.length > 0 && (
                    <span>· {sc.capabilities.join(", ")}</span>
                  )}
                  {sc.unavailable_capabilities && sc.unavailable_capabilities.length > 0 && (
                    <span style={{ color: "var(--warn)" }}>
                      ·{" "}
                      {sc.unavailable_capabilities.map((u, i) => (
                        <span key={u.name} title={u.reason}>
                          {i > 0 ? ", " : ""}
                          ⚠ {u.name}
                        </span>
                      ))}
                    </span>
                  )}
                  {sc.last_seen_at && (
                    <span>· 最終確認 {new Date(sc.last_seen_at).toLocaleString()}</span>
                  )}
                </div>
                <div className="v2-set__sidecar-actions">
                  {sc.connected && (
                    <button
                      type="button"
                      className="v2-set__btn"
                      onClick={() => setConfigTarget({ id: sc.id, name: sc.name })}
                    >
                      設定
                    </button>
                  )}
                  <button
                    type="button"
                    className="v2-set__btn v2-set__btn--danger"
                    onClick={() => handleRevoke(sc.id, sc.name)}
                  >
                    取り消し
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Legacy config editor modal — rethemed via cascade */}
      {configTarget && (
        <div className="v2-set__legacy-embed">
          <SidecarConfigEditor
            sidecarId={configTarget.id}
            sidecarName={configTarget.name}
            unavailableCapabilities={
              sidecars.find((s) => s.id === configTarget.id)?.unavailable_capabilities ?? []
            }
            onClose={() => setConfigTarget(null)}
          />
        </div>
      )}
    </div>
  );
}
