import { useEffect, useState } from "react";
import type { StepAttempt, WorkflowStep } from "../types/workflow";
import type { AiServiceList } from "../types/aiService";
import {
  executeCommand,
  fetchArtifactContent,
  fetchExecutionHistory,
  saveArtifactContent,
  type ExecuteResult,
  type HistoryEntry,
} from "../lib/api";
import { stripProjectPrefix } from "../lib/paths";
import { ConfirmModal } from "./ConfirmModal";

const STATUS_META: Record<WorkflowStep["status"], { label: string; color: string; bg: string }> = {
  done: { label: "完了", color: "#3F6B52", bg: "color-mix(in oklch, #3F6B52 14%, white)" },
  active: { label: "進行中", color: "#B5563A", bg: "color-mix(in oklch, #B5563A 14%, white)" },
  pending: { label: "未着手", color: "#8A8578", bg: "#F1EFEA" },
};

// A fixed window name means every "開く" click reuses the same popup
// (browsers focus the existing one instead of spawning a new one) rather
// than piling up tabs, and always at the same size/position so it sits
// alongside the app instead of covering it. If the user closes it, the
// next click just opens a fresh one at the same spot.
const AI_WINDOW_NAME = "ai-orchestrator-ai-window";

function openAiWindow(url: string) {
  const width = Math.round(window.screen.availWidth / 2);
  const height = window.screen.availHeight;
  const left = window.screen.availWidth - width;
  window.open(url, AI_WINDOW_NAME, `width=${width},height=${height},left=${left},top=0`);
}

// A handful of general-purpose web AIs to round out the "try another AI"
// picker when the user's own ai_services.json doesn't have many entries.
const GENERAL_AI_POOL = ["ChatGPT (Web)", "Claude (Web)", "Gemini (Web)", "Perplexity (Web)"];

function slugifyAiName(name: string): string {
  const base = name.replace(/\(.*?\)/g, "").trim();
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "ai";
}

// Derives e.g. "workspace/p1/docs/requirements__gemini.md" from the step's
// own output file, so a second AI's answer lives right next to the step's
// real output on disk instead of needing its own separate naming scheme.
function attemptOutputPath(baseOutputFile: string, aiName: string): string {
  const dot = baseOutputFile.lastIndexOf(".");
  const stem = dot === -1 ? baseOutputFile : baseOutputFile.slice(0, dot);
  const ext = dot === -1 ? ".md" : baseOutputFile.slice(dot);
  return `${stem}__${slugifyAiName(aiName)}${ext}`;
}

type AttemptRowProps = {
  projectId: string;
  attempt: StepAttempt;
  aiUrl: string | null;
  onRemove: () => void;
  onAdopt: (content: string) => void;
};

// One "try this other AI too" row: same open→paste→save motion as the
// step's own main answer box, just scoped to its own file. Deliberately not
// a separate step and not a separate modal — it lives right where the user
// is already looking.
function AttemptRow({ projectId, attempt, aiUrl, onRemove, onAdopt }: AttemptRowProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchArtifactContent(projectId, stripProjectPrefix(attempt.output_file, projectId))
      .then((c) => !cancelled && setContent(c))
      .catch(() => !cancelled && setContent(null))
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, attempt.output_file]);

  async function handleSave() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await saveArtifactContent(projectId, stripProjectPrefix(attempt.output_file, projectId), draft);
      setContent(draft);
      setDraft("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-borderSoft p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-ink">{attempt.ai_name}</span>
        <div className="flex items-center gap-2.5">
          {aiUrl && (
            <button onClick={() => openAiWindow(aiUrl)} className="text-accent text-[11.5px] font-semibold hover:underline">
              開く ↗
            </button>
          )}
          <button onClick={onRemove} className="text-[11.5px] text-muted hover:text-ink underline">
            削除
          </button>
        </div>
      </div>

      {loaded && content && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-bg px-2.5 py-1.5">
          <span className="text-[11.5px] text-muted">保存済み（{content.length.toLocaleString()}文字）</span>
          <button
            onClick={() => onAdopt(content)}
            className="shrink-0 text-[11.5px] font-semibold text-accent hover:underline"
          >
            本命欄にコピー →
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          className="flex-1 border border-border rounded-md px-2.5 py-1.5 bg-white text-[12.5px] focus:outline-none focus:ring-2 focus:ring-accent/40"
          placeholder={content ? "上書きする場合はここに貼り付け" : "ここにAIの回答を貼り付け..."}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          onClick={handleSave}
          disabled={!draft.trim() || saving}
          className="shrink-0 px-3 py-1.5 rounded-md bg-accent text-white text-[12px] font-semibold disabled:opacity-50"
        >
          {saving ? "保存中..." : saved ? "保存しました" : "保存する"}
        </button>
      </div>
    </div>
  );
}

type Props = {
  projectId: string;
  step: WorkflowStep;
  prompt: string;
  loadingPrompt: boolean;
  command: string | null;
  serviceUrl: string | null;
  aiServices: AiServiceList;
  hasNextStep: boolean;
  onAdvance: () => void;
  onSaveTemplate: (promptTemplate: string, commandTemplate: string | null) => void;
  onSaveMeta: (role: string, aiName: string) => void;
  onOpenArtifact: (path: string) => void;
  onAddNextStep: () => void;
  onUpdateAttempts: (attempts: StepAttempt[]) => void;
};

export function PromptPane({
  projectId,
  step,
  prompt,
  loadingPrompt,
  command,
  serviceUrl,
  aiServices,
  hasNextStep,
  onAdvance,
  onSaveTemplate,
  onSaveMeta,
  onOpenArtifact,
  onAddNextStep,
  onUpdateAttempts,
}: Props) {
  const [showGuide, setShowGuide] = useState(true);
  const [copied, setCopied] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [showExecuteConfirm, setShowExecuteConfirm] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<ExecuteResult | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [promptDraft, setPromptDraft] = useState(step.prompt_template);
  const [editingCommand, setEditingCommand] = useState(false);
  const [commandDraft, setCommandDraft] = useState(command ?? "");
  const [roleDraft, setRoleDraft] = useState(step.role);
  const [aiNameDraft, setAiNameDraft] = useState(step.ai_name);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showAddAttempt, setShowAddAttempt] = useState(false);
  const [newAttemptAi, setNewAttemptAi] = useState("");
  // Whether this step's own (official) output file has anything saved in
  // it yet — null while still checking. Used to stop "成果物の回収を完了"
  // from being pressed before anything was actually saved, which used to
  // be silently possible and made "do I save first or just finish?" a real
  // question with no answer in the UI.
  const [mainOutputSaved, setMainOutputSaved] = useState<boolean | null>(null);
  const meta = STATUS_META[step.status];
  const attempts = step.attempts ?? [];

  useEffect(() => {
    let cancelled = false;
    fetchExecutionHistory(projectId)
      .then((entries) => !cancelled && setHistory(entries))
      .catch(() => !cancelled && setHistory([]));
    return () => {
      cancelled = true;
    };
  }, [projectId, step.id, execResult]);

  useEffect(() => {
    if (command || step.output_files.length === 0) {
      setMainOutputSaved(true); // Claude Code steps produce their output by running, not by this box.
      return;
    }
    let cancelled = false;
    setMainOutputSaved(null);
    fetchArtifactContent(projectId, stripProjectPrefix(step.output_files[0], projectId))
      .then((c) => !cancelled && setMainOutputSaved(c.trim().length > 0))
      .catch(() => !cancelled && setMainOutputSaved(false));
    return () => {
      cancelled = true;
    };
  }, [projectId, step.id, command, step.output_files]);

  const stepHistory = history.filter((h) => h.stepId === step.id).slice().reverse();
  const stepSuccessCount = stepHistory.filter((h) => !h.timedOut && h.exitCode === 0).length;

  useEffect(() => {
    setExecResult(null);
    setExecError(null);
    setShowGuide(true);
    setPasteText("");
    setSaveError(null);
    setSaved(false);
    setPromptDraft(step.prompt_template);
    setEditingCommand(false);
    setCommandDraft(command ?? "");
    setRoleDraft(step.role);
    setAiNameDraft(step.ai_name);
    setShowAddAttempt(false);
    setNewAttemptAi("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id]);

  const aiOptions = [...new Set([...aiServices.map((s) => s.name), ...GENERAL_AI_POOL])];
  const usedAiNames = new Set([step.ai_name, ...attempts.map((a) => a.ai_name)]);
  const attemptCandidates = aiOptions.filter((name) => !usedAiNames.has(name));

  function startAddAttempt() {
    setNewAttemptAi(attemptCandidates[0] ?? aiOptions[0] ?? "");
    setShowAddAttempt(true);
  }

  function confirmAddAttempt() {
    if (!newAttemptAi.trim() || step.output_files.length === 0) return;
    const outputFile = attemptOutputPath(step.output_files[0], newAttemptAi);
    onUpdateAttempts([...attempts, { ai_name: newAttemptAi.trim(), output_file: outputFile }]);
    setShowAddAttempt(false);
    setNewAttemptAi("");
  }

  function removeAttempt(index: number) {
    onUpdateAttempts(attempts.filter((_, i) => i !== index));
  }

  function commitRole() {
    const trimmed = roleDraft.trim();
    if (trimmed && trimmed !== step.role) onSaveMeta(trimmed, step.ai_name);
    else setRoleDraft(step.role);
  }

  function commitAiName() {
    const trimmed = aiNameDraft.trim();
    if (trimmed && trimmed !== step.ai_name) onSaveMeta(step.role, trimmed);
    else setAiNameDraft(step.ai_name);
  }

  const promptDirty = promptDraft.trim() !== step.prompt_template.trim() && promptDraft.trim().length > 0;

  async function handleSavePaste() {
    const outputFile = step.output_files[0];
    if (!outputFile || !pasteText.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveArtifactContent(projectId, stripProjectPrefix(outputFile, projectId), pasteText);
      setSaved(true);
      setMainOutputSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function fallbackCopy(text: string): boolean {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(el);
    return ok;
  }

  async function copyText(text: string, onDone: () => void) {
    setCopyError(null);
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else if (!fallbackCopy(text)) {
        throw new Error("fallback copy failed");
      }
      onDone();
      setTimeout(() => {
        setCopied(false);
        setCommandCopied(false);
      }, 1500);
    } catch {
      if (fallbackCopy(text)) {
        onDone();
        setTimeout(() => {
          setCopied(false);
          setCommandCopied(false);
        }, 1500);
        return;
      }
      setCopyError("クリップボードへのコピーに失敗しました。手動で選択してコピーしてください。");
    }
  }

  const handleCopy = () => copyText(prompt, () => setCopied(true));
  const handleCopyCommand = () => command && copyText(command, () => setCommandCopied(true));

  function handleSavePrompt() {
    onSaveTemplate(promptDraft.trim(), step.command_template ?? null);
  }

  function handleSaveCommand() {
    onSaveTemplate(step.prompt_template, commandDraft.trim() || null);
    setEditingCommand(false);
  }

  async function handleConfirmExecute() {
    if (!command) return;
    setShowExecuteConfirm(false);
    setExecuting(true);
    setExecError(null);
    setExecResult(null);
    try {
      setExecResult(await executeCommand(projectId, command, step.id, step.role));
    } catch (e) {
      setExecError(e instanceof Error ? e.message : String(e));
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-panel">
      <div className="px-7 pt-5 pb-3.5 border-b border-borderSoft">
        <div className="flex items-center gap-2.5">
          <input
            value={roleDraft}
            onChange={(e) => setRoleDraft(e.target.value)}
            onBlur={commitRole}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="font-serif text-xl font-semibold bg-transparent border-b border-transparent hover:border-border focus:border-accent outline-none px-0.5 -ml-0.5"
            style={{ width: `${Math.max(roleDraft.length, 4)}ch` }}
          />
          <span
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: meta.bg, color: meta.color }}
          >
            {meta.label}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[13px] text-muted">
          <span className="shrink-0">担当AI:</span>
          <input
            value={aiNameDraft}
            onChange={(e) => setAiNameDraft(e.target.value)}
            onBlur={commitAiName}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="bg-transparent border-b border-transparent hover:border-border focus:border-accent outline-none px-0.5 -ml-0.5 text-ink"
            style={{ width: `${Math.max(aiNameDraft.length, 4)}ch` }}
          />
          {serviceUrl && (
            <button
              onClick={() => openAiWindow(serviceUrl)}
              className="text-accent text-[12px] font-semibold hover:underline"
            >
              開く ↗
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-5 flex flex-col gap-4.5">
        {showGuide && (
          <div className="flex items-start gap-3 rounded-xl px-4 py-3 bg-accent-tint" style={{ background: "color-mix(in oklch, #B5563A 8%, white)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B5563A" strokeWidth="2" className="shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
            <div className="flex-1 text-[12.5px] leading-relaxed text-ink">
              <span className="font-semibold block">このステップの進め方</span>
              <span className="block text-muted mb-1.5">
                {command
                  ? "まだ何も実行されていません。以下の手順で進めてください。"
                  : "このアプリはAIと自動ではやり取りしません。まだAIには何も聞いていません — 以下の手順で、あなた自身がAIに聞きに行ってください。"}
              </span>
              <ol className="list-decimal pl-4 flex flex-col gap-0.5">
                {command ? (
                  <>
                    <li>下の実行コマンドの内容を確認する</li>
                    <li>
                      <b>「ローカルで実行」ボタン</b>を押す
                    </li>
                    <li>完了するまで待つ（実装タスクは数分かかることがあります）</li>
                    <li>
                      問題なければ、下の<b>「次のステップへ」ボタン</b>を押す
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      {serviceUrl ? (
                        <button
                          onClick={() => openAiWindow(serviceUrl)}
                          className="font-semibold text-accent underline"
                        >
                          {step.ai_name} を開く ↗
                        </button>
                      ) : (
                        "担当AIのサイトを開く"
                      )}
                    </li>
                    <li>
                      下のプロンプトを<b>「プロンプトをコピー」ボタン</b>でコピーし、開いたAIに貼り付けて実行する
                    </li>
                    <li>
                      AIと何度かやり取りしても構いません。<b>納得のいく内容になったら、その最終的な回答だけ</b>をコピーする（途中のやり取り全部を貼る必要はありません）
                    </li>
                    <li>
                      コピーした回答を下の<b>「AIの回答を貼り付けて保存」欄</b>に貼り付け、<b>「保存する」ボタン</b>を押す
                    </li>
                    <li>
                      下の<b>「次のステップへ」ボタン</b>を押す
                    </li>
                  </>
                )}
              </ol>
            </div>
            <button onClick={() => setShowGuide(false)} className="shrink-0 opacity-50 hover:opacity-100 mt-0.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2B2A26" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )}

        {(step.input_files.length > 0 || step.output_files.length > 0) && (
          <div className="flex gap-6">
            {step.input_files.length > 0 && (
              <div className="flex-1 flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">参考にするファイル</span>
                <div className="flex flex-wrap gap-x-1.5 gap-y-0.5">
                  {step.input_files.map((f, i) => (
                    <span key={f} className="text-[13px] font-mono">
                      {i > 0 && <span className="text-muted mr-1.5">/</span>}
                      <button
                        onClick={() => onOpenArtifact(stripProjectPrefix(f, projectId))}
                        className="text-accent underline decoration-dotted hover:decoration-solid"
                      >
                        {stripProjectPrefix(f, projectId)}
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">保存先</span>
              <div className="flex flex-wrap gap-x-1.5 gap-y-0.5">
                {step.output_files.map((f, i) => (
                  <span key={f} className="text-[13px] font-mono">
                    {i > 0 && <span className="text-muted mr-1.5">/</span>}
                    <button
                      onClick={() => onOpenArtifact(stripProjectPrefix(f, projectId))}
                      className="text-accent underline decoration-dotted hover:decoration-solid"
                    >
                      {stripProjectPrefix(f, projectId)}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
            AIへの指示文（このまま直接書き換えられます）
          </span>
          <textarea
            className="border border-border rounded-xl p-4 bg-bg text-[13.5px] leading-relaxed whitespace-pre-line min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-accent/40"
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
          />
          {!command && step.input_files.length > 0 && (
            <span className="text-[11.5px] text-muted">
              ＋ 上の「参考にするファイル」の中身も、コピー時に自動でまとめて付け加えられます。
            </span>
          )}
          <div className="flex gap-2.5 mt-0.5 items-center">
            <button
              onClick={handleCopy}
              disabled={loadingPrompt}
              className="flex items-center gap-1.5 px-4 py-2 rounded-[9px] bg-accent text-white text-[13px] font-semibold disabled:opacity-50"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              {copied ? "コピーしました" : "プロンプトをコピー"}
            </button>
            {!command && serviceUrl && (
              <button
                onClick={() => openAiWindow(serviceUrl)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-[9px] border border-border bg-white text-[13px] font-semibold text-ink hover:border-accent hover:text-accent"
              >
                {step.ai_name} を開く ↗
              </button>
            )}
            {promptDirty && (
              <button
                onClick={handleSavePrompt}
                className="px-4 py-2 rounded-[9px] border border-accent text-accent text-[13px] font-semibold"
              >
                変更を保存
              </button>
            )}
          </div>
          {copyError && <span className="text-[12px] text-[#8A3A2A]">{copyError}</span>}
        </div>

        {!command && step.output_files.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
              AIの回答を貼り付けて保存
            </span>
            <textarea
              className="border border-border rounded-xl p-4 bg-bg text-[13.5px] leading-relaxed min-h-[120px] resize-y focus:outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="ここにAIの回答を貼り付け..."
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <button
                onClick={handleSavePaste}
                disabled={!pasteText.trim() || saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-[9px] bg-accent text-white text-[13px] font-semibold disabled:opacity-50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                  <path d="M17 21v-8H7v8M7 3v5h8" />
                </svg>
                {saving ? "保存中..." : saved ? "保存しました" : "保存する"}
              </button>
              <button
                onClick={() => onOpenArtifact(stripProjectPrefix(step.output_files[0], projectId))}
                className="text-[11.5px] text-muted font-mono hover:text-accent"
              >
                → {stripProjectPrefix(step.output_files[0], projectId)}
              </button>
              {saveError && <span className="text-[12px] text-[#8A3A2A]">{saveError}</span>}
            </div>
          </div>
        )}

        {command && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
              Claude Code 実行コマンド
            </span>
            {editingCommand ? (
              <>
                <input
                  className="border border-border rounded-xl px-3.5 py-3 bg-bg font-mono text-[12.5px] focus:outline-none focus:ring-2 focus:ring-accent/40"
                  value={commandDraft}
                  onChange={(e) => setCommandDraft(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveCommand}
                    className="px-3.5 py-1.5 rounded-[9px] bg-accent text-white text-[12.5px] font-semibold"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => {
                      setEditingCommand(false);
                      setCommandDraft(command ?? "");
                    }}
                    className="px-3.5 py-1.5 rounded-[9px] border border-border text-[12.5px] font-semibold"
                  >
                    キャンセル
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={handleCopyCommand}
                className="flex items-center justify-between gap-3 rounded-[10px] px-3.5 py-3 bg-ink text-[#F4EFE4] font-mono text-[12.5px] text-left"
                title="クリックしてコピー"
              >
                <span>{command}</span>
                {commandCopied ? (
                  <span className="text-[11px] shrink-0">コピーしました</span>
                ) : (
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#F4EFE4"
                    strokeWidth="2"
                    className="shrink-0"
                  >
                    <rect x="9" y="9" width="12" height="12" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                )}
              </button>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowExecuteConfirm(true)}
                disabled={executing}
                className="flex items-center gap-1.5 px-4 py-2 rounded-[9px] border border-border bg-white text-[13px] font-semibold disabled:opacity-50"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2B2A26" strokeWidth="2.2">
                  <path d="M6 4l14 8-14 8V4z" />
                </svg>
                {executing ? "実行中..." : "ローカルで実行"}
              </button>
              {!editingCommand && (
                <button
                  onClick={() => setEditingCommand(true)}
                  className="text-[12px] text-muted hover:text-ink underline"
                >
                  コマンドを書き換える
                </button>
              )}
            </div>

            {execError && <span className="text-[12px] text-[#8A3A2A]">{execError}</span>}

            {execResult && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-[12px] font-semibold">
                  <span
                    className="px-2 py-0.5 rounded-full"
                    style={
                      execResult.timedOut
                        ? { background: "#F1EFEA", color: "#8A8578" }
                        : execResult.exitCode === 0
                          ? { background: "color-mix(in oklch, #3F6B52 14%, white)", color: "#3F6B52" }
                          : { background: "color-mix(in oklch, #8A3A2A 14%, white)", color: "#8A3A2A" }
                    }
                  >
                    {execResult.timedOut
                      ? `タイムアウト（${Math.round((execResult.timeoutMs ?? 0) / 60000)}分）`
                      : `終了コード: ${execResult.exitCode}`}
                  </span>
                </div>
                {(execResult.stdout || execResult.stderr) && (
                  <pre className="font-mono text-[11.5px] leading-relaxed bg-ink text-[#E9E4D9] rounded-[10px] p-3 max-h-[220px] overflow-y-auto whitespace-pre-wrap break-words">
                    {execResult.stdout}
                    {execResult.stderr}
                  </pre>
                )}
              </div>
            )}

            {stepHistory.length > 0 && (
              <div className="flex flex-col gap-2 mt-1">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-muted uppercase tracking-wide">
                  <span>実行履歴</span>
                  <span className="normal-case font-mono text-ink">
                    {stepSuccessCount}/{stepHistory.length} 成功
                    （{Math.round((stepSuccessCount / stepHistory.length) * 100)}%）
                  </span>
                </div>
                <ul className="flex flex-col gap-1">
                  {stepHistory.slice(0, 5).map((h) => (
                    <li key={h.id} className="flex items-center gap-2 text-[12px]">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: h.timedOut ? "#8A8578" : h.exitCode === 0 ? "#3F6B52" : "#8A3A2A" }}
                      />
                      <span className="text-muted font-mono shrink-0">
                        {new Date(h.finishedAt).toLocaleString("ja-JP", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="text-muted">
                        {h.timedOut ? "タイムアウト" : h.exitCode === 0 ? "成功" : `失敗 (終了コード ${h.exitCode})`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {step.output_files.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-borderSoft p-3.5">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
              他のAIにも同じ内容を聞いて比べる（任意）
            </span>
            <span className="text-[12px] text-muted leading-relaxed -mt-1">
              同じ指示でも、AIによって得意分野や書き方の癖が違うため、返ってくる内容は変わります。ここでの保存はあくまで見比べるための下書きで、このステップの完了には使われません。気に入った回答（または組み合わせ）を「本命欄にコピー」で上の欄に移し、<b>上の「保存する」を押して初めて本採用</b>になります。
            </span>

            {attempts.length > 0 && (
              <div className="flex flex-col gap-2">
                {attempts.map((a, i) => (
                  <AttemptRow
                    key={a.output_file}
                    projectId={projectId}
                    attempt={a}
                    aiUrl={aiServices.find((s) => s.name === a.ai_name)?.url ?? null}
                    onRemove={() => removeAttempt(i)}
                    onAdopt={(content) => setPasteText(content)}
                  />
                ))}
              </div>
            )}

            {showAddAttempt ? (
              <div className="flex items-center gap-2">
                <select
                  className="flex-1 border border-border rounded-md px-2.5 py-1.5 bg-white text-[12.5px] focus:outline-none focus:ring-2 focus:ring-accent/40"
                  value={newAttemptAi}
                  onChange={(e) => setNewAttemptAi(e.target.value)}
                >
                  {aiOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={confirmAddAttempt}
                  className="shrink-0 px-3 py-1.5 rounded-md bg-accent text-white text-[12px] font-semibold"
                >
                  追加する
                </button>
                <button
                  onClick={() => setShowAddAttempt(false)}
                  className="shrink-0 px-3 py-1.5 rounded-md border border-border text-[12px] font-semibold"
                >
                  やめる
                </button>
              </div>
            ) : (
              <button
                onClick={startAddAttempt}
                className="self-start px-3.5 py-1.5 rounded-lg border border-dashed border-border text-[12.5px] font-semibold text-muted hover:text-accent hover:border-accent"
              >
                ＋ 別のAIを試す
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-7 py-3.5 border-t border-borderSoft flex items-center justify-end gap-3">
        {step.status === "done" && !hasNextStep && (
          <span className="text-[12.5px] text-muted mr-auto">
            このステップは完了していますが、次の工程はまだありません。
          </span>
        )}
        {mainOutputSaved === false && step.status !== "done" && (
          <span className="text-[12.5px] text-[#8A3A2A] mr-auto">
            先に上の「保存する」でAIの回答を保存すると、次に進めます。
          </span>
        )}
        {step.status === "done" && !hasNextStep ? (
          <button
            onClick={onAddNextStep}
            className="px-5 py-2.5 rounded-[9px] bg-accent text-white text-[13.5px] font-semibold"
          >
            ＋ 次のステップを追加する
          </button>
        ) : (
          <button
            onClick={onAdvance}
            disabled={step.status === "done" || mainOutputSaved === false}
            title={mainOutputSaved === false ? "先にAIの回答を保存してください" : undefined}
            className="px-5 py-2.5 rounded-[9px] bg-ink text-white text-[13.5px] font-semibold disabled:opacity-40"
          >
            成果物の回収を完了し、次のステップへ
          </button>
        )}
      </div>

      {showExecuteConfirm && command && (
        <ConfirmModal
          title="コマンドをローカルで実行"
          message={
            <>
              <p className="mb-2">以下のコマンドをこのマシン上で実際に実行します（workspace/ フォルダ内）。</p>
              <p className="font-mono text-[12.5px] bg-bg border border-border rounded-lg px-3 py-2 break-words">
                {command}
              </p>
              <p className="mt-2 text-muted text-[12.5px]">
                実行内容に問題がないか確認してください。実装タスクの場合、完了まで数分かかることがあります（最大10分）。
              </p>
            </>
          }
          confirmLabel="実行する"
          danger
          onCancel={() => setShowExecuteConfirm(false)}
          onConfirm={handleConfirmExecute}
        />
      )}
    </div>
  );
}
