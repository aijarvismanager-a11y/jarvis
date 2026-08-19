import React, { useEffect, useMemo, useState } from "react";
import type { SettingsHook } from "../useSettingsData";
import { confirmDialog } from "../../../ui/ConfirmDialog";
import { resetOnboarding } from "../../../onboarding/resetClient";

export function ProfileTab({
  data,
  onToast,
}: {
  data: SettingsHook;
  onToast: (text: string, tone?: "ok" | "warn") => void;
}) {
  const profile = data.profile;
  const [editing, setEditing] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Seed the local draft from the server profile, but NOT while the user is
  // mid-edit. `profile` gets a fresh object reference on every 10s settings
  // poll, so without the `editing` guard this effect would re-fire on each
  // poll and overwrite in-progress typing with the last-saved values. While
  // editing, the draft is owned by the user; we re-sync on the next idle
  // render (after Save, Cancel, or Clear all flip `editing` back to false).
  useEffect(() => {
    if (!profile) return;
    if (editing) return;
    setAnswers(profile.profile?.answers ?? {});
  }, [profile, editing]);

  const steps = useMemo(() => {
    if (!profile) return [];
    const grouped = new Map<number, { title: string; questions: typeof profile.questions }>();
    for (const q of profile.questions) {
      const g = grouped.get(q.step) ?? { title: q.step_title, questions: [] };
      g.questions.push(q);
      grouped.set(q.step, g);
    }
    return [...grouped.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([s, g]) => ({ step: s, title: g.title, questions: g.questions }));
  }, [profile]);

  const currentStep = steps[stepIndex];
  const answeredLive = useMemo(() => {
    if (!profile) return 0;
    return profile.questions.filter((q) => {
      const v = answers[q.id];
      return typeof v === "string" && v.trim().length > 0;
    }).length;
  }, [answers, profile]);
  const total = profile?.total_questions ?? 0;
  const answered = editing ? answeredLive : profile?.answered_count ?? 0;
  const pct = total ? Math.round((answered / total) * 100) : 0;

  const handleSave = async () => {
    setSaving(true);
    const r = await data.saveProfile(answers);
    onToast(r.message, r.ok ? "ok" : "warn");
    if (r.ok) setEditing(false);
    setSaving(false);
  };

  const handleClear = async () => {
    if (!await confirmDialog("保存済みのユーザープロフィールコンテキストをクリアしますか？")) return;
    const r = await data.clearProfile();
    if (r.ok) {
      setAnswers({});
      setEditing(false);
      setStepIndex(0);
    }
    onToast(r.message, r.ok ? "ok" : "warn");
  };

  if (!profile) {
    return <div className="v2-set__empty">プロフィールを読み込み中…</div>;
  }

  return (
    <div>
      {/* Header card */}
      <section className="v2-set__section">
        <div className="v2-set__section-head">
          <div>
            <h3 className="v2-set__section-title">初期ユーザーコンテキスト</h3>
            <div className="v2-set__section-sub">
              Jarvisがすべての会話で使用する永続的なコンテキストです。一度きりではなく、いつでも調整できます。
            </div>
          </div>
          <div style={{ display: "flex", gap: "var(--s-2)", flexWrap: "wrap" }}>
            <button
              type="button"
              className="v2-set__btn v2-set__btn--primary"
              onClick={() => {
                setEditing(true);
                setStepIndex(0);
              }}
            >
              {profile.has_profile ? "プロフィールを編集" : "ウィザードを開始"}
            </button>
            {profile.has_profile && (
              <button type="button" className="v2-set__btn v2-set__btn--danger" onClick={handleClear}>
                クリア
              </button>
            )}
          </div>
        </div>

        <div className="v2-set__field">
          <div className="v2-set__row">
            <span className="v2-set__row-label">完了状況</span>
            <span className="v2-set__row-value">
              {answered}/{total} 件回答済み
            </span>
          </div>
          <div className="v2-set__wizard-progress">
            <div className="v2-set__wizard-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {profile.profile?.updated_at && (
          <div className="v2-set__row">
            <span className="v2-set__row-label">最終更新</span>
            <span className="v2-set__row-value">
              {new Date(profile.profile.updated_at).toLocaleString()}
            </span>
          </div>
        )}
      </section>

      {/* Wizard / snapshot */}
      {editing && currentStep ? (
        <section className="v2-set__section">
          <div className="v2-set__section-head">
            <div>
              <div className="v2-set__wizard-step">
                ステップ {stepIndex + 1} / {steps.length}
              </div>
              <h3 className="v2-set__section-title" style={{ marginTop: 4 }}>
                {currentStep.title}
              </h3>
            </div>
            <button type="button" className="v2-set__btn" onClick={() => setEditing(false)}>
              キャンセル
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-4)" }}>
            {currentStep.questions.map((q) => (
              <div key={q.id} className="v2-set__field">
                <div>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--ink)" }}>{q.label}</div>
                  <div className="v2-set__hint">
                    {q.prompt} {q.description}
                  </div>
                </div>
                {q.multiline ? (
                  <textarea
                    className="v2-set__textarea"
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
                    placeholder={q.placeholder}
                  />
                ) : (
                  <input
                    className="v2-set__input"
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
                    placeholder={q.placeholder}
                  />
                )}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--s-2)" }}>
            <button
              type="button"
              className="v2-set__btn"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((p) => Math.max(p - 1, 0))}
            >
              前へ
            </button>
            {stepIndex < steps.length - 1 ? (
              <button
                type="button"
                className="v2-set__btn v2-set__btn--primary"
                onClick={() => setStepIndex((p) => Math.min(p + 1, steps.length - 1))}
              >
                次へ
              </button>
            ) : (
              <button
                type="button"
                className="v2-set__btn v2-set__btn--primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "保存中…" : "プロフィールを保存"}
              </button>
            )}
          </div>
        </section>
      ) : profile.has_profile ? (
        <section className="v2-set__section">
          <h3 className="v2-set__section-title">保存済みコンテキスト</h3>
          <div className="v2-set__profile-snapshot">
            {steps.map((step) => {
              const answered = step.questions.filter((q) => {
                const v = profile.profile?.answers[q.id];
                return typeof v === "string" && v.trim().length > 0;
              });
              if (answered.length === 0) return null;
              return (
                <div key={step.step} className="v2-set__profile-group">
                  <div className="v2-set__profile-group-title">{step.title}</div>
                  <div style={{ display: "grid", gap: "var(--s-3)" }}>
                    {answered.map((q) => (
                      <div key={q.id}>
                        <div className="v2-set__profile-question">{q.label}</div>
                        <div className="v2-set__profile-answer">
                          {profile.profile?.answers[q.id]}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="v2-set__section">
          <p className="v2-set__hint">
            まだユーザープロフィールが保存されていません。ウィザードを開始して、
            あなたの人物像・目標・好み・習慣・状況についてJarvisに強い初期理解を与えましょう。
          </p>
        </section>
      )}

      <OnboardingReplaySection onToast={onToast} />
    </div>
  );
}

/**
 * Phase E — quick-access replay buttons for the conversational profile
 * interview and the spotlight tutorial. These are shortcuts to the
 * matching scope on `/api/onboarding/reset` (also reachable from
 * Settings → General → Onboarding for the full scope dropdown, by voice
 * with "replay onboarding", or via the URL trigger).
 */
function OnboardingReplaySection({
  onToast,
}: {
  onToast: (text: string, tone?: "ok" | "warn") => void;
}) {
  const [busy, setBusy] = useState<"interview" | "tutorial" | null>(null);

  const replay = async (scope: "profile" | "tutorial") => {
    const label =
      scope === "profile"
        ? "プロフィールインタビューを再実行しますか？保存済みのプロフィール情報は先にクリアされます。ページが再読み込みされます。"
        : "ダッシュボードチュートリアルを再生しますか？ページが再読み込みされます。";
    if (!await confirmDialog(label)) return;
    setBusy(scope === "profile" ? "interview" : "tutorial");
    try {
      await resetOnboarding(scope);
      onToast("再生を予約しました — 再読み込みしています…", "ok");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "warn");
      setBusy(null);
    }
  };

  return (
    <section className="v2-set__section">
      <div className="v2-set__section-head">
        <div>
          <h3 className="v2-set__section-title">オンボーディングを再生</h3>
          <div className="v2-set__section-sub">
            会話形式のインタビューを再実行してJarvisがあなたについて知っている情報を更新するか、
            ダッシュボードツアーをもう一度体験できます。
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: "var(--s-2)", flexWrap: "wrap" }}>
        <button
          type="button"
          className="v2-set__btn"
          onClick={() => replay("profile")}
          disabled={busy !== null}
        >
          {busy === "interview" ? "再起動中…" : "プロフィールインタビューを再実行"}
        </button>
        <button
          type="button"
          className="v2-set__btn"
          onClick={() => replay("tutorial")}
          disabled={busy !== null}
        >
          {busy === "tutorial" ? "再起動中…" : "チュートリアルを再生"}
        </button>
      </div>
    </section>
  );
}
