import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project, WorkflowFile, WorkflowStep } from "./types/workflow";
import type { AiServiceList } from "./types/aiService";
import {
  connectFsWatch,
  fetchAiServices,
  fetchArtifactContent,
  fetchArtifactList,
  fetchWorkflow,
  saveAiServices,
  saveWorkflow,
  type ArtifactFile,
} from "./lib/api";
import { stripProjectPrefix } from "./lib/paths";
import { WorkflowPane } from "./components/WorkflowPane";
import { PromptPane } from "./components/PromptPane";
import { ArtifactsPane } from "./components/ArtifactsPane";
import { ProjectTabs } from "./components/ProjectTabs";
import { NewProjectModal } from "./components/NewProjectModal";
import { AddStepModal } from "./components/AddStepModal";
import { SettingsModal } from "./components/SettingsModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { WelcomeBanner } from "./components/WelcomeBanner";
import { IdeaIntakeModal } from "./components/IdeaIntakeModal";
import { buildClaudeCommand } from "./lib/claudeCommand";

export default function App() {
  const [workflowFile, setWorkflowFile] = useState<WorkflowFile | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loadingPrompt, setLoadingPrompt] = useState(false);

  const [artifacts, setArtifacts] = useState<ArtifactFile[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [loadingArtifact, setLoadingArtifact] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [showIdeaIntake, setShowIdeaIntake] = useState(false);
  const [showAddStep, setShowAddStep] = useState(false);
  const [addStepSeed, setAddStepSeed] = useState<{ role: string; aiName: string; promptTemplate: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [aiServices, setAiServices] = useState<AiServiceList>([]);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null);

  const loadWorkflow = useCallback(async () => {
    try {
      const wf = await fetchWorkflow();
      setWorkflowFile(wf);
      setCurrentProjectId((prev) => {
        if (prev && wf.projects.some((p) => p.id === prev)) return prev;
        return wf.projects.some((p) => p.id === wf.current_project_id)
          ? wf.current_project_id
          : (wf.projects[0]?.id ?? null);
      });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadArtifacts = useCallback(async (projectId: string) => {
    try {
      const files = await fetchArtifactList(projectId);
      setArtifacts(files);
      setSelectedArtifact((prev) => (prev && files.some((f) => f.path === prev) ? prev : (files[0]?.path ?? null)));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadAiServices = useCallback(async () => {
    try {
      setAiServices(await fetchAiServices());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    loadWorkflow();
    loadAiServices();
    const disconnect = connectFsWatch(() => {
      loadWorkflow();
      loadAiServices();
      setCurrentProjectId((id) => {
        if (id) loadArtifacts(id);
        return id;
      });
    });
    return disconnect;
  }, [loadWorkflow, loadAiServices, loadArtifacts]);

  // switching projects resets the step/artifact selection and reloads that
  // project's own artifact list (each project has its own workspace/<id>/)
  useEffect(() => {
    if (!currentProjectId) return;
    setSelectedStepId(null);
    setSelectedArtifact(null);
    setArtifactContent(null);
    loadArtifacts(currentProjectId);
  }, [currentProjectId, loadArtifacts]);

  const currentProject = useMemo(
    () => workflowFile?.projects.find((p) => p.id === currentProjectId) ?? null,
    [workflowFile, currentProjectId],
  );

  useEffect(() => {
    if (!currentProject) return;
    setSelectedStepId((prev) => {
      if (prev && currentProject.steps.some((s) => s.id === prev)) return prev;
      return currentProject.steps.find((s) => s.status === "active")?.id ?? currentProject.steps[0]?.id ?? null;
    });
  }, [currentProject]);

  const selectedStep = useMemo(
    () => currentProject?.steps.find((s) => s.id === selectedStepId) ?? null,
    [currentProject, selectedStepId],
  );

  const command = useMemo(
    () => (selectedStep && currentProjectId ? buildClaudeCommand(selectedStep, currentProjectId) : null),
    [selectedStep, currentProjectId],
  );

  const hasNextStep = useMemo(() => {
    if (!currentProject || !selectedStep) return true;
    const idx = currentProject.steps.findIndex((s) => s.id === selectedStep.id);
    return idx !== -1 && idx + 1 < currentProject.steps.length;
  }, [currentProject, selectedStep]);

  // build the prompt for the currently selected step: for steps with a
  // command_template (Claude Code) the CLI reads files itself, so we only
  // show the template + command. For web-AI steps we inline the referenced
  // file contents so the user can paste one block into the browser.
  useEffect(() => {
    if (!selectedStep || !currentProjectId) return;
    if (command || selectedStep.input_files.length === 0) {
      setPrompt(selectedStep.prompt_template);
      return;
    }
    let cancelled = false;
    setLoadingPrompt(true);
    Promise.all(
      selectedStep.input_files.map(async (f) => {
        const rel = stripProjectPrefix(f, currentProjectId);
        try {
          const content = await fetchArtifactContent(currentProjectId, rel);
          return `\n\n---\n### ${rel}\n${content}`;
        } catch {
          return `\n\n---\n### ${rel}\n(ファイルが見つかりません)`;
        }
      }),
    ).then((chunks) => {
      if (cancelled) return;
      setPrompt(selectedStep.prompt_template + chunks.join(""));
      setLoadingPrompt(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedStep, command, currentProjectId]);

  useEffect(() => {
    if (!selectedArtifact || !currentProjectId) return;
    let cancelled = false;
    setLoadingArtifact(true);
    fetchArtifactContent(currentProjectId, selectedArtifact)
      .then((c) => !cancelled && setArtifactContent(c))
      .catch(() => !cancelled && setArtifactContent("(読み込みに失敗しました)"))
      .finally(() => !cancelled && setLoadingArtifact(false));
    return () => {
      cancelled = true;
    };
  }, [selectedArtifact, currentProjectId]);

  function updateCurrentProject(updater: (project: Project) => Project) {
    if (!workflowFile || !currentProjectId) return;
    const projects = workflowFile.projects.map((p) => (p.id === currentProjectId ? updater(p) : p));
    const next = { ...workflowFile, projects };
    setWorkflowFile(next);
    saveWorkflow(next).catch((e) => setError(String(e)));
  }

  function handleMoveStep(index: number, dir: -1 | 1) {
    updateCurrentProject((project) => {
      const steps = project.steps.map((s) => ({ ...s }));
      const target = index + dir;
      if (target < 0 || target >= steps.length) return project;
      [steps[index], steps[target]] = [steps[target], steps[index]];
      steps.forEach((s, i) => {
        s.index = i + 1;
      });
      return { ...project, steps };
    });
  }

  function handleAdvance() {
    if (!selectedStep) return;
    let nextId: string | null = null;
    let hadNext = false;
    updateCurrentProject((project) => {
      const idx = project.steps.findIndex((s) => s.id === selectedStep.id);
      if (idx === -1) return project;
      hadNext = idx + 1 < project.steps.length;
      const steps = project.steps.map((s, i) => {
        if (i === idx) return { ...s, status: "done" as const };
        if (i === idx + 1) return { ...s, status: "active" as const };
        return s;
      });
      nextId = steps[idx + 1]?.id ?? null;
      return { ...project, steps };
    });
    if (nextId) {
      setSelectedStepId(nextId);
    } else if (!hadNext) {
      // Nothing to advance into yet — open step creation right away instead
      // of leaving the user looking at a newly-disabled button with no
      // indication of what to do next. This is the "continue an existing
      // pipeline" case (not first-time onboarding), so go straight to the
      // category picker rather than IdeaIntakeModal — that modal always
      // labels what it creates as "Ideator（アイデア出し）", which would be
      // a wrong role name for e.g. a design or review step added here.
      setShowAddStep(true);
    }
  }

  function handleAddStep(step: WorkflowStep) {
    updateCurrentProject((project) => ({ ...project, steps: [...project.steps, step] }));
    setShowIdeaIntake(false);
    setShowAddStep(false);
    setAddStepSeed(null);
    setSelectedStepId(step.id);
  }

  function handleConfirmDeleteStep() {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    updateCurrentProject((project) => ({
      ...project,
      steps: project.steps.filter((s) => s.id !== id).map((s, i) => ({ ...s, index: i + 1 })),
    }));
    if (selectedStepId === id) setSelectedStepId(null);
    setPendingDeleteId(null);
  }

  function handleSaveTemplate(promptTemplate: string, commandTemplate: string | null) {
    if (!selectedStep) return;
    updateCurrentProject((project) => ({
      ...project,
      steps: project.steps.map((s) =>
        s.id === selectedStep.id ? { ...s, prompt_template: promptTemplate, command_template: commandTemplate } : s,
      ),
    }));
  }

  function handleSaveMeta(role: string, aiName: string) {
    if (!selectedStep) return;
    updateCurrentProject((project) => ({
      ...project,
      steps: project.steps.map((s) => (s.id === selectedStep.id ? { ...s, role, ai_name: aiName } : s)),
    }));
  }

  function handleSaveServices(services: AiServiceList) {
    setAiServices(services);
    saveAiServices(services).catch((e) => setError(String(e)));
    setShowSettings(false);
  }

  // Lets step-creation forms register (or update) an AI service's link
  // right where the step is created, instead of requiring a separate trip
  // to Settings first for the "開く" link to work.
  function handleUpsertAiService(name: string, url: string) {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) return;
    const exists = aiServices.some((s) => s.name === trimmedName);
    const next = exists
      ? aiServices.map((s) => (s.name === trimmedName ? { ...s, url: trimmedUrl } : s))
      : [...aiServices, { id: `svc_${Date.now()}`, name: trimmedName, url: trimmedUrl }];
    setAiServices(next);
    saveAiServices(next).catch((e) => setError(String(e)));
  }

  function handleSelectProject(id: string) {
    if (!workflowFile || id === currentProjectId) return;
    setCurrentProjectId(id);
    const next = { ...workflowFile, current_project_id: id };
    setWorkflowFile(next);
    saveWorkflow(next).catch((e) => setError(String(e)));
  }

  function handleCreateProject(name: string) {
    if (!workflowFile) return;
    const id = `project_${Date.now()}`;
    const project: Project = { id, name, steps: [] };
    const next = { ...workflowFile, projects: [...workflowFile.projects, project], current_project_id: id };
    setWorkflowFile(next);
    saveWorkflow(next).catch((e) => setError(String(e)));
    setCurrentProjectId(id);
    setShowNewProject(false);
  }

  function handleConfirmDeleteProject() {
    if (!workflowFile || !pendingDeleteProjectId) return;
    const id = pendingDeleteProjectId;
    const projects = workflowFile.projects.filter((p) => p.id !== id);
    const nextCurrent = currentProjectId === id ? (projects[0]?.id ?? "") : workflowFile.current_project_id;
    const next = { ...workflowFile, projects, current_project_id: nextCurrent };
    setWorkflowFile(next);
    saveWorkflow(next).catch((e) => setError(String(e)));
    if (currentProjectId === id) setCurrentProjectId(projects[0]?.id ?? null);
    setPendingDeleteProjectId(null);
  }

  const serviceUrl = useMemo(() => {
    if (!selectedStep) return null;
    return aiServices.find((s) => s.name === selectedStep.ai_name)?.url ?? null;
  }, [aiServices, selectedStep]);

  return (
    <div className="flex flex-col w-screen h-screen bg-bg overflow-hidden">
      <div className="flex items-center justify-between h-14 shrink-0 px-5 border-b border-border bg-panel">
        <div className="flex items-center gap-2.5">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#B5563A" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M12 2.5v3.2M12 18.3v3.2M21.5 12h-3.2M5.7 12H2.5M18.3 5.7l-2.3 2.3M8 13.7l-2.3 2.3M18.3 18.3l-2.3-2.3M8 10.3L5.7 8" />
          </svg>
          <span className="font-serif text-[17px] font-semibold tracking-tight">AI Orchestrator</span>
        </div>
        <button onClick={() => setShowSettings(true)} className="p-1.5 opacity-70 hover:opacity-100" title="設定">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8A8578" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 px-5 py-2 bg-red-50 text-red-700 text-[12.5px] border-b border-red-200">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 font-semibold">
            閉じる
          </button>
        </div>
      )}

      <WelcomeBanner />

      {workflowFile && currentProjectId && (
        <ProjectTabs
          projects={workflowFile.projects}
          currentId={currentProjectId}
          onSelect={handleSelectProject}
          onAdd={() => setShowNewProject(true)}
          onDelete={setPendingDeleteProjectId}
        />
      )}

      <div className="flex flex-1 min-h-0">
        {currentProject ? (
          <>
            <WorkflowPane
              steps={currentProject.steps}
              selectedStepId={selectedStepId}
              onSelect={setSelectedStepId}
              onMove={handleMoveStep}
              onAdd={() => setShowIdeaIntake(true)}
              onDelete={setPendingDeleteId}
            />
            {selectedStep && currentProjectId && (
              <PromptPane
                projectId={currentProjectId}
                step={selectedStep}
                prompt={prompt}
                loadingPrompt={loadingPrompt}
                command={command}
                serviceUrl={serviceUrl}
                hasNextStep={hasNextStep}
                onAdvance={handleAdvance}
                onSaveTemplate={handleSaveTemplate}
                onSaveMeta={handleSaveMeta}
                onOpenArtifact={setSelectedArtifact}
                onAddNextStep={() => setShowAddStep(true)}
              />
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted text-sm">読み込み中...</div>
        )}
        <ArtifactsPane
          files={artifacts}
          selectedPath={selectedArtifact}
          content={artifactContent}
          loading={loadingArtifact}
          onSelect={setSelectedArtifact}
        />
      </div>

      {showIdeaIntake && currentProject && currentProjectId && (
        <IdeaIntakeModal
          projectId={currentProjectId}
          nextIndex={currentProject.steps.length + 1}
          onCancel={() => setShowIdeaIntake(false)}
          onCreate={handleAddStep}
          onEditManually={(seed) => {
            setShowIdeaIntake(false);
            setAddStepSeed(seed);
            setShowAddStep(true);
          }}
        />
      )}

      {showAddStep && currentProject && currentProjectId && (
        <AddStepModal
          projectId={currentProjectId}
          nextIndex={currentProject.steps.length + 1}
          initial={addStepSeed ?? undefined}
          onCancel={() => {
            setShowAddStep(false);
            setAddStepSeed(null);
          }}
          onCreate={handleAddStep}
          onUpsertService={handleUpsertAiService}
        />
      )}

      {showSettings && (
        <SettingsModal services={aiServices} onCancel={() => setShowSettings(false)} onSave={handleSaveServices} />
      )}

      {showNewProject && <NewProjectModal onCancel={() => setShowNewProject(false)} onCreate={handleCreateProject} />}

      {pendingDeleteId && currentProject && (
        <ConfirmModal
          title="ステップを削除"
          message={
            <>
              「{currentProject.steps.find((s) => s.id === pendingDeleteId)?.role ?? ""}」を削除します。この操作は元に戻せません。よろしいですか？
            </>
          }
          confirmLabel="削除する"
          danger
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={handleConfirmDeleteStep}
        />
      )}

      {pendingDeleteProjectId && workflowFile && (
        <ConfirmModal
          title="プロジェクトを削除"
          message={
            <>
              「{workflowFile.projects.find((p) => p.id === pendingDeleteProjectId)?.name ?? ""}」をワークフロー一覧から削除します。
              <br />
              <span className="text-muted text-[12.5px]">
                ※ workspace/ 内の実ファイルは削除されません。ワークフローの一覧から外れるだけです。
              </span>
            </>
          }
          confirmLabel="削除する"
          danger
          onCancel={() => setPendingDeleteProjectId(null)}
          onConfirm={handleConfirmDeleteProject}
        />
      )}
    </div>
  );
}
