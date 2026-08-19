import { useEffect, useRef, useState } from 'react';
import { useAppState } from '../state';
import { Chip } from '../design/ui/Chip';
import { useClickOutside } from '../lib/useClickOutside';
import { suggestTopAI } from '../lib/aiRecommendation';
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
}: {
  task: Task;
  services: AIService[];
  onAdvance: (() => void) | null;
  onMove: (status: TaskStatus) => void;
  onCreateHandoff: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));

  const currentIndex = COLUMNS.findIndex((c) => c.id === task.status);
  const jumpTargets = COLUMNS.filter((c, i) => c.id !== task.status && i !== currentIndex + 1);

  return (
    <div className="task-card" ref={ref}>
      <div style={{ fontWeight: 600 }}>{task.title}</div>
      {task.assignedAI && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink2)' }}>
          {aiIcon(task.assignedAI, services)}　{task.assignedAI}
        </span>
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

function AddTaskRow({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  const submit = () => {
    if (!value.trim()) return setOpen(false);
    onAdd(value.trim());
    setValue('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button className="board-col__add" onClick={() => setOpen(true)}>＋　タスクを追加</button>
    );
  }

  return (
    <input
      className="board-col__add-input"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && submit()}
      onBlur={submit}
      placeholder="タスク名を入力してEnter"
    />
  );
}

export function TasksScreen({ onOpenRoom }: { onOpenRoom: (room: 'handoff') => void }) {
  const { activeProjectId, projects, services, setHandoffDraftTask } = useAppState();
  const [tasks, setTasks] = useState<Task[]>([]);
  const activeProject = projects.find((p) => p.id === activeProjectId);

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

  const addTask = async (status: TaskStatus, title: string) => {
    await window.api.tasks.create(activeProjectId, {
      title,
      assignedAI: suggestTopAI(title, services)?.name ?? '',
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
      </div>

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
                />
              ))}
              <AddTaskRow onAdd={(title) => addTask(col.id, title)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
