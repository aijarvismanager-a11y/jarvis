import { useState } from "react";
import { ApiError, api } from "./api";
import { useAction } from "./hooks";
import type { Project } from "./types";
import { Button } from "./ui";

type Heavy = { name: string; files: number; bytes: number };
type TooLarge = { files: number; bytes: number; folders: Heavy[] };

const mb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)}GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))}MB`);

/** Brings an existing folder in as a new project; Claude Code then writes a status report about it. */
export function ImportBar({ onImported, setError }: { onImported: (p: Project) => void; setError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState("");
  const [note, setNote] = useState<string | null>(null);
  // Shown right under the field, where the user is looking, not only in the page-wide bar.
  const [problem, setProblem] = useState<string | null>(null);
  const [heavy, setHeavy] = useState<TooLarge | null>(null);
  const [leaveOut, setLeaveOut] = useState<Set<string>>(new Set());
  const { busy, run } = useAction(setError);

  if (!open) return <div className="mx-auto max-w-3xl px-4 pb-2"><Button variant="ghost" onClick={() => setOpen(true)}>既存プロジェクトを取り込む</Button>{note && <span className="ml-2 text-[12px] text-status-done">{note}</span>}</div>;

  const go = (exclude: string[] = []) =>
    run(async () => {
      setProblem(null);
      try {
        const r = await api.importProject(folder.trim(), exclude);
        const left = r.excluded?.length ? `(除外: ${r.excluded.join("、")})` : "";
        setNote(r.existing ? `このフォルダは取り込み済みです。「${r.project.name}」を開きました(コピーは増やしません)` : `${r.files}ファイルを取り込みました${left}${r.skippedSecrets.length ? `(秘密情報らしい${r.skippedSecrets.length}ファイルは除外)` : ""}`);
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
    <div className="mx-auto max-w-3xl px-4 pb-3">
      <p className="text-[12px] text-muted">フォルダはコピーして取り込みます(元のフォルダは変更しません)。node_modules・.git・.env などは除きます。取り込み後、Claude Code が現状レポートを作ります。</p>
      <div className="mt-1 flex gap-2">
        <input value={folder} onChange={(e) => { setFolder(e.target.value); setProblem(null); setHeavy(null); }} placeholder="例: C:\Users\you\my-app" className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-[13px] outline-none focus:border-accent" />
        <Button disabled={busy || !folder.trim()} onClick={() => void go()}>{busy ? "取り込み中…" : "取り込む"}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>閉じる</Button>
      </div>
      {busy && <p className="mt-1 text-[12px] text-muted">コピーしています。大きいフォルダは数十秒かかることがあります…</p>}
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
