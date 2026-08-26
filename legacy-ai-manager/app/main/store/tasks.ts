import path from 'node:path';
import crypto from 'node:crypto';
import { getProject } from './projects';
import { readJson, writeJson } from './jsonStore';

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

function tasksPath(projectDir: string): string {
  return path.join(projectDir, 'tasks.json');
}

export function listTasks(projectId: string): Task[] {
  const project = getProject(projectId);
  if (!project) return [];
  return readJson<Task[]>(tasksPath(project.dir), []);
}

export function createTask(projectId: string, input: Omit<Task, 'id' | 'createdAt'>): Task | null {
  const project = getProject(projectId);
  if (!project) return null;
  const tasks = listTasks(projectId);
  const task: Task = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
  };
  tasks.unshift(task);
  writeJson(tasksPath(project.dir), tasks);
  return task;
}

export function updateTask(projectId: string, taskId: string, patch: Partial<Task>): Task | null {
  const project = getProject(projectId);
  if (!project) return null;
  const tasks = listTasks(projectId);
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return null;
  tasks[idx] = { ...tasks[idx], ...patch };
  writeJson(tasksPath(project.dir), tasks);
  return tasks[idx];
}

export function deleteTask(projectId: string, taskId: string): boolean {
  const project = getProject(projectId);
  if (!project) return false;
  const tasks = listTasks(projectId).filter((t) => t.id !== taskId);
  writeJson(tasksPath(project.dir), tasks);
  return true;
}
