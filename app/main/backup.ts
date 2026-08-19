import path from 'node:path';
import fs from 'node:fs';
import AdmZip from 'adm-zip';
import { dialog, BrowserWindow } from 'electron';
import { dataDir } from './paths';

export async function createBackup(win: BrowserWindow): Promise<{ ok: boolean; path?: string }> {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'バックアップを作成',
    defaultPath: `ai-orchestrator-backup-${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  if (canceled || !filePath) return { ok: false };

  const zip = new AdmZip();
  zip.addLocalFolder(dataDir);
  zip.writeZip(filePath);
  return { ok: true, path: filePath };
}

export async function restoreBackup(win: BrowserWindow): Promise<{ ok: boolean }> {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'バックアップから復元',
    properties: ['openFile'],
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  if (canceled || filePaths.length === 0) return { ok: false };

  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['キャンセル', '復元する'],
    defaultId: 0,
    cancelId: 0,
    title: '復元の確認',
    message: '現在のデータを選択したバックアップで上書きします。よろしいですか？',
  });
  if (response !== 1) return { ok: false };

  const zip = new AdmZip(filePaths[0]);
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  zip.extractAllTo(dataDir, true);
  return { ok: true };
}
