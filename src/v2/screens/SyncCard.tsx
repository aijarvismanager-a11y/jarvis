import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Ctx } from "../context";
import { formatTime } from "../labels";
import { Badge, Button, Card, Details, useAction } from "../ui";
import type { SyncEntry, SyncState } from "../types";

const KIND_LABEL: Record<SyncEntry["kind"], string> = { added: "追加", modified: "変更", deleted: "削除" };

/** For a project imported from a folder: shows what the working copy changed and writes it back to the original, after saving what it replaces. */
export function SyncCard({ ctx }: { ctx: Ctx }) {
  const projectId = ctx.project!.id;
  const [state, setState] = useState<SyncState | null>(null);
  const [deletes, setDeletes] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const { busy, run } = useAction(ctx.setError);
  const load = useCallback(() => api.sync(projectId).then(setState).catch(() => setState(null)), [projectId]);
  useEffect(() => {
    setState(null);
    void load();
  }, [load]);
  if (!state || !state.linked) return null;

  const running = ctx.mission?.status === "running";
  const hasDelete = state.entries.some((e) => e.kind === "deleted");
  const hasConflict = state.entries.some((e) => e.conflict);
  const willWrite = state.entries.filter((e) => (deletes || e.kind !== "deleted") && (overwrite || !e.conflict)).length;
  const apply = () => {
    if (!window.confirm(`元のフォルダ\n${state.sourcePath}\nに ${willWrite} 件の変更を書き込みます。書き換え・削除されるファイルは、先にバックアップへ退避します。よろしいですか?`)) return;
    void run(async () => {
      const r = await api.applySync(projectId, { deletes, overwriteConflicts: overwrite });
      setDeletes(false);
      setOverwrite(false);
      ctx.setError(r.applied ? "" : "書き込む変更はありませんでした");
      await load();
    });
  };
  const restore = (id: string) => {
    if (!window.confirm("元のフォルダを、この書き込みの直前の状態に戻します。よろしいですか?")) return;
    void run(async () => {
      await api.restoreSync(projectId, id);
      await load();
    });
  };

  return (
    <Card title="元のフォルダとの同期">
      <p className="break-all text-[12.5px]"><span className="text-muted">取り込み元: </span>{state.sourcePath}</p>
      <p className="mt-1 text-[12px] text-muted">作業はコピー側で進みます。差分を確認してから、元のフォルダへ書き込めます。</p>
      {state.problem && <p className="mt-2 text-[12.5px] text-[#9B2C2C]">{state.problem}</p>}
      {!state.problem && state.entries.length === 0 && <p className="mt-2 text-[13px]">元のフォルダとの差分はありません。</p>}
      {state.entries.length > 0 && (
        <>
          <ul className="mt-2 max-h-56 overflow-auto text-[12px]">
            {state.entries.map((e) => (
              <li key={e.path} className="flex items-center gap-2 font-mono">
                <span className="w-8 shrink-0 text-muted">{KIND_LABEL[e.kind]}</span>
                <span className="min-w-0 flex-1 break-all">{e.path}</span>
                {e.conflict && <Badge tone="warn">元も変更あり</Badge>}
              </li>
            ))}
          </ul>
          {hasDelete && (
            <label className="mt-2 flex items-start gap-2 text-[12.5px]">
              <input type="checkbox" className="mt-0.5" checked={deletes} onChange={(e) => setDeletes(e.target.checked)} />
              コピー側で消したファイルを、元のフォルダからも削除する(既定は残します)
            </label>
          )}
          {hasConflict && (
            <label className="mt-1 flex items-start gap-2 text-[12.5px]">
              <input type="checkbox" className="mt-0.5" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              元のフォルダ側でも変更されたファイルを上書きする(既定は上書きしません)
            </label>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={busy || running || willWrite === 0} onClick={apply}>{willWrite}件を元のフォルダへ書き込む</Button>
            {running && <span className="text-[12px] text-muted">ミッション実行中は書き込めません(一時停止してください)</span>}
          </div>
        </>
      )}
      <div className="mt-3"><Button variant="ghost" disabled={busy} onClick={() => void load()}>差分を再確認</Button></div>
      {state.backups.length > 0 && (
        <div className="mt-3">
          <Details summary={`退避したバックアップ(${state.backups.length}件・新しい順。古いものは自動で削除)`}>
            <ul className="space-y-1 text-[12px]">
              {state.backups.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2">
                  <span>{formatTime(b.createdAt)}</span>
                  <span className="text-muted">{b.files.length}ファイル</span>
                  <Button variant="ghost" disabled={busy || running} onClick={() => restore(b.id)}>この書き込み前に戻す</Button>
                </li>
              ))}
            </ul>
          </Details>
        </div>
      )}
    </Card>
  );
}
