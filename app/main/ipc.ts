import { ipcMain, shell, dialog, BrowserWindow } from 'electron';
import * as settingsStore from './store/settings';
import * as servicesStore from './store/services';
import * as projectsStore from './store/projects';
import * as tasksStore from './store/tasks';
import * as handoffsStore from './store/handoffs';
import * as promptsStore from './store/prompts';
import * as logsStore from './store/logs';
import { createBackup, restoreBackup } from './backup';
import { watchProject } from './watcher';

export function registerIpcHandlers(win: BrowserWindow): void {
  ipcMain.handle('ai:open', (_e, url: string, aiName: string) => {
    shell.openExternal(url);
    logsStore.appendLog({ ai: aiName, message: `${aiName} を開きました` });
    return true;
  });

  ipcMain.handle('settings:load', () => settingsStore.loadSettings());
  ipcMain.handle('settings:save', (_e, patch) => settingsStore.saveSettings(patch));
  ipcMain.handle('settings:chooseProjectsDir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });

  ipcMain.handle('services:list', () => servicesStore.loadServices());
  ipcMain.handle('services:save', (_e, services) => servicesStore.saveServices(services));
  ipcMain.handle('categories:list', () => servicesStore.loadCategories());

  ipcMain.handle('projects:list', () => projectsStore.listProjects());
  ipcMain.handle('projects:create', (_e, input) => projectsStore.createProject(input));
  ipcMain.handle('projects:update', (_e, id, patch) => projectsStore.updateProject(id, patch));
  ipcMain.handle('projects:delete', (_e, id, removeFiles) => projectsStore.deleteProject(id, removeFiles));
  ipcMain.handle('projects:openFolder', (_e, id) => projectsStore.openProjectFolder(id));
  ipcMain.handle('projects:watch', (_e, id) => {
    const project = id ? projectsStore.getProject(id) : null;
    watchProject(win, project?.dir ?? null);
    return true;
  });

  ipcMain.handle('tasks:list', (_e, projectId) => tasksStore.listTasks(projectId));
  ipcMain.handle('tasks:create', (_e, projectId, input) => tasksStore.createTask(projectId, input));
  ipcMain.handle('tasks:update', (_e, projectId, taskId, patch) => tasksStore.updateTask(projectId, taskId, patch));
  ipcMain.handle('tasks:delete', (_e, projectId, taskId) => tasksStore.deleteTask(projectId, taskId));

  ipcMain.handle('handoffs:list', (_e, projectId) => handoffsStore.listHandoffs(projectId));
  ipcMain.handle('handoffs:create', (_e, projectId, input) => handoffsStore.createHandoff(projectId, input));

  ipcMain.handle('prompts:list', () => promptsStore.listPrompts());
  ipcMain.handle('prompts:create', (_e, input) => promptsStore.createPrompt(input));
  ipcMain.handle('prompts:update', (_e, id, patch) => promptsStore.updatePrompt(id, patch));
  ipcMain.handle('prompts:delete', (_e, id) => promptsStore.deletePrompt(id));

  ipcMain.handle('logs:list', (_e, limit) => logsStore.readLogs(limit));

  ipcMain.handle('backup:create', () => createBackup(win));
  ipcMain.handle('backup:restore', () => restoreBackup(win));

  ipcMain.handle('shell:openPath', (_e, targetPath: string) => shell.openPath(targetPath));
}
