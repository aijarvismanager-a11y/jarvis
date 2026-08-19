import { useState } from 'react';
import { useAppState } from '../state';
import { Button } from '../design/ui/Button';
import { Chip } from '../design/ui/Chip';

export function ProjectsScreen({ onOpenRoom }: { onOpenRoom: (room: 'tasks') => void }) {
  const { projects, activeProjectId, setActiveProjectId, refreshProjects } = useAppState();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    await window.api.projects.create({ name: name.trim(), description, purpose });
    setName('');
    setDescription('');
    setPurpose('');
    setCreating(false);
    await refreshProjects();
  };

  const remove = async (id: string, projectName: string) => {
    if (!window.confirm(`プロジェクト「${projectName}」を一覧から削除します。フォルダ内のファイルは残ります。よろしいですか？`)) return;
    await window.api.projects.delete(id, false);
    if (activeProjectId === id) setActiveProjectId(null);
    await refreshProjects();
  };

  return (
    <div className="screen">
      <div className="screen__header">
        <div>
          <h1 className="screen__title">プロジェクト</h1>
          <p className="screen__subtitle">プロジェクトごとにAI作業・タスク・Handoffを管理します。</p>
        </div>
        <Button variant="primary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'キャンセル' : '+ 新規プロジェクト'}
        </Button>
      </div>

      {creating && (
        <div className="card form-grid">
          <div className="field">
            <label>プロジェクト名</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：移籍クロニクル" />
          </div>
          <div className="field">
            <label>説明</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label>用途</label>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例：ブログ記事の作成" />
          </div>
          <Button variant="primary" onClick={submit}>作成</Button>
        </div>
      )}

      <div className="list">
        {projects.length === 0 && !creating && (
          <div className="empty-state">プロジェクトがありません。「+ 新規プロジェクト」から作成してください。</div>
        )}
        {projects.map((p) => (
          <div key={p.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="row">
                  <strong>{p.name}</strong>
                  {activeProjectId === p.id && <Chip tone="ok">選択中</Chip>}
                </div>
                {editingId === p.id ? (
                  <textarea
                    defaultValue={p.description}
                    onBlur={async (e) => {
                      await window.api.projects.update(p.id, { description: e.target.value });
                      setEditingId(null);
                      await refreshProjects();
                    }}
                  />
                ) : (
                  <p style={{ color: 'var(--ink2)', fontSize: 13, margin: '4px 0 0' }}>{p.description || p.purpose}</p>
                )}
                <p style={{ color: 'var(--faint)', fontSize: 12, margin: '4px 0 0' }}>{p.dir}</p>
              </div>
              <div className="row">
                <Button
                  variant={activeProjectId === p.id ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    setActiveProjectId(p.id);
                    onOpenRoom('tasks');
                  }}
                >
                  開く
                </Button>
                <Button size="sm" onClick={() => window.api.projects.openFolder(p.id)}>フォルダ</Button>
                <Button size="sm" onClick={() => setEditingId(p.id)}>編集</Button>
                <Button size="sm" variant="danger" onClick={() => remove(p.id, p.name)}>削除</Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
