import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from '../paths';
import { readJson, writeJson } from './jsonStore';

export interface Prompt {
  id: string;
  title: string;
  category: string;
  body: string;
  createdAt: string;
}

const promptsPath = path.join(dataDir, 'prompts.json');

export function listPrompts(): Prompt[] {
  return readJson<Prompt[]>(promptsPath, []);
}

export function createPrompt(input: Omit<Prompt, 'id' | 'createdAt'>): Prompt {
  const prompts = listPrompts();
  const prompt: Prompt = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...input };
  prompts.unshift(prompt);
  writeJson(promptsPath, prompts);
  return prompt;
}

export function updatePrompt(id: string, patch: Partial<Prompt>): Prompt | null {
  const prompts = listPrompts();
  const idx = prompts.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  prompts[idx] = { ...prompts[idx], ...patch };
  writeJson(promptsPath, prompts);
  return prompts[idx];
}

export function deletePrompt(id: string): boolean {
  const prompts = listPrompts().filter((p) => p.id !== id);
  writeJson(promptsPath, prompts);
  return true;
}
