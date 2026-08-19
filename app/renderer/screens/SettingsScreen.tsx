import { useState } from 'react';
import { useAppState } from '../state';
import { Button } from '../design/ui/Button';
import type { AIService } from '../types';

const EMPTY_SERVICE: AIService = {
  id: '',
  name: '',
  url: '',
  icon: '🔧',
  category: [],
  image_generation: false,
  free: true,
  free_note: '無料枠あり※利用上限はサービス側の仕様に依存',
  japanese: false,
  description: '',
  enabled: true,
};

export function SettingsScreen() {
  const { settings, refreshSettings, services, refreshServices, categories } = useAppState();
  const [addingService, setAddingService] = useState(false);
  const [draft, setDraft] = useState<AIService>(EMPTY_SERVICE);
  const [backupMsg, setBackupMsg] = useState('');

  if (!settings) return null;

  const saveSetting = async (patch: Partial<typeof settings>) => {
    await window.api.settings.save(patch);
    await refreshSettings();
  };

  const toggleEnabled = async (id: string) => {
    const next = services.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
    await window.api.services.save(next);
    await refreshServices();
  };

  const removeService = async (id: string) => {
    if (!window.confirm('このAIサービスを削除しますか？')) return;
    await window.api.services.save(services.filter((s) => s.id !== id));
    await refreshServices();
  };

  const addService = async () => {
    if (!draft.name.trim() || !draft.url.trim()) return;
    const id = draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await window.api.services.save([...services, { ...draft, id }]);
    setDraft(EMPTY_SERVICE);
    setAddingService(false);
    await refreshServices();
  };

  const chooseProjectsDir = async () => {
    const dir = await window.api.settings.chooseProjectsDir();
    if (dir) await saveSetting({ projectsDir: dir });
  };

  return (
    <div className="screen">
      <h1 className="screen__title">設定</h1>

      <div className="card form-grid">
        <h3 style={{ margin: 0 }}>General</h3>
        <label className="row"><input type="checkbox" checked={settings.openLastProjectOnStartup} onChange={(e) => saveSetting({ openLastProjectOnStartup: e.target.checked })} /> 起動時に前回のプロジェクトを開く</label>
        <label className="row"><input type="checkbox" checked={settings.showAIListOnStartup} onChange={(e) => saveSetting({ showAIListOnStartup: e.target.checked })} /> 起動時にAI一覧を表示</label>
        <label className="row"><input type="checkbox" checked={settings.notificationsEnabled} onChange={(e) => saveSetting({ notificationsEnabled: e.target.checked })} /> 通知を有効にする</label>
      </div>

      <div className="card form-grid">
        <h3 style={{ margin: 0 }}>Appearance</h3>
        <div className="row row--wrap">
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <label key={mode} className="row">
              <input type="radio" name="appearance" checked={settings.appearance === mode} onChange={() => saveSetting({ appearance: mode })} />
              {mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'System'}
            </label>
          ))}
        </div>
      </div>

      <div className="card form-grid">
        <h3 style={{ margin: 0 }}>Projects</h3>
        <div className="row">
          <input readOnly value={settings.projectsDir} style={{ flex: 1 }} />
          <Button onClick={chooseProjectsDir}>変更</Button>
        </div>
      </div>

      <div className="card form-grid">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>AI Services</h3>
          <Button onClick={() => setAddingService((v) => !v)}>{addingService ? 'キャンセル' : '+ AIを追加'}</Button>
        </div>
        {services.map((s) => (
          <div key={s.id} className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--rule)', paddingTop: 8 }}>
            <div>{s.icon} {s.name} <span style={{ color: 'var(--faint)', fontSize: 12 }}>{s.url}</span></div>
            <div className="row">
              <label className="row"><input type="checkbox" checked={s.enabled} onChange={() => toggleEnabled(s.id)} /> 有効</label>
              <Button size="sm" variant="danger" onClick={() => removeService(s.id)}>削除</Button>
            </div>
          </div>
        ))}
        {addingService && (
          <div className="form-grid" style={{ borderTop: '1px solid var(--rule)', paddingTop: 8 }}>
            <div className="field"><label>AI名</label><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div className="field"><label>URL</label><input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://..." /></div>
            <div className="field"><label>説明</label><input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
            <div className="field">
              <label>カテゴリー（カンマ区切り: {categories.map((c) => c.id).join(', ')}）</label>
              <input
                value={draft.category.join(',')}
                onChange={(e) => setDraft({ ...draft, category: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              />
            </div>
            <label className="row"><input type="checkbox" checked={draft.free} onChange={(e) => setDraft({ ...draft, free: e.target.checked })} /> 無料プランあり</label>
            <label className="row"><input type="checkbox" checked={draft.japanese} onChange={(e) => setDraft({ ...draft, japanese: e.target.checked })} /> 日本語対応</label>
            <label className="row"><input type="checkbox" checked={draft.image_generation} onChange={(e) => setDraft({ ...draft, image_generation: e.target.checked })} /> 画像生成</label>
            <Button variant="primary" onClick={addService}>追加する</Button>
          </div>
        )}
      </div>

      <div className="card form-grid">
        <h3 style={{ margin: 0 }}>バックアップ</h3>
        <div className="row">
          <Button onClick={async () => {
            const r = await window.api.backup.create();
            setBackupMsg(r.ok ? `バックアップを作成しました: ${r.path}` : '');
          }}>バックアップ作成</Button>
          <Button onClick={async () => {
            const r = await window.api.backup.restore();
            setBackupMsg(r.ok ? '復元しました。アプリを再起動してください。' : '');
          }}>バックアップから復元</Button>
        </div>
        {backupMsg && <p style={{ color: 'var(--ok-tx)', fontSize: 13 }}>{backupMsg}</p>}
      </div>
    </div>
  );
}
