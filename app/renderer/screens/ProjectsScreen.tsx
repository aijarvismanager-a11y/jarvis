import { useMemo, useState } from 'react';
import { useAppState } from '../state';
import { Button } from '../design/ui/Button';
import { Chip } from '../design/ui/Chip';

type SortOrder = 'newest' | 'oldest' | 'name';

export function ProjectsScreen({ onOpenRoom }: { onOpenRoom: (room: 'tasks') => void }) {
  const { projects, activeProjectId, setActiveProjectId, refreshProjects } = useAppState();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!name.trim()) return;
    try {
      await window.api.projects.create({ name: name.trim(), description, purpose });
      setName('');
      setDescription('');
      setPurpose('');
      setCreating(false);
      setError('');
      await refreshProjects();
    } catch (e) {
      setError(`プロジェクトの作成に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const remove = async (id: string, projectName: string) => {
    if (!window.confirm(`プロジェクト「${projectName}」を一覧から削除します。フォルダ内のファイルは残ります。よろしいですか？`)) return;
    try {
      await window.api.projects.delete(id, false);
      if (activeProjectId === id) setActiveProjectId(null);
      setError('');
      await refreshProjects();
    } catch (e) {
      setError(`プロジェクトの削除に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const openFolder = async (id: string) => {
    const result = await window.api.projects.openFolder(id);
    if (!result.ok && result.error) {
      setError(`フォルダを開けませんでした: ${result.error}`);
    }
  };

  const exportProject = async (id: string) => {
    const result = await window.api.projects.export(id);
    if (!result.ok && result.error) {
      setError(`エクスポートに失敗しました: ${result.error}`);
    }
  };

  const visibleProjects = useMemo(() => {
    const filtered = search.trim()
      ? projects.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
      : projects;
    const sorted = [...filtered];
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    else if (sort === 'oldest') sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    else sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sorted;
  }, [projects, search, sort]);

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

      {error && (
        <div className="card" style={{ borderColor: 'var(--listen)', color: 'var(--listen-tx)' }}>
          {error}
        </div>
      )}

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

      {projects.length > 0 && (
        <div className="row">
          <input
            style={{ flex: 1 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="プロジェクト名で検索"
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as SortOrder)}>
            <option value="newest">新しい順</option>
            <option value="oldest">古い順</option>
            <option value="name">名前順</option>
          </select>
        </div>
      )}

      <div className="list">
        {projects.length === 0 && !creating && (
          <div className="empty-state">プロジェクトがありません。「+ 新規プロジェクト」から作成してください。</div>
        )}
        {projects.length > 0 && visibleProjects.length === 0 && (
          <div className="empty-state">「{search}」に一致するプロジェクトがありません。</div>
        )}
        {visibleProjects.map((p) => (
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
              <div className="row row--wrap">
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
                <Button size="sm" onClick={() => openFolder(p.id)}>フォルダ</Button>
                <Button size="sm" onClick={() => exportProject(p.id)}>エクスポート</Button>
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
