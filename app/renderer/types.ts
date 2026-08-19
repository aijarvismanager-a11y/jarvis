export interface AIService {
  id: string;
  name: string;
  url: string;
  icon: string;
  category: string[];
  image_generation: boolean;
  free: boolean;
  free_note: string;
  japanese: boolean;
  description: string;
  enabled: boolean;
}

export interface Category {
  id: string;
  label: string;
}

export interface Settings {
  openLastProjectOnStartup: boolean;
  showAIListOnStartup: boolean;
  notificationsEnabled: boolean;
  appearance: 'light' | 'dark' | 'system';
  projectsDir: string;
  firstRunCompleted: boolean;
  lastOpenProjectId?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  purpose: string;
  dir: string;
  createdAt: string;
}

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done';

export interface Task {
  id: string;
  title: string;
  assignedAI: string;
  priority: 'low' | 'normal' | 'high';
  status: TaskStatus;
  relatedFiles: string;
  handoffId: string | null;
  notes: string;
  createdAt: string;
}

export interface HandoffInput {
  from: string;
  to: string;
  task: string;
  completed: string;
  findings: string;
  remaining: string;
  files: string;
  instructions: string;
}

export interface HandoffFile {
  filename: string;
  from: string;
  to: string;
  task: string;
  createdAt: string;
  content: string;
}

export interface Prompt {
  id: string;
  title: string;
  category: string;
  body: string;
  createdAt: string;
}

export interface LogEntry {
  timestamp: string;
  ai?: string;
  message: string;
}

export interface Api {
  ai: { open: (url: string, aiName: string) => Promise<boolean> };
  settings: {
    load: () => Promise<Settings>;
    save: (patch: Partial<Settings>) => Promise<Settings>;
    chooseProjectsDir: () => Promise<string | null>;
  };
  services: {
    list: () => Promise<AIService[]>;
    save: (services: AIService[]) => Promise<AIService[]>;
  };
  categories: { list: () => Promise<Category[]> };
  projects: {
    list: () => Promise<Project[]>;
    create: (input: { name: string; description: string; purpose: string }) => Promise<Project>;
    update: (id: string, patch: Partial<Project>) => Promise<Project | null>;
    delete: (id: string, removeFiles: boolean) => Promise<boolean>;
    openFolder: (id: string) => Promise<{ ok: boolean; error?: string }>;
    watch: (id: string | null) => Promise<boolean>;
    export: (id: string) => Promise<{ ok: boolean; error?: string }>;
  };
  tasks: {
    list: (projectId: string) => Promise<Task[]>;
    create: (projectId: string, input: Omit<Task, 'id' | 'createdAt' | 'status'>) => Promise<Task | null>;
    update: (projectId: string, taskId: string, patch: Partial<Task>) => Promise<Task | null>;
    delete: (projectId: string, taskId: string) => Promise<boolean>;
  };
  handoffs: {
    list: (projectId: string) => Promise<HandoffFile[]>;
    create: (projectId: string, input: HandoffInput) => Promise<HandoffFile | null>;
  };
  prompts: {
    list: () => Promise<Prompt[]>;
    create: (input: Omit<Prompt, 'id' | 'createdAt'>) => Promise<Prompt>;
    update: (id: string, patch: Partial<Prompt>) => Promise<Prompt | null>;
    delete: (id: string) => Promise<boolean>;
  };
  logs: { list: (limit?: number) => Promise<LogEntry[]> };
  backup: {
    create: () => Promise<{ ok: boolean; path?: string }>;
    restore: () => Promise<{ ok: boolean }>;
  };
  shell: { openPath: (targetPath: string) => Promise<void> };
  onFilesChanged: (callback: (payload: { event: string; path: string }) => void) => () => void;
}

declare global {
  interface Window {
    api: Api;
  }
}
