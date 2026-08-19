import { useState } from 'react';
import { useAppState } from '../state';
import { Button } from '../design/ui/Button';

export function FirstRunWizard() {
  const { settings, services, refreshSettings, refreshServices } = useAppState();
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
            <div className="list">
              {services.map((s) => (
                <label key={s.id} className="row">
                  <input type="checkbox" checked={enabledIds.has(s.id)} onChange={() => toggle(s.id)} />
                  {s.icon} {s.name}
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
