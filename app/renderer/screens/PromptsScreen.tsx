import { useEffect, useState } from 'react';
import { Button } from '../design/ui/Button';
import { Chip } from '../design/ui/Chip';
import type { Prompt } from '../types';

const CATEGORIES = ['Coding', 'Research', 'Writing', 'Image', 'Analysis', 'General'];

export function PromptsScreen() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [body, setBody] = useState('');
  const [filter, setFilter] = useState<string | null>(null);

  const refresh = async () => setPrompts(await window.api.prompts.list());
  useEffect(() => { refresh(); }, []);

  const submit = async () => {
    if (!title.trim() || !body.trim()) return;
    await window.api.prompts.create({ title: title.trim(), category, body });
    setTitle('');
    setBody('');
    setCreating(false);
    await refresh();
  };

  const remove = async (id: string) => {
    await window.api.prompts.delete(id);
    await refresh();
  };

  const visible = filter ? prompts.filter((p) => p.category === filter) : prompts;

  return (
    <div className="screen">
      <div className="screen__header">
        <div>
          <h1 className="screen__title">プロンプト管理</h1>
          <p className="screen__subtitle">AIへ渡す指示を保存・再利用できます。</p>
        </div>
        <Button variant="primary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'キャンセル' : '+ プロンプトを保存'}
        </Button>
      </div>

      <div className="row row--wrap">
        <Chip tone={filter === null ? 'accent' : 'neutral'} onClick={() => setFilter(null)} style={{ cursor: 'pointer' }}>すべて</Chip>
        {CATEGORIES.map((c) => (
          <Chip key={c} tone={filter === c ? 'accent' : 'neutral'} onClick={() => setFilter(c)} style={{ cursor: 'pointer' }}>{c}</Chip>
        ))}
      </div>

      {creating && (
        <div className="card form-grid">
          <div className="field"><label>タイトル</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：Webサイト制作指示" /></div>
          <div className="field">
            <label>カテゴリー</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field"><label>本文</label><textarea value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <Button variant="primary" onClick={submit}>保存</Button>
        </div>
      )}

      <div className="list">
        {visible.length === 0 && <div className="empty-state">プロンプトがありません。</div>}
        {visible.map((p) => (
          <div key={p.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row">
                <strong>{p.title}</strong>
                <Chip>{p.category}</Chip>
              </div>
              <div className="row">
                <Button size="sm" onClick={() => navigator.clipboard.writeText(p.body)}>コピー</Button>
                <Button size="sm" variant="danger" onClick={() => remove(p.id)}>削除</Button>
              </div>
            </div>
            <p style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--ink2)', margin: '8px 0 0' }}>{p.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
