import path from 'node:path';
import fs from 'node:fs';
import { dataDir } from '../paths';

export interface LogEntry {
  timestamp: string;
  ai?: string;
  message: string;
}

const logsPath = path.join(dataDir, 'logs.jsonl');
const MAX_LINES = 2000;

export function appendLog(entry: Omit<LogEntry, 'timestamp'>): LogEntry {
  const full: LogEntry = { timestamp: new Date().toISOString(), ...entry };
  fs.appendFileSync(logsPath, JSON.stringify(full) + '\n', 'utf-8');
  return full;
}

export function readLogs(limit = 200): LogEntry[] {
  if (!fs.existsSync(logsPath)) return [];
  const lines = fs.readFileSync(logsPath, 'utf-8').split('\n').filter(Boolean);
  const trimmed = lines.slice(-MAX_LINES);
  if (trimmed.length !== lines.length) {
    fs.writeFileSync(logsPath, trimmed.join('\n') + '\n', 'utf-8');
  }
  return trimmed.slice(-limit).map((l) => JSON.parse(l) as LogEntry).reverse();
}
