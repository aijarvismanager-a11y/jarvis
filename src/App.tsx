import { useCallback, useEffect, useMemo, useState } from "react";
import type { Workflow, WorkflowStep } from "./types/workflow";
import { connectFsWatch, fetchArtifactContent, fetchArtifactList, fetchWorkflow, saveWorkflow, type ArtifactFile } from "./lib/api";
import { WorkflowPane } from "./components/WorkflowPane";
import { PromptPane } from "./components/PromptPane";
import { ArtifactsPane } from "./components/ArtifactsPane";
import { AddStepModal } from "./components/AddStepModal";
import { EditTemplateModal } from "./components/EditTemplateModal";

function stripWorkspacePrefix(p: string) {
  return p.replace(/^workspace\//, "");
}

export default function App() {
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loadingPrompt, setLoadingPrompt] = useState(false);

  const [artifacts, setArtifacts] = useState<ArtifactFile[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [loadingArtifact, setLoadingArtifact] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [showAddStep, setShowAddStep] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(false);

  const loadWorkflow = useCallback(async () => {
    try {
      const wf = await fetchWorkflow();
      setWorkflow(wf);
      setSelectedStepId((prev) => prev ?? wf.steps.find((s) => s.status === "active")?.id ?? wf.steps[0]?.id ?? null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadArtifacts = useCallback(async () => {
    try {
      const files = await fetchArtifactList();
      setArtifacts(files);
      setSelectedArtifact((prev) => prev ?? files[0]?.path ?? null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    loadWorkflow();
    loadArtifacts();
    const disconnect = connectFsWatch(() => {
      loadWorkflow();
      loadArtifacts();
    });
    return disconnect;
  }, [loadWorkflow, loadArtifacts]);

  const selectedStep = useMemo(
    () => workflow?.steps.find((s) => s.id === selectedStepId) ?? null,
    [workflow, selectedStepId],
  );

  // build the prompt for the currently selected step: for steps with a
  // command_template (Claude Code) the CLI reads files itself, so we only
  // show the template + command. For web-AI steps we inline the referenced
  // file contents so the user can paste one block into the browser.
  useEffect(() => {
    if (!selectedStep) return;
    if (selectedStep.command_template || selectedStep.input_files.length === 0) {
      setPrompt(selectedStep.prompt_template);
      return;
    }
    let cancelled = false;
    setLoadingPrompt(true);
    Promise.all(
      selectedStep.input_files.map(async (f) => {
        const rel = stripWorkspacePrefix(f);
        try {
          const content = await fetchArtifactContent(rel);
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
  }, [selectedStep]);

  useEffect(() => {
    if (!selectedArtifact) return;
    let cancelled = false;
    setLoadingArtifact(true);
    fetchArtifactContent(selectedArtifact)
      .then((c) => !cancelled && setArtifactContent(c))
      .catch(() => !cancelled && setArtifactContent("(読み込みに失敗しました)"))
      .finally(() => !cancelled && setLoadingArtifact(false));
    return () => {
      cancelled = true;
    };
  }, [selectedArtifact]);

  function handleMoveStep(index: number, dir: -1 | 1) {
    if (!workflow) return;
    const steps = workflow.steps.map((s) => ({ ...s }));
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target], steps[index]];
    steps.forEach((s, i) => {
      s.index = i + 1;
    });
    const next = { ...workflow, steps };
    setWorkflow(next);
    saveWorkflow(next).catch((e) => setError(String(e)));
  }

  function handleAdvance() {
    if (!workflow || !selectedStep) return;
    const idx = workflow.steps.findIndex((s) => s.id === selectedStep.id);
    if (idx === -1) return;
    const steps = workflow.steps.map((s, i) => {
      if (i === idx) return { ...s, status: "done" as const };
      if (i === idx + 1) return { ...s, status: "active" as const };
      return s;
    });
    const next = { ...workflow, steps };
    setWorkflow(next);
    saveWorkflow(next).catch((e) => setError(String(e)));
    if (steps[idx + 1]) setSelectedStepId(steps[idx + 1].id);
  }

  function handleAddStep(step: WorkflowStep) {
    if (!workflow) return;
    const next = { ...workflow, steps: [...workflow.steps, step] };
    setWorkflow(next);
    saveWorkflow(next).catch((e) => setError(String(e)));
    setShowAddStep(false);
    setSelectedStepId(step.id);
  }

  function handleDeleteStep(id: string) {
    if (!workflow) return;
    if (!window.confirm("このステップを削除しますか？")) return;
    const steps = workflow.steps.filter((s) => s.id !== id).map((s, i) => ({ ...s, index: i + 1 }));
    const next = { ...workflow, steps };
    setWorkflow(next);
    saveWorkflow(next).catch((e) => setError(String(e)));
    if (selectedStepId === id) setSelectedStepId(steps[0]?.id ?? null);
  }

  function handleSaveTemplate(promptTemplate: string, commandTemplate: string | null) {
    if (!workflow || !selectedStep) return;
    const steps = workflow.steps.map((s) =>
      s.id === selectedStep.id ? { ...s, prompt_template: promptTemplate, command_template: commandTemplate } : s,
    );
    const next = { ...workflow, steps };
    setWorkflow(next);
    saveWorkflow(next).catch((e) => setError(String(e)));
    setEditingTemplate(false);
  }

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
        <div className="flex items-center gap-2 text-muted text-[13px]">
          <span>プロジェクト:</span>
          <span className="text-ink font-semibold">{workflow?.current_project ?? "..."}</span>
        </div>
        <div />
      </div>

      {error && (
        <div className="px-5 py-2 bg-red-50 text-red-700 text-[12.5px] border-b border-red-200">{error}</div>
      )}

      <div className="flex flex-1 min-h-0">
        {workflow ? (
          <>
            <WorkflowPane
              steps={workflow.steps}
              selectedStepId={selectedStepId}
              onSelect={setSelectedStepId}
              onMove={handleMoveStep}
              onAdd={() => setShowAddStep(true)}
              onDelete={handleDeleteStep}
            />
            {selectedStep && (
              <PromptPane
                step={selectedStep}
                prompt={prompt}
                loadingPrompt={loadingPrompt}
                onAdvance={handleAdvance}
                onEditTemplate={() => setEditingTemplate(true)}
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

      {showAddStep && workflow && (
        <AddStepModal
          nextIndex={workflow.steps.length + 1}
          onCancel={() => setShowAddStep(false)}
          onCreate={handleAddStep}
        />
      )}

      {editingTemplate && selectedStep && (
        <EditTemplateModal step={selectedStep} onCancel={() => setEditingTemplate(false)} onSave={handleSaveTemplate} />
      )}
    </div>
  );
}
