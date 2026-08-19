import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '../state';
import { Button } from '../design/ui/Button';
import { Chip } from '../design/ui/Chip';
import { useClickOutside } from '../lib/useClickOutside';
import { matchCategories, rankServices, suggestTopAI } from '../lib/aiRecommendation';
import type { RoomId } from '../shell/Shell';
import type { AIService, Task, TaskStatus } from '../types';

const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'TODO' },
  { id: 'in_progress', label: 'IN PROGRESS' },
  { id: 'review', label: 'REVIEW' },
  { id: 'done', label: 'DONE' },
];

const PRIORITY_LABEL: Record<Task['priority'], string> = { high: '優先度: 高', normal: '優先度: 中', low: '優先度: 低' };
const PRIORITY_TONE: Record<Task['priority'], 'accent' | 'neutral' | 'ok'> = { high: 'accent', normal: 'neutral', low: 'ok' };

function aiIcon(name: string, services: AIService[]): string {
  return services.find((s) => s.name === name)?.icon ?? '';
}

function TaskCard({
  task,
  services,
  onAdvance,
  onMove,
  onCreateHandoff,
  onRemove,
  onReassignAI,
}: {
  task: Task;
  services: AIService[];
  onAdvance: (() => void) | null;
  onMove: (status: TaskStatus) => void;
  onCreateHandoff: () => void;
  onRemove: () => void;
  onReassignAI: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingAI, setEditingAI] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));

  const currentIndex = COLUMNS.findIndex((c) => c.id === task.status);
  const jumpTargets = COLUMNS.filter((c, i) => c.id !== task.status && i !== currentIndex + 1);
  const enabledServices = services.filter((s) => s.enabled);

  return (
    <div className="task-card" ref={ref}>
      <div style={{ fontWeight: 600 }}>{task.title}</div>
      {editingAI ? (
        <select
          autoFocus
          value={task.assignedAI}
          onChange={(e) => { onReassignAI(e.target.value); setEditingAI(false); }}
          onBlur={() => setEditingAI(false)}
          style={{ fontSize: 12 }}
        >
          <option value="">担当AIなし</option>
          {enabledServices.map((s) => (
            <option key={s.id} value={s.name}>{s.icon} {s.name}</option>
          ))}
        </select>
      ) : (
        <button
          onClick={() => setEditingAI(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink2)',
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left',
          }}
        >
          {task.assignedAI
            ? <>担当AI: {aiIcon(task.assignedAI, services)}　{task.assignedAI}</>
            : <span style={{ color: 'var(--faint)' }}>担当AIを選択…</span>}
        </button>
      )}
      {task.priority !== 'normal' && (
        <div className="row row--wrap">
          <Chip tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Chip>
        </div>
      )}
      <div className="task-card__foot">
        {onAdvance ? (
          <button className="task-card__advance" onClick={onAdvance}>
            {COLUMNS[currentIndex + 1].label}へ →
          </button>
        ) : (
          <span />
        )}
        <div className="overflow-menu">
          <button className="overflow-menu__trigger" onClick={() => setOpen((v) => !v)} aria-label="メニュー">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="5" r="1.2" />
              <circle cx="12" cy="12" r="1.2" />
              <circle cx="12" cy="19" r="1.2" />
            </svg>
          </button>
          {open && (
            <div className="overflow-menu__list">
              {jumpTargets.map((c) => (
                <button key={c.id} className="overflow-menu__item" onClick={() => { setOpen(false); onMove(c.id); }}>
                  📋　{c.label}へ移動
                </button>
              ))}
              <div className="overflow-menu__divider" />
              <button className="overflow-menu__item" onClick={() => { setOpen(false); onCreateHandoff(); }}>🔁　Handoff作成</button>
              <div className="overflow-menu__divider" />
              <button className="overflow-menu__item overflow-menu__item--danger" onClick={() => { setOpen(false); onRemove(); }}>🗑　削除</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddTaskRow({ services, onAdd }: { services: AIService[]; onAdd: (title: string, assignedAI: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [assignedAI, setAssignedAI] = useState('');
  const [aiTouched, setAiTouched] = useState(false);
  const enabledServices = services.filter((s) => s.enabled);

  // Auto-fill the picker from the keyword match as the user types, but stop
  // once they've manually picked one themselves — typing more shouldn't
  // silently overwrite a choice they already made.
  useEffect(() => {
    if (aiTouched) return;
    const suggestion = value.trim() ? suggestTopAI(value, services) : null;
    setAssignedAI(suggestion?.name ?? '');
  }, [value, services, aiTouched]);

  const submit = () => {
    if (!value.trim()) return close();
    onAdd(value.trim(), assignedAI);
    close();
  };

  const close = () => {
    setValue('');
    setAssignedAI('');
    setAiTouched(false);
    setOpen(false);
  };

  if (!open) {
    return (
      <button className="board-col__add" onClick={() => setOpen(true)}>＋　タスクを追加</button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <input
        className="board-col__add-input"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="タスク名を入力"
      />
      <select
        value={assignedAI}
        onChange={(e) => { setAssignedAI(e.target.value); setAiTouched(true); }}
        style={{ fontSize: 12 }}
      >
        <option value="">担当AIなし</option>
        {enabledServices.map((s) => (
          <option key={s.id} value={s.name}>{s.icon} {s.name}</option>
        ))}
      </select>
      <div className="row">
        <Button size="sm" variant="primary" onClick={submit}>追加</Button>
        <Button size="sm" onClick={close}>キャンセル</Button>
      </div>
    </div>
  );
}

export function TasksScreen({ onOpenRoom }: { onOpenRoom: (room: RoomId) => void }) {
  const { activeProjectId, projects, services, categories, setHandoffDraftTask } = useAppState();
  const [tasks, setTasks] = useState<Task[]>([]);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  // The recommendation shown while creating the project (from its
  // description/用途) would otherwise vanish the moment that form closes —
  // keep it visible here too, since that's when task-by-task AI choices
  // actually get made.
  const projectMatchedCategories = useMemo(() => {
    if (!activeProject) return [];
    return matchCategories(`${activeProject.description} ${activeProject.purpose}`);
  }, [activeProject]);
  const projectSuggestedAIs = useMemo(
    () => rankServices(services, projectMatchedCategories),
    [services, projectMatchedCategories],
  );
  const categoryLabel = (id: string) => categories.find((c) => c.id === id)?.label ?? id;

  const refresh = async () => {
    if (!activeProjectId) return setTasks([]);
    setTasks(await window.api.tasks.list(activeProjectId));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  if (!activeProjectId || !activeProject) {
    return (
      <div className="screen">
        <h1 className="screen__title">タスクボード</h1>
        <div className="empty-state">プロジェクト画面でプロジェクトを選択してください。</div>
      </div>
    );
  }

  const addTask = async (status: TaskStatus, title: string, assignedAI: string) => {
    await window.api.tasks.create(activeProjectId, {
      title,
      assignedAI,
      priority: 'normal',
      status,
      relatedFiles: '',
      handoffId: null,
      notes: '',
    });
    await refresh();
  };

  const move = async (task: Task, status: TaskStatus) => {
    await window.api.tasks.update(activeProjectId, task.id, { status });
    await refresh();
  };

  const reassignAI = async (task: Task, assignedAI: string) => {
    await window.api.tasks.update(activeProjectId, task.id, { assignedAI });
    await refresh();
  };

  const remove = async (task: Task) => {
    await window.api.tasks.delete(activeProjectId, task.id);
    await refresh();
  };

  const createHandoffFrom = (task: Task) => {
    setHandoffDraftTask(task.title);
    onOpenRoom('handoff');
  };

  return (
    <div className="screen">
      <div className="screen__header">
        <div>
          <h1 className="screen__title">タスクボード</h1>
          <p className="screen__subtitle">{activeProject.name}</p>
        </div>
        <Button size="sm" onClick={() => onOpenRoom('router')}>🧭 AI Routerで確認</Button>
      </div>

      {projectSuggestedAIs.length > 0 && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}>
              このプロジェクトのおすすめAI — この説明・用途の作業内容に対する判定です
            </span>
            <Button
              size="sm"
              onClick={() => navigator.clipboard.writeText(`${activeProject.description}\n${activeProject.purpose}`.trim())}
            >
              📋 作業内容をコピー
            </Button>
          </div>
          <div className="row row--wrap" style={{ marginBottom: 8 }}>
            判定カテゴリー:
            {projectMatchedCategories.map((c) => <Chip key={c} tone="accent">{categoryLabel(c)}</Chip>)}
          </div>
          <div className="list">
            {projectSuggestedAIs.map(({ service, score }, i) => (
              <div key={service.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13 }}>
                  {['🥇', '🥈', '🥉'][i] ?? '　'} {service.icon} {service.name}
                  <span style={{ color: 'var(--ink3)', fontSize: 12 }}>
                    {' '}— 理由: {service.category.filter((c) => projectMatchedCategories.includes(c)).map(categoryLabel).join('・')}に向いています（一致度 {score}）
                  </span>
                </span>
                <Button size="sm" onClick={() => window.api.ai.open(service.url, service.name)}>{service.name}を開く</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="board">
        {COLUMNS.map((col, colIndex) => {
          const colTasks = tasks.filter((t) => t.status === col.id);
          const next = COLUMNS[colIndex + 1];
          return (
            <div key={col.id} className="board-col">
              <div className="board-col__head">
                <span className="board-col__title">{col.label}</span>
                <span className="board-col__count">{colTasks.length}</span>
              </div>
              {colTasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  services={services}
                  onAdvance={next ? () => move(t, next.id) : null}
                  onMove={(status) => move(t, status)}
                  onCreateHandoff={() => createHandoffFrom(t)}
                  onRemove={() => remove(t)}
                  onReassignAI={(name) => reassignAI(t, name)}
                />
              ))}
              <AddTaskRow services={services} onAdd={(title, assignedAI) => addTask(col.id, title, assignedAI)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
