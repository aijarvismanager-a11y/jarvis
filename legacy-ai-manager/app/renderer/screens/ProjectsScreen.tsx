import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '../state';
import { Button } from '../design/ui/Button';
import { Chip } from '../design/ui/Chip';
import { useClickOutside } from '../lib/useClickOutside';
import { matchCategories, rankServices } from '../lib/aiRecommendation';
import type { Project } from '../types';

type SortOrder = 'newest' | 'oldest' | 'name';

const AVATAR_COLORS = ['var(--speak)', 'var(--ok)', 'var(--hold)', 'var(--listen)'];

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
}

function ProjectCardMenu({ project, onEdit }: { project: Project; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  const { activeProjectId, setActiveProjectId, refreshProjects } = useAppState();

  const openFolder = async () => {
    setOpen(false);
    const result = await window.api.projects.openFolder(project.id);
    if (!result.ok && result.error) window.alert(`フォルダを開けませんでした: ${result.error}`);
  };

  const exportProject = async () => {
    setOpen(false);
    const result = await window.api.projects.export(project.id);
    if (!result.ok && result.error) window.alert(`エクスポートに失敗しました: ${result.error}`);
  };

  const remove = async () => {
    setOpen(false);
    if (!window.confirm(`プロジェクト「${project.name}」を一覧から削除します。フォルダ内のファイルは残ります。よろしいですか？`)) return;
    await window.api.projects.delete(project.id, false);
    if (activeProjectId === project.id) setActiveProjectId(null);
    await refreshProjects();
  };

  return (
    <div className="overflow-menu" ref={ref}>
      <button className="overflow-menu__trigger" onClick={() => setOpen((v) => !v)} aria-label="メニュー">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="5" r="1.2" />
          <circle cx="12" cy="12" r="1.2" />
          <circle cx="12" cy="19" r="1.2" />
        </svg>
      </button>
      {open && (
        <div className="overflow-menu__list">
          <button className="overflow-menu__item" onClick={openFolder}>📂　フォルダを開く</button>
          <button className="overflow-menu__item" onClick={exportProject}>⇩　エクスポート</button>
          <button className="overflow-menu__item" onClick={() => { setOpen(false); onEdit(); }}>✎　編集</button>
          <div className="overflow-menu__divider" />
          <button className="overflow-menu__item overflow-menu__item--danger" onClick={remove}>🗑　削除</button>
        </div>
      )}
    </div>
  );
}

export function ProjectsScreen({ onOpenRoom }: { onOpenRoom: (room: 'tasks') => void }) {
  const { projects, categories, services, activeProjectId, setActiveProjectId, refreshProjects } = useAppState();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [error, setError] = useState('');
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        projects.map(async (p) => [p.id, (await window.api.tasks.list(p.id)).length] as const),
      );
      if (!cancelled) setTaskCounts(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [projects]);

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

  const matchedCategories = useMemo(
    () => matchCategories(`${name} ${description} ${purpose}`),
    [name, description, purpose],
  );
  const suggestedAIs = useMemo(
    () => rankServices(services, matchedCategories),
    [services, matchedCategories],
  );
  const categoryLabel = (id: string) => categories.find((c) => c.id === id)?.label ?? id;

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

          {(description.trim() || purpose.trim()) && (
            <div className="field">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <label style={{ margin: 0 }}>おすすめAI — この説明・用途の作業内容に対する判定です</label>
                <Button
                  size="sm"
                  onClick={() => navigator.clipboard.writeText(`${description}\n${purpose}`.trim())}
                >
                  📋 作業内容をコピー
                </Button>
              </div>
              {suggestedAIs.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--ink3)', margin: 0 }}>
                  一致するAIが見つかりませんでした。作成後、タスクごとに担当AIを選べます。
                </p>
              ) : (
                <div className="list">
                  <div className="row row--wrap">
                    判定カテゴリー:
                    {matchedCategories.map((c) => <Chip key={c} tone="accent">{categoryLabel(c)}</Chip>)}
                  </div>
                  {suggestedAIs.map(({ service, score }, i) => (
                    <div key={service.id} className="row" style={{ justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13 }}>
                        {['🥇', '🥈', '🥉'][i] ?? '　'} {service.icon} {service.name}
                        <span style={{ color: 'var(--ink3)', fontSize: 12 }}>
                          {' '}— 理由: {service.category.filter((c) => matchedCategories.includes(c)).map(categoryLabel).join('・')}に向いています（一致度 {score}）
                        </span>
                      </span>
                      <Button size="sm" onClick={() => window.api.ai.open(service.url, service.name)}>{service.name}を開く</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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

      <div className="card-grid">
        {projects.length === 0 && !creating && (
          <div className="empty-state" style={{ gridColumn: '1 / -1' }}>プロジェクトがありません。「+ 新規プロジェクト」から作成してください。</div>
        )}
        {projects.length > 0 && visibleProjects.length === 0 && (
          <div className="empty-state" style={{ gridColumn: '1 / -1' }}>「{search}」に一致するプロジェクトがありません。</div>
        )}
        {visibleProjects.map((p) => (
          <div key={p.id} className="card p-card">
            <div className="p-card__top">
              <div className="row">
                <div className="avatar" style={{ background: avatarColor(p.id) }}>{p.name.slice(0, 1)}</div>
                <div>
                  <div className="row">
                    <strong>{p.name}</strong>
                  </div>
                  {activeProjectId === p.id && <Chip tone="ok">選択中</Chip>}
                </div>
              </div>
              <ProjectCardMenu project={p} onEdit={() => setEditingId(p.id)} />
            </div>
            {editingId === p.id ? (
              <textarea
                className="p-card__desc"
                style={{ minHeight: 60, resize: 'vertical' }}
                defaultValue={p.description}
                autoFocus
                onBlur={async (e) => {
                  await window.api.projects.update(p.id, { description: e.target.value });
                  setEditingId(null);
                  await refreshProjects();
                }}
              />
            ) : (
              <p className="p-card__desc">{p.description || p.purpose || '説明はありません。'}</p>
            )}
            <div className="row row--wrap">
              <Chip>📋 {taskCounts[p.id] ?? 0} タスク</Chip>
              <Chip>🕐 作成: {formatDate(p.createdAt)}</Chip>
            </div>
            <Button
              variant="primary"
              onClick={() => {
                setActiveProjectId(p.id);
                onOpenRoom('tasks');
              }}
            >
              開く
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
