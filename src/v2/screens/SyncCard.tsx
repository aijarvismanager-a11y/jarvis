import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Ctx } from "../context";
import { formatTime } from "../labels";
import { Badge, Button, Card, Details, useAction } from "../ui";
import type { SyncBackup, SyncEntry, SyncState } from "../types";

const KIND_LABEL: Record<SyncEntry["kind"], string> = { added: "追加", modified: "変更", deleted: "削除" };
type Direction = "push" | "pull";

// What each direction means, in the user's words.
const TEXT = {
  push: {
    title: "コピー → 元のフォルダ",
    intro: "コピー側で変えた内容を、確認のうえ元のフォルダへ書き込みます。",
    empty: "コピー側で変えた内容はありません(元のフォルダと同じです)。",
    conflict: "元のフォルダ側でも変更されたファイルを上書きする(既定は上書きしません)",
    del: "コピー側で消したファイルを、元のフォルダからも削除する(既定は残します)",
    button: (n: number) => `${n}件を元のフォルダへ書き込む`,
    target: "元のフォルダ",
    back: "この書き込み前に戻す",
    backupsLabel: "元のフォルダの退避",
  },
  pull: {
    title: "元のフォルダ → コピー",
    intro: "元のフォルダを別のツールで編集したときに、その内容をコピー側へ取り込みます。",
    empty: "元のフォルダ側で変わった内容はありません。",
    conflict: "コピー側でも変更されたファイルを上書きする(既定は上書きしません)",
    del: "元のフォルダで消したファイルを、コピーからも削除する(既定は残します)",
    button: (n: number) => `${n}件をコピーへ取り込む`,
    target: "このプロジェクトのコピー",
    back: "この取り込み前に戻す",
    backupsLabel: "コピーの退避",
  },
} as const;

function Section({ dir, projectId, entries, backups, running, ctx, reload }: { dir: Direction; projectId: string; entries: SyncEntry[]; backups: SyncBackup[]; running: boolean; ctx: Ctx; reload: () => Promise<void> }) {
  const t = TEXT[dir];
  const [deletes, setDeletes] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const { busy, run } = useAction(ctx.setError);
  const hasDelete = entries.some((e) => e.kind === "deleted");
  const hasConflict = entries.some((e) => e.conflict);
  const willWrite = entries.filter((e) => (deletes || e.kind !== "deleted") && (overwrite || !e.conflict)).length;
  const apply = () => {
    if (!window.confirm(`${t.target}に ${willWrite} 件の変更を書き込みます。書き換え・削除されるファイルは、先にバックアップへ退避します。よろしいですか?`)) return;
    void run(async () => {
      const r = await api.applySync(projectId, { deletes, overwriteConflicts: overwrite, direction: dir });
      setDeletes(false);
      setOverwrite(false);
      ctx.setError(r.applied ? "" : "書き込む変更はありませんでした");
      if (dir === "pull") ctx.refresh();
      await reload();
    });
  };
  const restore = (id: string) => {
    if (!window.confirm(`${t.target}を、この書き込みの直前の状態に戻します。よろしいですか?`)) return;
    void run(async () => {
      await api.restoreSync(projectId, id, dir);
      if (dir === "pull") ctx.refresh();
      await reload();
    });
  };
  return (
    <div className="mt-4 border-t border-borderSoft pt-3">
      <h3 className="text-[13px] font-semibold">{t.title}</h3>
      <p className="mt-0.5 text-[12px] text-muted">{t.intro}</p>
      {entries.length === 0 && <p className="mt-2 text-[13px]">{t.empty}</p>}
      {entries.length > 0 && (
        <>
          <ul className="mt-2 max-h-56 overflow-auto text-[12px]">
            {entries.map((e) => (
              <li key={e.path} className="flex items-center gap-2 font-mono">
                <span className="w-8 shrink-0 text-muted">{KIND_LABEL[e.kind]}</span>
                <span className="min-w-0 flex-1 break-all">{e.path}</span>
                {e.conflict && <Badge tone="warn">{dir === "push" ? "元も変更あり" : "コピーも変更あり"}</Badge>}
              </li>
            ))}
          </ul>
          {hasDelete && (
            <label className="mt-2 flex items-start gap-2 text-[12.5px]">
              <input type="checkbox" className="mt-0.5" checked={deletes} onChange={(e) => setDeletes(e.target.checked)} />
              {t.del}
            </label>
          )}
          {hasConflict && (
            <label className="mt-1 flex items-start gap-2 text-[12.5px]">
              <input type="checkbox" className="mt-0.5" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              {t.conflict}
            </label>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={busy || running || willWrite === 0} onClick={apply}>{t.button(willWrite)}</Button>
            {running && <span className="text-[12px] text-muted">ミッション実行中は書き込めません(一時停止してください)</span>}
          </div>
        </>
      )}
      {backups.length > 0 && (
        <div className="mt-3">
          <Details summary={`${t.backupsLabel}(${backups.length}件・新しい順。古いものは自動で削除)`}>
            <ul className="space-y-1 text-[12px]">
              {backups.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2">
                  <span>{formatTime(b.createdAt)}</span>
                  <span className="text-muted">{b.files.length}ファイル</span>
                  <Button variant="ghost" disabled={busy || running} onClick={() => restore(b.id)}>{t.back}</Button>
                </li>
              ))}
            </ul>
          </Details>
        </div>
      )}
    </div>
  );
}

/** For a project imported from a folder: review what differs between the copy and the original, in either direction, and apply it after saving what it replaces. */
export function SyncCard({ ctx }: { ctx: Ctx }) {
  const projectId = ctx.project!.id;
  const [state, setState] = useState<SyncState | null>(null);
  const { busy } = useAction(ctx.setError);
  const load = useCallback(() => api.sync(projectId).then(setState).catch(() => setState(null)), [projectId]);
  useEffect(() => {
    setState(null);
    void load();
  }, [load]);
  if (!state || !state.linked) return null;
  const running = ctx.mission?.status === "running";

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          元のフォルダとの同期
          {state.pullEntries.length > 0 && <Badge tone="info">取り込み待ち {state.pullEntries.length}</Badge>}
          {state.entries.length > 0 && <Badge tone="warn">書き込み待ち {state.entries.length}</Badge>}
        </span>
      }
    >
      <p className="break-all text-[12.5px]"><span className="text-muted">取り込み元: </span>{state.sourcePath}</p>
      <p className="mt-1 text-[12px] text-muted">作業はコピー側で進みます。どちらの向きも、差分を確認してから反映します。</p>
      {state.problem && <p className="mt-2 text-[12.5px] text-[#9B2C2C]">{state.problem}</p>}
      <Section dir="pull" projectId={projectId} entries={state.pullEntries} backups={state.pullBackups} running={running} ctx={ctx} reload={load} />
      <Section dir="push" projectId={projectId} entries={state.entries} backups={state.backups} running={running} ctx={ctx} reload={load} />
      <div className="mt-3"><Button variant="ghost" disabled={busy} onClick={() => void load()}>差分を再確認</Button></div>
    </Card>
  );
}
