import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AIService, Category, Project, Settings } from './types';

interface AppState {
  settings: Settings | null;
  services: AIService[];
  categories: Category[];
  projects: Project[];
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  refreshSettings: () => Promise<void>;
  refreshServices: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  loading: boolean;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [services, setServices] = useState<AIService[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSettings = useCallback(async () => {
    setSettings(await window.api.settings.load());
  }, []);
  const refreshServices = useCallback(async () => {
    setServices(await window.api.services.list());
  }, []);
  const refreshProjects = useCallback(async () => {
    setProjects(await window.api.projects.list());
  }, []);

  useEffect(() => {
    (async () => {
      const [s, svc, cats, projs] = await Promise.all([
        window.api.settings.load(),
        window.api.services.list(),
        window.api.categories.list(),
        window.api.projects.list(),
      ]);
      setSettings(s);
      setServices(svc);
      setCategories(cats);
      setProjects(projs);
      if (s.lastOpenProjectId && s.openLastProjectOnStartup) {
        setActiveProjectId(s.lastOpenProjectId);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    window.api.projects.watch(activeProjectId);
    if (activeProjectId) {
      window.api.settings.save({ lastOpenProjectId: activeProjectId });
    }
  }, [activeProjectId]);

  return (
    <AppContext.Provider
      value={{
        settings,
        services,
        categories,
        projects,
        activeProjectId,
        setActiveProjectId,
        refreshSettings,
        refreshServices,
        refreshProjects,
        loading,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppState(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}
