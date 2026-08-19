import { useEffect, useState } from 'react';
import { useAppState } from '../state';
import { Button } from '../design/ui/Button';
import { Chip } from '../design/ui/Chip';
import { suggestTopAI } from '../lib/aiRecommendation';
import type { Task, TaskStatus } from '../types';

const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'TODO' },
  { id: 'in_progress', label: 'IN PROGRESS' },
  { id: 'review', label: 'REVIEW' },
  { id: 'done', label: 'DONE' },
];

const PRIORITY_LABEL: Record<Task['priority'], string> = { high: '優先度: 高', normal: '優先度: 中', low: '優先度: 低' };
const PRIORITY_TONE: Record<Task['priority'], 'accent' | 'neutral' | 'ok'> = { high: 'accent', normal: 'neutral', low: 'ok' };

export function TasksScreen({ onOpenRoom }: { onOpenRoom: (room: 'handoff') => void }) {
  const { activeProjectId, projects, services, setHandoffDraftTask } = useAppState();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
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

  const addTask = async () => {
    if (!title.trim()) return;
    await window.api.tasks.create(activeProjectId, {
      title: title.trim(),
      assignedAI: suggestTopAI(title, services)?.name ?? '',
      priority: 'normal',
      relatedFiles: '',
      handoffId: null,
      notes: '',
    });
    setTitle('');
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

      <div className="card row">
        <input
          style={{ flex: 1 }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="新しいタスク名"
          onKeyDown={(e) => e.key === 'Enter' && addTask()}
        />
        <Button variant="primary" onClick={addTask}>追加</Button>
      </div>

      <div className="board">
        {COLUMNS.map((col) => (
          <div key={col.id} className="board-col">
            <div className="board-col__title">{col.label}</div>
            {tasks.filter((t) => t.status === col.id).map((t) => (
              <div key={t.id} className="task-card">
                <div style={{ fontWeight: 600 }}>{t.title}</div>
                {t.assignedAI && <div style={{ color: 'var(--ink2)' }}>担当: {t.assignedAI}</div>}
                <div className="row row--wrap">
                  <Chip tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Chip>
                </div>
                <div className="row row--wrap">
                  {COLUMNS.filter((c) => c.id !== t.status).map((c) => (
                    <Button key={c.id} size="sm" onClick={() => move(t, c.id)}>{c.label}へ</Button>
                  ))}
                  <Button size="sm" onClick={() => createHandoffFrom(t)}>Handoff作成</Button>
                  <Button size="sm" variant="danger" onClick={() => remove(t)}>削除</Button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
