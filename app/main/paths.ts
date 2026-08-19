import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// Whether to load the Vite dev server vs. the built renderer bundle.
export const isDev = process.env.NODE_ENV === 'development';

// Whether this is a real electron-builder package. Distinct from `isDev`:
// running `electron .` directly against a production build (NODE_ENV=production,
// no dev server) is still unpackaged, so process.resourcesPath would point
// into Electron's own distribution folder rather than this project.
const packaged = app.isPackaged;

// Unpackaged (dev, or an ad-hoc `electron .` run) keeps data next to the repo
// (./data, ./config) so it's easy to inspect. A packaged build uses Electron's
// per-user app-data directory.
export const dataDir = packaged
  ? app.getPath('userData')
  : path.join(process.cwd(), 'data');

export const bundledConfigDir = packaged
  ? path.join(process.resourcesPath, 'config')
  : path.join(process.cwd(), 'config');

// User-writable copy of config (ai_services.json etc.) — the bundled copy under
// resources/ is read-only once packaged, so edits from the Settings screen go here.
export const userConfigDir = path.join(dataDir, 'config');

export function defaultProjectsDir(): string {
  return path.join(app.getPath('documents'), 'AI-Orchestrator', 'projects');
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

ensureDir(dataDir);
ensureDir(userConfigDir);
