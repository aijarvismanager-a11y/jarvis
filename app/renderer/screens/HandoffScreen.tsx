import { useEffect, useState } from 'react';
import { useAppState } from '../state';
import { Button } from '../design/ui/Button';
import type { HandoffFile, HandoffInput } from '../types';

const EMPTY: HandoffInput = {
  from: '',
  to: '',
  task: '',
  completed: '',
  findings: '',
  remaining: '',
  files: '',
  instructions: '',
};

export function HandoffScreen() {
  const { activeProjectId, projects, services } = useAppState();
  const [handoffs, setHandoffs] = useState<HandoffFile[]>([]);
  const [form, setForm] = useState<HandoffInput>(EMPTY);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<HandoffFile | null>(null);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const refresh = async () => {
    if (!activeProjectId) return setHandoffs([]);
    setHandoffs(await window.api.handoffs.list(activeProjectId));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  if (!activeProjectId) {
    return (
      <div className="screen">
        <h1 className="screen__title">Handoff</h1>
        <div className="empty-state">プロジェクト画面でプロジェクトを選択してください。</div>
      </div>
    );
  }

  const submit = async () => {
    if (!form.from.trim() || !form.to.trim()) return;
    await window.api.handoffs.create(activeProjectId, form);
    setForm(EMPTY);
    setCreating(false);
    await refresh();
  };

  const copy = (h: HandoffFile) => navigator.clipboard.writeText(h.content);

  return (
    <div className="screen">
      <div className="screen__header">
        <div>
          <h1 className="screen__title">Handoff</h1>
          <p className="screen__subtitle">{activeProject?.name} — AIからAIへ作業を引き継ぐためのバトンです。</p>
        </div>
        <Button variant="primary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'キャンセル' : '+ 次のAIへ渡す'}
        </Button>
      </div>

      {creating && (
        <div className="card form-grid">
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>From</label>
              <select value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>
                <option value="">選択してください</option>
                {services.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>To</label>
              <select value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>
                <option value="">選択してください</option>
                {services.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div className="field"><label>Task</label><input value={form.task} onChange={(e) => setForm({ ...form, task: e.target.value })} /></div>
          <div className="field"><label>Completed（完了したこと）</label><textarea value={form.completed} onChange={(e) => setForm({ ...form, completed: e.target.value })} /></div>
          <div className="field"><label>Important Findings（重要な発見事項）</label><textarea value={form.findings} onChange={(e) => setForm({ ...form, findings: e.target.value })} /></div>
          <div className="field"><label>Remaining Tasks（残タスク）</label><textarea value={form.remaining} onChange={(e) => setForm({ ...form, remaining: e.target.value })} /></div>
          <div className="field"><label>Files（関連ファイル）</label><input value={form.files} onChange={(e) => setForm({ ...form, files: e.target.value })} /></div>
          <div className="field"><label>Instructions for Next AI</label><textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></div>
          <Button variant="primary" onClick={submit}>Handoffを作成</Button>
        </div>
      )}

      <div className="list">
        {handoffs.length === 0 && <div className="empty-state">Handoffはまだありません。</div>}
        {handoffs.map((h) => (
          <div key={h.filename} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{h.filename}</strong> — {h.from} → {h.to}
                <div style={{ color: 'var(--ink2)', fontSize: 13 }}>{h.task}</div>
              </div>
              <div className="row">
                <Button size="sm" onClick={() => setViewing(viewing?.filename === h.filename ? null : h)}>
                  {viewing?.filename === h.filename ? '閉じる' : '表示'}
                </Button>
                <Button size="sm" onClick={() => copy(h)}>コピー</Button>
              </div>
            </div>
            {viewing?.filename === h.filename && (
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginTop: 8, background: 'var(--panel2)', padding: 12, borderRadius: 6 }}>
                {h.content}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
