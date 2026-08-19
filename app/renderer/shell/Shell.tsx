import { useState } from 'react';
import { useAppState } from '../state';
import { useTheme } from '../design/useTheme';
import { Button } from '../design/ui/Button';
import { AIListScreen } from '../screens/AIListScreen';
import { RouterScreen } from '../screens/RouterScreen';
import { ProjectsScreen } from '../screens/ProjectsScreen';
import { TasksScreen } from '../screens/TasksScreen';
import { HandoffScreen } from '../screens/HandoffScreen';
import { PromptsScreen } from '../screens/PromptsScreen';
import { FilesScreen } from '../screens/FilesScreen';
import { CompareScreen } from '../screens/CompareScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

type RoomId =
  | 'projects'
  | 'ai'
  | 'router'
  | 'tasks'
  | 'handoff'
  | 'prompts'
  | 'files'
  | 'compare'
  | 'settings';

const NAV: { id: RoomId; label: string; icon: string }[] = [
  { id: 'projects', label: 'プロジェクト', icon: '📁' },
  { id: 'ai', label: 'AI', icon: '🤖' },
  { id: 'router', label: 'AI Router', icon: '🧭' },
  { id: 'tasks', label: 'タスク', icon: '📋' },
  { id: 'handoff', label: 'Handoff', icon: '🔁' },
  { id: 'prompts', label: 'プロンプト', icon: '💡' },
  { id: 'files', label: 'ファイル', icon: '🗂' },
  { id: 'compare', label: 'AI比較', icon: '⚖️' },
  { id: 'settings', label: '設定', icon: '⚙️' },
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
  settings: '設定',
};

export function Shell() {
  const [room, setRoom] = useState<RoomId>('projects');
  const { projects, activeProjectId } = useAppState();
  const [resolved, , cycleTheme] = useTheme();
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  return (
    <div className="shell">
      <nav className="shell-nav">
        <div className="shell-nav__brand">🧭 AI Orchestrator</div>
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`shell-nav__item${room === item.id ? ' shell-nav__item--active' : ''}`}
            onClick={() => setRoom(item.id)}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
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
          {room === 'tasks' && <TasksScreen />}
          {room === 'handoff' && <HandoffScreen />}
          {room === 'prompts' && <PromptsScreen />}
          {room === 'files' && <FilesScreen />}
          {room === 'compare' && <CompareScreen />}
          {room === 'settings' && <SettingsScreen />}
        </div>
      </div>
    </div>
  );
}
