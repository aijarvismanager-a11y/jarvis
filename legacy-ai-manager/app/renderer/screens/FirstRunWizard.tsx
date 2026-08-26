import { useState } from 'react';
import { useAppState } from '../state';
import { Button } from '../design/ui/Button';
import { Chip } from '../design/ui/Chip';

export function FirstRunWizard() {
  const { settings, services, categories, refreshSettings, refreshServices } = useAppState();
  const [step, setStep] = useState(0);
  const [projectsDir, setProjectsDir] = useState(settings?.projectsDir ?? '');
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set(services.map((s) => s.id)));

  const chooseDir = async () => {
    const dir = await window.api.settings.chooseProjectsDir();
    if (dir) setProjectsDir(dir);
  };

  const toggle = (id: string) => {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const finish = async () => {
    if (projectsDir) await window.api.settings.save({ projectsDir });
    const nextServices = services.map((s) => ({ ...s, enabled: enabledIds.has(s.id) }));
    await window.api.services.save(nextServices);
    await window.api.settings.save({ firstRunCompleted: true });
    await Promise.all([refreshSettings(), refreshServices()]);
  };

  return (
    <div className="wizard">
      <div className="wizard-card">
        <h1 style={{ margin: 0 }}>AI ORCHESTRATORへようこそ</h1>

        {step === 0 && (
          <>
            <h3>STEP 1 — プロジェクト保存場所</h3>
            <div className="row">
              <input readOnly value={projectsDir} placeholder="未設定（既定: ドキュメント/AI-Orchestrator/projects）" style={{ flex: 1 }} />
              <Button onClick={chooseDir}>選択</Button>
            </div>
            <Button variant="primary" onClick={() => setStep(1)}>次へ</Button>
          </>
        )}

        {step === 1 && (
          <>
            <h3>STEP 2 — 利用するAI</h3>
            <p style={{ color: 'var(--ink2)', fontSize: 13, marginTop: -8 }}>
              各AIの得意分野です。あとから「設定」画面でいつでも変更できます。
            </p>
            <div className="list">
              {services.map((s) => (
                <label
                  key={s.id}
                  className="card"
                  style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={enabledIds.has(s.id)}
                    onChange={() => toggle(s.id)}
                    style={{ marginTop: 4 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div className="row">
                      <span style={{ fontSize: 18 }}>{s.icon}</span>
                      <strong>{s.name}</strong>
                      {s.image_generation && <Chip tone="accent">画像生成</Chip>}
                    </div>
                    <p style={{ color: 'var(--ink2)', fontSize: 13, margin: '4px 0 6px' }}>{s.description}</p>
                    <div className="row row--wrap">
                      {s.category.map((c) => (
                        <Chip key={c}>{categories.find((cat) => cat.id === c)?.label ?? c}</Chip>
                      ))}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div className="row">
              <Button onClick={() => setStep(0)}>戻る</Button>
              <Button variant="primary" onClick={() => setStep(2)}>次へ</Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h3>STEP 3 — システムチェック</h3>
            <div className="list">
              <div className="row">✓ Windows</div>
              <div className="row">✓ ブラウザ（既定ブラウザでAIサービスを開きます）</div>
              {services.filter((s) => enabledIds.has(s.id)).map((s) => (
                <div key={s.id} className="row">✓ {s.name} URL</div>
              ))}
            </div>
            <p style={{ color: 'var(--ink2)', fontSize: 13 }}>
              各AIサービスへのログイン状態はこのアプリでは取得しません。初回はブラウザ側でログインしてください。
            </p>
            <div className="row">
              <Button onClick={() => setStep(1)}>戻る</Button>
              <Button variant="primary" onClick={finish}>完了</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
