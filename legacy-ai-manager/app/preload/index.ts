import { contextBridge, ipcRenderer } from 'electron';

const api = {
  ai: {
    open: (url: string, aiName: string) => ipcRenderer.invoke('ai:open', url, aiName),
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (patch: unknown) => ipcRenderer.invoke('settings:save', patch),
    chooseProjectsDir: () => ipcRenderer.invoke('settings:chooseProjectsDir'),
  },
  services: {
    list: () => ipcRenderer.invoke('services:list'),
    save: (services: unknown) => ipcRenderer.invoke('services:save', services),
  },
  categories: {
    list: () => ipcRenderer.invoke('categories:list'),
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (input: unknown) => ipcRenderer.invoke('projects:create', input),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('projects:update', id, patch),
    delete: (id: string, removeFiles: boolean) => ipcRenderer.invoke('projects:delete', id, removeFiles),
    openFolder: (id: string) => ipcRenderer.invoke('projects:openFolder', id),
    watch: (id: string | null) => ipcRenderer.invoke('projects:watch', id),
    export: (id: string) => ipcRenderer.invoke('projects:export', id),
  },
  tasks: {
    list: (projectId: string) => ipcRenderer.invoke('tasks:list', projectId),
    create: (projectId: string, input: unknown) => ipcRenderer.invoke('tasks:create', projectId, input),
    update: (projectId: string, taskId: string, patch: unknown) => ipcRenderer.invoke('tasks:update', projectId, taskId, patch),
    delete: (projectId: string, taskId: string) => ipcRenderer.invoke('tasks:delete', projectId, taskId),
  },
  handoffs: {
    list: (projectId: string) => ipcRenderer.invoke('handoffs:list', projectId),
    create: (projectId: string, input: unknown) => ipcRenderer.invoke('handoffs:create', projectId, input),
  },
  prompts: {
    list: () => ipcRenderer.invoke('prompts:list'),
    create: (input: unknown) => ipcRenderer.invoke('prompts:create', input),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('prompts:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('prompts:delete', id),
  },
  logs: {
    list: (limit?: number) => ipcRenderer.invoke('logs:list', limit),
  },
  backup: {
    create: () => ipcRenderer.invoke('backup:create'),
    restore: () => ipcRenderer.invoke('backup:restore'),
  },
  shell: {
    openPath: (targetPath: string) => ipcRenderer.invoke('shell:openPath', targetPath),
  },
  onFilesChanged: (callback: (payload: { event: string; path: string }) => void) => {
    const listener = (_e: unknown, payload: { event: string; path: string }) => callback(payload);
    ipcRenderer.on('files:changed', listener);
    return () => ipcRenderer.removeListener('files:changed', listener);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
