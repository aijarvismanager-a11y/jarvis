import path from 'node:path';
import fs from 'node:fs';
import { bundledConfigDir, userConfigDir } from '../paths';
import { readJson, writeJson, fileExists } from './jsonStore';

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

const servicesPath = path.join(userConfigDir, 'ai_services.json');
const categoriesPath = path.join(userConfigDir, 'categories.json');
const bundledServicesPath = path.join(bundledConfigDir, 'ai_services.json');
const bundledCategoriesPath = path.join(bundledConfigDir, 'categories.json');

function seedIfMissing(bundled: string, target: string): void {
  if (!fileExists(target) && fileExists(bundled)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(bundled, target);
  }
}

export function loadServices(): AIService[] {
  seedIfMissing(bundledServicesPath, servicesPath);
  return readJson<AIService[]>(servicesPath, []);
}

export function saveServices(services: AIService[]): AIService[] {
  writeJson(servicesPath, services);
  return services;
}

export function loadCategories(): Category[] {
  seedIfMissing(bundledCategoriesPath, categoriesPath);
  return readJson<Category[]>(categoriesPath, []);
}
