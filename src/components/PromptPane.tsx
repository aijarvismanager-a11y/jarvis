import { useEffect, useState } from "react";
import type { WorkflowStep } from "../types/workflow";
import { executeCommand, saveArtifactContent, type ExecuteResult } from "../lib/api";
import { stripProjectPrefix } from "../lib/paths";
import { ConfirmModal } from "./ConfirmModal";

const STATUS_META: Record<WorkflowStep["status"], { label: string; color: string; bg: string }> = {
  done: { label: "完了", color: "#3F6B52", bg: "color-mix(in oklch, #3F6B52 14%, white)" },
  active: { label: "進行中", color: "#B5563A", bg: "color-mix(in oklch, #B5563A 14%, white)" },
  pending: { label: "未着手", color: "#8A8578", bg: "#F1EFEA" },
};

type Props = {
  projectId: string;
  step: WorkflowStep;
  prompt: string;
  loadingPrompt: boolean;
  command: string | null;
  serviceUrl: string | null;
  onAdvance: () => void;
  onEditTemplate: () => void;
};

export function PromptPane({ projectId, step, prompt, loadingPrompt, command, serviceUrl, onAdvance, onEditTemplate }: Props) {
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
  const meta = STATUS_META[step.status];

  useEffect(() => {
    setExecResult(null);
    setExecError(null);
    setShowGuide(true);
    setPasteText("");
    setSaveError(null);
    setSaved(false);
  }, [step.id, command]);

  async function handleSavePaste() {
    const outputFile = step.output_files[0];
    if (!outputFile || !pasteText.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveArtifactContent(projectId, stripProjectPrefix(outputFile, projectId), pasteText);
      setSaved(true);
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

  async function handleConfirmExecute() {
    if (!command) return;
    setShowExecuteConfirm(false);
    setExecuting(true);
    setExecError(null);
    setExecResult(null);
    try {
      setExecResult(await executeCommand(projectId, command));
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
          <span className="font-serif text-xl font-semibold">{step.role}</span>
          <span
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: meta.bg, color: meta.color }}
          >
            {meta.label}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[13px] text-muted">
          <span>担当AI: {step.ai_name}</span>
          {serviceUrl && (
            <a
              href={serviceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent text-[12px] font-semibold hover:underline"
            >
              開く ↗
            </a>
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
                      下のプロンプトを<b>「プロンプトをコピー」ボタン</b>でコピーする
                    </li>
                    <li>
                      {serviceUrl ? (
                        <>
                          <b>「開く↗」リンク</b>から担当AIのサイトを開き
                        </>
                      ) : (
                        "担当AIのサイトを開き"
                      )}
                      、コピーした内容を貼り付けて実行する
                    </li>
                    <li>AIから返ってきた回答をコピーする</li>
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

        <div className="flex gap-6">
          <div className="flex-1 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">入力ファイル</span>
            <span className="text-[13px] font-mono">
              {step.input_files.length ? step.input_files.join(" / ") : "なし（起点ステップ）"}
            </span>
          </div>
          <div className="flex-1 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">出力ファイル</span>
            <span className="text-[13px] font-mono">{step.output_files.join(" / ")}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">生成されたプロンプト</span>
          <div className="border border-border rounded-xl p-4 bg-bg text-[13.5px] leading-relaxed whitespace-pre-line min-h-[80px]">
            {loadingPrompt ? "入力ファイルを読み込み中..." : prompt}
          </div>
          <div className="flex gap-2.5 mt-0.5">
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
            <button
              onClick={onEditTemplate}
              className="px-4 py-2 rounded-[9px] border border-border bg-white text-[13px] font-semibold"
            >
              テンプレートを編集
            </button>
          </div>
          {copyError && <span className="text-[12px] text-[#8A3A2A]">{copyError}</span>}
        </div>

        {!command && step.output_files.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
              AIの回答を貼り付けて保存
            </span>
            <span className="text-[12px] text-muted -mt-1">
              担当AIから返ってきた内容をここに貼り付けると、
              <code className="mx-1 px-1 rounded bg-bg font-mono text-[11px]">
                {stripProjectPrefix(step.output_files[0], projectId)}
              </code>
              として保存されます。
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
              {saveError && <span className="text-[12px] text-[#8A3A2A]">{saveError}</span>}
            </div>
          </div>
        )}

        {command && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
              Claude Code 実行コマンド
            </span>
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
            <div>
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
          </div>
        )}
      </div>

      <div className="px-7 py-3.5 border-t border-borderSoft flex justify-end">
        <button
          onClick={onAdvance}
          disabled={step.status === "done"}
          className="px-5 py-2.5 rounded-[9px] bg-ink text-white text-[13.5px] font-semibold disabled:opacity-40"
        >
          成果物の回収を完了し、次のステップへ
        </button>
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
