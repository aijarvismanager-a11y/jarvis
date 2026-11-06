import { useEffect, useState } from "react";
import { ApiError, api } from "./api";
import { useAction } from "./hooks";
import { usePoll } from "./hooks";
import type { ImportProgress, Project } from "./types";
import { Button, Details } from "./ui";

type Heavy = { name: string; files: number; bytes: number };
type TooLarge = { files: number; bytes: number; folders: Heavy[] };

const PHASE: Record<ImportProgress["phase"], string> = {
  scanning: "フォルダの中身を調べています…",
  copying: "ファイルをコピーしています",
  snapshot: "取り込み直後の状態を保存しています(変更前の基準)…",
  fingerprint: "元のフォルダとの同期用に、ファイルを記録しています…",
  history: "Claude Code の会話履歴を要約しています(1〜2分かかります)…",
  starting: "現状分析を開始しています…",
};

const mb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)}GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))}MB`);

/** Brings an existing folder in as a new project; Claude Code then writes a status report about it. */
export function ImportBar({ open, setOpen, onImported, setError }: { open: boolean; setOpen: (v: boolean) => void; onImported: (p: Project) => void; setError: (m: string) => void }) {
  const [folder, setFolder] = useState("");
  const [note, setNote] = useState<string | null>(null);
  // Shown right under the field, where the user is looking, not only in the page-wide bar.
  const [problem, setProblem] = useState<string | null>(null);
  const [heavy, setHeavy] = useState<TooLarge | null>(null);
  const [leaveOut, setLeaveOut] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  // Claude Code's own record of the talk about this folder, if there is one: offered as a checkbox
  // tagged with the folder it was found for, so a stale answer never shows for another folder
  const [found, setFound] = useState<{ folder: string; sessions: number; lastAt: string | null } | null>(null);
  const history = found && found.folder === folder.trim() && folder.trim().length >= 3 ? found : null;
  const [carry, setCarry] = useState(true);
  useEffect(() => {
    const f = folder.trim();
    if (f.length < 3) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api.importHistory(f).then((h) => !cancelled && setFound(h.found ? { folder: f, sessions: h.sessions, lastAt: h.lastAt } : null)).catch(() => {});
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [folder]);
  // other screens (the welcome card) can ask for this form to open
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener("open-import", openIt);
    return () => window.removeEventListener("open-import", openIt);
  }, [setOpen]);
  const { busy, run } = useAction(setError);
  // The import is one long request; this asks the server how far it has got. Only polls while an import is running.
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  usePoll(async () => setProgress(busy ? await api.importProgress() : null), 700, [busy]);

  // the button that opens this form lives in the header (V2App); closed, only the result of the last import is shown
  if (!open) return note ? <div className="mx-auto max-w-[1600px] px-4 pb-2 text-[12px] text-status-done">{note}</div> : null;

  // The browser cannot read a folder's path, so the server opens the Windows folder dialog and returns it.
  const pick = async () => {
    setPicking(true);
    setProblem(null);
    try {
      const chosen = await api.pickFolder();
      if (chosen) {
        setFolder(chosen);
        setHeavy(null);
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setPicking(false);
    }
  };

  const go = (exclude: string[] = []) =>
    run(async () => {
      setProblem(null);
      if (!folder.trim()) return void setProblem("取り込むフォルダが選ばれていません。「フォルダを選ぶ…」を押すか、パスを入力してください");
      try {
        const r = await api.importProject(folder.trim(), exclude, carry && history !== null);
        const left = r.excluded?.length ? `(除外: ${r.excluded.join("、")})` : "";
        setNote(r.existing ? `このフォルダは取り込み済みです。「${r.project.name}」を開きました(コピーは増やしません)` : `${r.files}ファイルを取り込みました${left}${r.skippedSecrets.length ? `(秘密情報らしい${r.skippedSecrets.length}ファイルは除外)` : ""}${r.history?.ok ? `。会話履歴(${r.history.sessions}セッション)を要約して引き継ぎました` : ""}${r.history && !r.history.ok ? `。会話履歴の引き継ぎはできませんでした(${r.history.error})` : ""}`);
        setFolder("");
        setHeavy(null);
        setLeaveOut(new Set());
        setOpen(false);
        onImported(r.project);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setProblem(msg);
        const tooLarge = e instanceof ApiError ? (e.data.tooLarge as TooLarge | undefined) : undefined;
        setHeavy(tooLarge ?? null);
        // pre-select the heaviest folders (never the loose files in the root, which cannot be left out by name)
        setLeaveOut(new Set((tooLarge?.folders ?? []).filter((f, i) => i < 3 && f.bytes > 20 * 1024 ** 2 && !f.name.startsWith("(")).map((f) => f.name)));
      }
    });

  const toggle = (name: string) =>
    setLeaveOut((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-3">
      <div className="rounded-lg border border-borderSoft bg-bg p-3 text-[12.5px]">
        <h2 className="text-[13.5px] font-semibold">ほかで作っているものを引き継ぐ</h2>
        <p className="mt-0.5">Claude Code や Codex などで作っている途中のフォルダを選ぶと、ここで続きをAIに頼めます。フォルダは<b>コピー</b>して使うので、元のフォルダは、あなたが「反映」を押すまで変わりません。</p>
        <Details summary="くわしく(読み込むもの・読み込まないもの)">
          <ul className="list-disc space-y-0.5 pl-5 text-muted">
            <li>読み込んだあと、Claude Code がフォルダの中身を調べて、「何が入っているか」のレポートを作ります。</li>
            <li>node_modules・.git・.env(パスワードなどの秘密情報)は、読み込みません。</li>
          </ul>
        </Details>
      </div>
      <label htmlFor="import-folder" className="mt-2 block text-[12.5px] font-semibold">取り込むフォルダ</label>
      <div className="mt-1 flex flex-wrap gap-2">
        <Button variant="ghost" disabled={busy || picking} onClick={() => void pick()}>{picking ? "選択中…" : "フォルダを選ぶ…"}</Button>
        <input id="import-folder" value={folder} onChange={(e) => { setFolder(e.target.value); setProblem(null); setHeavy(null); }} onKeyDown={(e) => { if (e.key === "Enter" && !busy) void go(); }} placeholder="フォルダのパスをここに入力・貼り付け(例: C:\Users\you\my-app)" className="min-w-[14rem] flex-1 rounded-lg border border-[#8f8a7c] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-accent" />
        <Button disabled={busy} onClick={() => void go()}>{busy ? "取り込み中…" : "取り込む"}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>閉じる</Button>
      </div>
      {history && !busy && (
        <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-[12.5px]">
          <input type="checkbox" className="mt-0.5" checked={carry} onChange={(e) => setCarry(e.target.checked)} />
          <span>
            <span className="font-semibold">このフォルダでの Claude Code との会話履歴を要約して引き継ぐ</span>
            <span className="ml-1 text-muted">({history.sessions}セッション{history.lastAt ? `・最新 ${history.lastAt.slice(0, 10)}` : ""})</span>
            <span className="mt-0.5 block text-[11.5px] text-muted">会話の文章だけを読み取り、Claude Code に要約させて「docs/previous-conversation.md」に保存します(取り込みが1〜2分長くなります)。この要約は元のフォルダには書き戻されません。秘密情報は書かないよう指示していますが、念のため保存後に内容を確認してください。</span>
          </span>
        </label>
      )}
      {busy && (
        <div className="mt-2" role="status">
          <p className="text-[12.5px]">
            {progress ? PHASE[progress.phase] : "取り込みを始めています…"}
            {progress?.phase === "copying" && progress.filesTotal > 0 && <span className="ml-1 text-muted">{progress.files.toLocaleString()} / {progress.filesTotal.toLocaleString()} ファイル · {mb(progress.bytes)} / {mb(progress.bytesTotal)}</span>}
          </p>
          {progress?.phase === "copying" && progress.bytesTotal > 0 && (
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-sidebar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress.bytes / progress.bytesTotal) * 100)}>
              <div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, (progress.bytes / progress.bytesTotal) * 100)}%` }} />
            </div>
          )}
          <p className="mt-1 text-[11.5px] text-muted">この画面を閉じずにお待ちください。大きいフォルダは数分かかることがあります。</p>
        </div>
      )}
      {problem && !busy && <p role="alert" className="mt-1.5 rounded-lg border border-[#E7C4C4] bg-[#FBEFEF] px-2.5 py-1.5 text-[12.5px] text-[#9B2C2C]">{problem}</p>}
      {heavy && !busy && (
        <div className="mt-2 rounded-lg border border-border bg-panel px-3 py-2">
          <p className="text-[12.5px] font-semibold">重いフォルダ(上位)。チェックしたものを除いて取り込みます</p>
          <ul className="mt-1 space-y-0.5">
            {heavy.folders.map((f) => (
              <li key={f.name}>
                <label className={`flex items-center gap-2 text-[12.5px] ${f.name.startsWith("(") ? "text-muted" : ""}`}>
                  <input type="checkbox" disabled={f.name.startsWith("(")} checked={leaveOut.has(f.name)} onChange={() => toggle(f.name)} />
                  <span className="min-w-0 flex-1 break-all font-mono">{f.name}</span>
                  <span className="shrink-0 text-muted">{f.files.toLocaleString()}ファイル · {mb(f.bytes)}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11.5px] text-muted">除外したフォルダはコピーされず、元のフォルダとの同期の対象にもなりません。</p>
          <div className="mt-2"><Button disabled={leaveOut.size === 0} onClick={() => void go([...leaveOut])}>{leaveOut.size}個を除いて取り込む</Button></div>
        </div>
      )}
    </div>
  );
}
