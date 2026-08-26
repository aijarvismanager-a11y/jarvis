import { useRef, useState } from 'react';
import { useAppState } from '../state';
import { useTheme } from '../design/useTheme';
import { Button } from '../design/ui/Button';
import { useClickOutside } from '../lib/useClickOutside';
import { AIListScreen } from '../screens/AIListScreen';
import { RouterScreen } from '../screens/RouterScreen';
import { ProjectsScreen } from '../screens/ProjectsScreen';
import { TasksScreen } from '../screens/TasksScreen';
import { HandoffScreen } from '../screens/HandoffScreen';
import { PromptsScreen } from '../screens/PromptsScreen';
import { FilesScreen } from '../screens/FilesScreen';
import { CompareScreen } from '../screens/CompareScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { LogsScreen } from '../screens/LogsScreen';

export type RoomId =
  | 'projects'
  | 'ai'
  | 'router'
  | 'tasks'
  | 'handoff'
  | 'prompts'
  | 'files'
  | 'compare'
  | 'logs'
  | 'settings';

interface NavItem {
  id: RoomId;
  label: string;
  icon: string;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'プロジェクト',
    items: [
      { id: 'projects', label: 'プロジェクト', icon: '📁' },
      { id: 'tasks', label: 'タスク', icon: '📋' },
      { id: 'handoff', label: 'Handoff', icon: '🔁' },
      { id: 'files', label: 'ファイル', icon: '🗂' },
    ],
  },
  {
    label: 'AI',
    items: [
      { id: 'ai', label: 'AI一覧', icon: '🤖' },
      { id: 'router', label: 'AI Router', icon: '🧭' },
      { id: 'compare', label: 'AI比較', icon: '⚖️' },
    ],
  },
  {
    label: 'その他',
    items: [
      { id: 'prompts', label: 'プロンプト', icon: '💡' },
      { id: 'logs', label: 'ログ', icon: '📜' },
    ],
  },
];

const ROOM_TITLE: Record<RoomId, string> = {
  projects: 'プロジェクト',
  ai: 'AI一覧',
  router: 'AI Router',
  tasks: 'タスクボード',
  handoff: 'Handoff',
  prompts: 'プロンプト管理',
  files: 'ファイル監視',
  compare: 'AI比較',
  logs: 'ログ',
  settings: '設定',
};

function ProjectSwitcher({ onOpenRoom }: { onOpenRoom: (room: RoomId) => void }) {
  const { projects, activeProjectId, setActiveProjectId } = useAppState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  return (
    <div className="switcher" ref={ref}>
      <button className="switcher__trigger" onClick={() => setOpen((v) => !v)}>
        <div className="switcher__label">現在のプロジェクト</div>
        <div className="switcher__row">
          <span className="switcher__name">{activeProject ? activeProject.name : '未選択'}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.6 }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>
      {open && (
        <div className="switcher__menu">
          {projects.length === 0 && (
            <div style={{ padding: '8px 10px', fontSize: 13, color: 'var(--ink3)' }}>プロジェクトがありません</div>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              className={`switcher__item${p.id === activeProjectId ? ' switcher__item--active' : ''}`}
              onClick={() => {
                setActiveProjectId(p.id);
                setOpen(false);
              }}
            >
              {p.name}
            </button>
          ))}
          <div className="overflow-menu__divider" />
          <button
            className="switcher__item"
            onClick={() => {
              onOpenRoom('projects');
              setOpen(false);
            }}
          >
            プロジェクト一覧を開く
          </button>
        </div>
      )}
    </div>
  );
}

export function Shell() {
  const [room, setRoom] = useState<RoomId>('projects');
  const { projects, activeProjectId } = useAppState();
  const [resolved, , cycleTheme] = useTheme();
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  return (
    <div className="shell">
      <nav className="shell-nav">
        <div className="shell-nav__brand">🧭 AI Orchestrator</div>
        <ProjectSwitcher onOpenRoom={setRoom} />
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="shell-nav__group-label">{group.label}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                className={`shell-nav__item${room === item.id ? ' shell-nav__item--active' : ''}`}
                onClick={() => setRoom(item.id)}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ))}
        <div className="shell-nav__spacer" />
        <div className="shell-nav__bottom">
          <button
            className={`shell-nav__item${room === 'settings' ? ' shell-nav__item--active' : ''}`}
            onClick={() => setRoom('settings')}
          >
            <span>⚙️</span>
            <span>設定</span>
          </button>
        </div>
      </nav>
      <div className="shell-main">
        <header className="shell-topbar">
          <div className="shell-topbar__title">
            {ROOM_TITLE[room]}
            {activeProject ? ` — ${activeProject.name}` : ''}
          </div>
          <Button size="sm" onClick={() => cycleTheme()}>
            {resolved === 'dark' ? '🌙 ダーク' : '☀️ ライト'}
          </Button>
        </header>
        <div className="shell-content">
          {room === 'projects' && <ProjectsScreen onOpenRoom={setRoom} />}
          {room === 'ai' && <AIListScreen />}
          {room === 'router' && <RouterScreen />}
          {room === 'tasks' && <TasksScreen onOpenRoom={setRoom} />}
          {room === 'handoff' && <HandoffScreen />}
          {room === 'prompts' && <PromptsScreen />}
          {room === 'files' && <FilesScreen />}
          {room === 'compare' && <CompareScreen />}
          {room === 'logs' && <LogsScreen />}
          {room === 'settings' && <SettingsScreen />}
        </div>
      </div>
    </div>
  );
}
