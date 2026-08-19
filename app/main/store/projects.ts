import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { shell } from 'electron';
import { dataDir } from '../paths';
import { loadSettings } from './settings';
import { readJson, writeJson } from './jsonStore';
import { appendLog } from './logs';

export interface Project {
  id: string;
  name: string;
  description: string;
  purpose: string;
  dir: string;
  createdAt: string;
}

const TEMPLATE_FOLDERS = [
  'research',
  'analysis',
  'writing',
  'code',
  'images',
  'output',
  'handoff',
  'logs',
];

const indexPath = path.join(dataDir, 'projects.json');

function loadIndex(): Project[] {
  return readJson<Project[]>(indexPath, []);
}

function saveIndex(projects: Project[]): void {
  writeJson(indexPath, projects);
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'project';
}

export function listProjects(): Project[] {
  return loadIndex();
}

export function createProject(input: { name: string; description: string; purpose: string }): Project {
  const settings = loadSettings();
  const projectsRoot = settings.projectsDir;
  fs.mkdirSync(projectsRoot, { recursive: true });

  let dirName = slugify(input.name);
  let dir = path.join(projectsRoot, dirName);
  let n = 2;
  while (fs.existsSync(dir)) {
    dir = path.join(projectsRoot, `${dirName}-${n}`);
    n += 1;
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const folder of TEMPLATE_FOLDERS) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
  }

  const project: Project = {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    purpose: input.purpose,
    dir,
    createdAt: new Date().toISOString(),
  };

  const projects = loadIndex();
  projects.unshift(project);
  saveIndex(projects);
  appendLog({ message: `プロジェクト「${project.name}」を作成しました` });
  return project;
}

export function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'purpose'>>): Project | null {
  const projects = loadIndex();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  projects[idx] = { ...projects[idx], ...patch };
  saveIndex(projects);
  return projects[idx];
}

export function deleteProject(id: string, removeFiles: boolean): boolean {
  const projects = loadIndex();
  const project = projects.find((p) => p.id === id);
  if (!project) return false;
  const remaining = projects.filter((p) => p.id !== id);
  saveIndex(remaining);
  if (removeFiles) {
    fs.rmSync(project.dir, { recursive: true, force: true });
  }
  appendLog({ message: `プロジェクト「${project.name}」を削除しました` });
  return true;
}

export async function openProjectFolder(id: string): Promise<{ ok: boolean; error?: string }> {
  const project = loadIndex().find((p) => p.id === id);
  if (!project) return { ok: false, error: 'プロジェクトが見つかりません' };
  // shell.openPath resolves to an empty string on success, or an error
  // description on failure (e.g. the folder was moved/deleted outside the app)
  // — it never rejects, so this must be checked explicitly.
  const error = await shell.openPath(project.dir);
  return error ? { ok: false, error } : { ok: true };
}

export function getProject(id: string): Project | null {
  return loadIndex().find((p) => p.id === id) ?? null;
}
