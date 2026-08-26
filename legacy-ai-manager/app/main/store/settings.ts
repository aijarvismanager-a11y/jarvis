import path from 'node:path';
import fs from 'node:fs';
import { bundledConfigDir, userConfigDir, defaultProjectsDir } from '../paths';
import { readJsonWithDefaults, writeJson, fileExists } from './jsonStore';

export interface Settings {
  openLastProjectOnStartup: boolean;
  showAIListOnStartup: boolean;
  notificationsEnabled: boolean;
  appearance: 'light' | 'dark' | 'system';
  projectsDir: string;
  firstRunCompleted: boolean;
  lastOpenProjectId?: string;
}

const defaultsPath = path.join(bundledConfigDir, 'settings.default.json');
const settingsPath = path.join(userConfigDir, 'settings.json');

function defaults(): Settings {
  const bundled = fileExists(defaultsPath)
    ? JSON.parse(fs.readFileSync(defaultsPath, 'utf-8'))
    : {};
  return {
    openLastProjectOnStartup: true,
    showAIListOnStartup: true,
    notificationsEnabled: true,
    appearance: 'system',
    projectsDir: defaultProjectsDir(),
    firstRunCompleted: false,
    ...bundled,
  };
}

export function loadSettings(): Settings {
  const s = readJsonWithDefaults<Settings>(settingsPath, defaults());
  if (!s.projectsDir) s.projectsDir = defaultProjectsDir();
  return s;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const current = loadSettings();
  const next = { ...current, ...patch };
  writeJson(settingsPath, next);
  return next;
}
