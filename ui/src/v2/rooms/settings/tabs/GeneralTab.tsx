import React, { useState } from "react";
import type { SettingsHook } from "../useSettingsData";
import { specLevelLabel } from "../../agents/specLevel";
import { confirmDialog } from "../../../ui/ConfirmDialog";
import {
  resetOnboarding,
  type OnboardingResetScope,
} from "../../../onboarding/resetClient";

const HEARTBEAT_LEVELS = ["passive", "moderate", "aggressive"] as const;
const HEARTBEAT_LEVEL_LABELS: Record<(typeof HEARTBEAT_LEVELS)[number], string> = {
  passive: "控えめ",
  moderate: "普通",
  aggressive: "積極的",
};

export function GeneralTab({
  data,
  onToast,
}: {
  data: SettingsHook;
  onToast: (text: string, tone?: "ok" | "warn") => void;
}) {
  const { autostart, rootCfg, personality, role } = data;
  const [restarting, setRestarting] = useState(false);

  const handleRestart = async () => {
    if (!await confirmDialog("今すぐJarvisを再起動しますか？数秒後にダッシュボードが再接続されます。")) return;
    setRestarting(true);
    const r = await data.restartDaemon();
    onToast(r.message, r.ok ? "ok" : "warn");
    setRestarting(false);
  };

  return (
    <div>
      {/* Service / Restart */}
      <section className="v2-set__section">
        <div className="v2-set__section-head">
          <div>
            <h3 className="v2-set__section-title">24時間365日稼働サービス</h3>
            <div className="v2-set__section-sub">
              ターミナルを閉じた後もJarvisをバックグラウンドで実行し続けるキープアライブ機能です。
            </div>
          </div>
          {autostart && (
            <span
              className={
                "v2-set__chip " + (autostart.installed ? "v2-set__chip--ok" : "")
              }
            >
              {autostart.installed ? "インストール済み" : "未インストール"}
            </span>
          )}
        </div>

        {autostart ? (
          <>
            <div className="v2-set__row">
              <span className="v2-set__row-label">マネージャー</span>
              <span className="v2-set__row-value">{autostart.manager}</span>
            </div>
            <div className="v2-set__row">
              <span className="v2-set__row-label">プラットフォーム</span>
              <span className="v2-set__row-value">{autostart.platform}</span>
            </div>
            <div className="v2-set__row">
              <span className="v2-set__row-label">再起動</span>
              <span className="v2-set__row-value">
                {autostart.restart_supported
                  ? "利用可能"
                  : autostart.keepalive_supported
                    ? "先にキープアライブをインストールしてください"
                    : "非対応"}
              </span>
            </div>
            <div style={{ display: "flex", gap: "var(--s-2)", flexWrap: "wrap" }}>
              <button
                type="button"
                className="v2-set__btn v2-set__btn--primary"
                disabled={!autostart.restart_supported || restarting}
                onClick={handleRestart}
              >
                {restarting ? "再起動中…" : "Jarvisを再起動"}
              </button>
              <button
                type="button"
                className="v2-set__btn"
                onClick={() => data.refresh()}
              >
                状態を更新
              </button>
            </div>
          </>
        ) : (
          <div className="v2-set__empty">サービス制御は利用できません。</div>
        )}
      </section>

      {/* Heartbeat */}
      <section className="v2-set__section">
        <div className="v2-set__section-head">
          <div>
            <h3 className="v2-set__section-title">ハートビート</h3>
            <div className="v2-set__section-sub">
              Jarvisが能動的にあなたへ確認を行う頻度です。
            </div>
          </div>
        </div>

        {rootCfg?.heartbeat ? (
          <>
            <div className="v2-set__row">
              <span className="v2-set__row-label">間隔</span>
              <span className="v2-set__row-value">
                {rootCfg.heartbeat.interval_minutes} 分
              </span>
            </div>
            <div className="v2-set__row">
              <span className="v2-set__row-label">稼働時間帯</span>
              <span className="v2-set__row-value">
                {rootCfg.heartbeat.active_hours.start}:00 –{" "}
                {rootCfg.heartbeat.active_hours.end}:00
              </span>
            </div>
            <div className="v2-set__row">
              <span className="v2-set__row-label">積極度</span>
              <span className="v2-set__row-value">
                {HEARTBEAT_LEVEL_LABELS[rootCfg.heartbeat.aggressiveness as (typeof HEARTBEAT_LEVELS)[number]] ?? rootCfg.heartbeat.aggressiveness}
              </span>
            </div>
            <div className="v2-set__field">
              <label className="v2-set__field-label">積極度を設定（書き込み）</label>
              <div style={{ display: "flex", gap: "var(--s-2)", flexWrap: "wrap" }}>
                {HEARTBEAT_LEVELS.map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    className="v2-set__btn"
                    data-active={rootCfg.heartbeat?.aggressiveness === lv}
                    onClick={async () => {
                      const r = await data.setHeartbeatAggressiveness(lv);
                      onToast(r.message, r.ok ? "ok" : "warn");
                    }}
                  >
                    {HEARTBEAT_LEVEL_LABELS[lv]}
                  </button>
                ))}
              </div>
              <p className="v2-set__hint">
                注: ハートビート書き込みエンドポイントはまだデーモンに接続されていません — これらのボタンは
                ボイス操作との整合性のために機能を表示していますが、現在は「未実装」という
                メッセージを返します。
              </p>
            </div>
          </>
        ) : (
          <div className="v2-set__empty">No heartbeat config loaded.</div>
        )}
      </section>

      {/* Personality (read-only) */}
      <section className="v2-set__section">
        <div className="v2-set__section-head">
          <div>
            <h3 className="v2-set__section-title">パーソナリティ</h3>
            <div className="v2-set__section-sub">
              やり取りを通じて学習されます。読み取り専用です。
            </div>
          </div>
        </div>

        {personality ? (
          <>
            <div className="v2-set__field">
              <span className="v2-set__field-label">コア特性</span>
              <div className="v2-set__chip-row">
                {personality.core_traits.map((t) => (
                  <span key={t} className="v2-set__chip">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="v2-set__field">
              <span className="v2-set__field-label">学習された好み</span>
              <PrefBar label="詳細度" value={personality.learned_preferences.verbosity} />
              <PrefBar label="フォーマルさ" value={personality.learned_preferences.formality} />
              <PrefBar label="ユーモア" value={personality.learned_preferences.humor_level} />
              <div className="v2-set__row">
                <span className="v2-set__row-label">絵文字の使用</span>
                <span className="v2-set__row-value">
                  {personality.learned_preferences.emoji_usage ? "有効" : "無効"}
                </span>
              </div>
              <div className="v2-set__row">
                <span className="v2-set__row-label">好みの形式</span>
                <span className="v2-set__row-value" style={{ textTransform: "capitalize" }}>
                  {personality.learned_preferences.preferred_format}
                </span>
              </div>
            </div>
            <div className="v2-set__field">
              <span className="v2-set__field-label">関係性</span>
              <div className="v2-set__row">
                <span className="v2-set__row-label">やり取りしたメッセージ数</span>
                <span className="v2-set__row-value">
                  {personality.relationship.message_count}
                </span>
              </div>
              <PrefBar label="信頼レベル" value={personality.relationship.trust_level} />
              <div className="v2-set__row">
                <span className="v2-set__row-label">最初のやり取り</span>
                <span className="v2-set__row-value">
                  {new Date(personality.relationship.first_interaction).toLocaleDateString()}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="v2-set__empty">パーソナリティデータは利用できません。</div>
        )}
      </section>

      {/* Active role (read-only) */}
      <section className="v2-set__section">
        <div className="v2-set__section-head">
          <div>
            <h3 className="v2-set__section-title">アクティブロール</h3>
            <div className="v2-set__section-sub">
              オーケストレーターが利用できる権限とツールです。
            </div>
          </div>
        </div>
        {role?.role ? (
          <>
            <div className="v2-set__row">
              <span className="v2-set__row-label">ロール</span>
              <span className="v2-set__row-value">{role.role.name}</span>
            </div>
            <div className="v2-set__row">
              <span className="v2-set__row-label">権限</span>
              <span className="v2-set__row-value">{role.role.authority_level}/10 ({specLevelLabel(role.role.authority_level)})</span>
            </div>
            <div className="v2-set__field">
              <span className="v2-set__field-label">ツール</span>
              <div className="v2-set__chip-row">
                {role.role.tools.map((t) => (
                  <span key={t} className="v2-set__chip">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            {(role.role.sub_roles?.length ?? 0) > 0 && (
              <div className="v2-set__field">
                <span className="v2-set__field-label">
                  利用可能なスペシャリスト ({role.role.sub_roles?.length ?? 0})
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
                  {(role.role.sub_roles ?? []).map((sr) => (
                    <div
                      key={sr.role_id}
                      style={{
                        padding: "var(--s-2) var(--s-3)",
                        background: "var(--paper)",
                        border: "1px solid var(--rule-soft)",
                        borderRadius: "var(--r-1)",
                      }}
                    >
                      <div style={{ fontSize: "var(--text-sm)", color: "var(--ink)" }}>
                        {sr.name}
                      </div>
                      <div
                        style={{ fontSize: "var(--text-xs)", color: "var(--ink-3)", marginTop: 2 }}
                      >
                        {sr.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="v2-set__empty">ロールデータは利用できません。</div>
        )}
      </section>

      <RerunSetupSection onToast={onToast} />

      <OnboardingDebugSection onToast={onToast} />
    </div>
  );
}

/**
 * Phase E — quick-access shortcut for "Re-run first-time setup" so users
 * who want to switch LLM provider don't have to dig into the debug
 * dropdown. The debug section below still exposes the full scope picker
 * for everything else (profile / tutorial / all).
 */
function RerunSetupSection({
  onToast,
}: {
  onToast: (text: string, tone?: "ok" | "warn") => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleRerun = async () => {
    if (
      !await confirmDialog(
        "初回セットアップを再実行しますか？LLMプロバイダー＋TTS選択画面に戻ります。保存済みのプロフィールとチュートリアルの進行状況は保持されます。ページが再読み込みされます。",
      )
    )
      return;
    setBusy(true);
    try {
      await resetOnboarding("setup");
      onToast("セットアップを再実行中 — 再読み込みしています…", "ok");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "warn");
      setBusy(false);
    }
  };

  return (
    <section className="v2-set__section">
      <div className="v2-set__section-head">
        <div>
          <h3 className="v2-set__section-title">初回セットアップを再実行</h3>
          <div className="v2-set__section-sub">
            LLMプロバイダー＋TTS選択画面をもう一度実行します — プロバイダーの切り替えや
            APIキーのローテーション後に便利です。プロフィールとチュートリアルの進行状況は
            そのまま保持されます。
          </div>
        </div>
        <button
          type="button"
          className="v2-set__btn"
          onClick={handleRerun}
          disabled={busy}
        >
          {busy ? "再起動中…" : "セットアップを再実行"}
        </button>
      </div>
    </section>
  );
}

function PrefBar({ label, value, max = 10 }: { label: string; value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div>
      <div className="v2-set__row">
        <span className="v2-set__row-label">{label}</span>
        <span className="v2-set__row-value">
          {value}/{max}
        </span>
      </div>
      <div className="v2-set__pers-bar">
        <div className="v2-set__pers-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Onboarding reset section (Phase A — reset gate). Lets the user (or a
 * developer rehearsing a fresh-install run) replay any phase of the
 * onboarding flow without nuking `~/.jarvis/`. The same reset is also
 * reachable via voice ("replay onboarding") and via the URL trigger
 * `?onboarding=reset[&scope=...]` — see `resetClient.ts`.
 */
function OnboardingDebugSection({
  onToast,
}: {
  onToast: (text: string, tone?: "ok" | "warn") => void;
}) {
  const [scope, setScope] = useState<OnboardingResetScope | "">("");
  const [busy, setBusy] = useState(false);

  const handleReset = async () => {
    if (!scope) return;
    const label =
      scope === "all"
        ? "すべてのオンボーディングフェーズ"
        : scope === "setup"
          ? "LLM/TTSセットアップ画面"
          : scope === "profile"
            ? "プロフィールインタビュー（保存済みプロフィールはクリアされます）"
            : "ダッシュボードチュートリアル";
    if (!await confirmDialog(`${label}を再生しますか？ページが再読み込みされます。`)) return;
    setBusy(true);
    try {
      // resetOnboarding triggers a full page reload on success, so the
      // toast below only fires if reload is somehow skipped (e.g. test
      // harness).
      await resetOnboarding(scope);
      onToast(`リセットを予約しました — 再読み込みしています…`, "ok");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "warn");
      setBusy(false);
    }
  };

  return (
    <section className="v2-set__section">
      <div className="v2-set__section-head">
        <div>
          <h3 className="v2-set__section-title">オンボーディング</h3>
          <div className="v2-set__section-sub">
            初回起動オンボーディングの任意のフェーズを再生します。Jarvisの
            アップデート後やテスト時に便利です。リセット後にページが再読み込みされます。
          </div>
        </div>
      </div>

      <div className="v2-set__field">
        <label className="v2-set__field-label" htmlFor="onboarding-scope">
          再生範囲
        </label>
        <div style={{ display: "flex", gap: "var(--s-2)", alignItems: "center" }}>
          <select
            id="onboarding-scope"
            className="v2-set__select"
            value={scope}
            onChange={(e) => setScope(e.target.value as OnboardingResetScope | "")}
            style={{ flex: 1 }}
          >
            <option value="">フェーズを選択…</option>
            <option value="all">すべてのフェーズ（完全リセット）</option>
            <option value="setup">セットアップのみ（LLM + TTS選択）</option>
            <option value="profile">プロフィールインタビュー（保存済みプロフィールをクリア）</option>
            <option value="tutorial">ダッシュボードチュートリアル</option>
          </select>
          <button
            type="button"
            className="v2-set__btn v2-set__btn--danger"
            onClick={handleReset}
            disabled={!scope || busy}
          >
            {busy ? "リセット中…" : "再生"}
          </button>
        </div>
        <p className="v2-set__hint">
          ダッシュボードのURLで{" "}
          <code className="v2-set__code">?onboarding=reset</code> にアクセスするか、
          音声で <strong>「オンボーディングを再生」</strong> と言うこともできます。
        </p>
      </div>
    </section>
  );
}
