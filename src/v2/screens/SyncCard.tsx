import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Ctx } from "../context";
import { formatTime } from "../labels";
import { Badge, Button, Card, Details } from "../ui";
import { useAction } from "../hooks";
import type { SyncBackup, SyncEntry, SyncState } from "../types";

const KIND_LABEL: Record<SyncEntry["kind"], string> = { added: "追加", modified: "変更", deleted: "削除" };
type Direction = "push" | "pull";

// Files the AI wrote about the work (design notes, reviews, reports) rather than part of the app: not ticked by default.
const isNotes = (p: string) => /^(design|review|reviews|docs|reports?|notes)\//i.test(p);

// What each direction means, in the user's words.
const TEXT = {
  push: {
    title: "① このアプリで変えた分を、元のフォルダへ反映する",
    intro: "AIが作った・直したファイルです。チェックを入れたものだけが、元のフォルダに入ります。",
    empty: "このアプリで変えた分はありません。元のフォルダと同じです。",
    conflict: "元のフォルダ側でも変えられたファイルを、上書きする(チェックしないと、そのファイルは反映しません)",
    del: "このアプリで消したファイルを、元のフォルダからも消す(チェックしないと、残します)",
    button: (n: number) => `${n}件を元のフォルダへ反映する`,
    target: "元のフォルダ",
    back: "この反映を取り消す",
    backupsLabel: "反映する前の元のフォルダ(バックアップ)",
  },
  pull: {
    title: "② 元のフォルダで変わった分を、このアプリへ取り込む",
    intro: "元のフォルダを、ほかのツールで編集したときの変更です。このアプリ側で変えていないファイルは、依頼が動いていないときに、自動で取り込まれます。ここに残るのは、依頼の実行中のものと、自動では取り込まないもの(両方で変えたファイル・消されたファイル)です。",
    empty: "元のフォルダ側で変わった分はありません。",
    conflict: "このアプリ側でも変えたファイルを、上書きする(チェックしないと、そのファイルは取り込みません)",
    del: "元のフォルダで消されたファイルを、このアプリからも消す(チェックしないと、残します)",
    button: (n: number) => `${n}件をこのアプリへ取り込む`,
    target: "このアプリのコピー",
    back: "この取り込みを取り消す",
    backupsLabel: "取り込む前のこのアプリのコピー(バックアップ)",
  },
} as const;

function Section({ dir, projectId, entries, backups, running, ctx, reload }: { dir: Direction; projectId: string; entries: SyncEntry[]; backups: SyncBackup[]; running: boolean; ctx: Ctx; reload: () => Promise<void> }) {
  const t = TEXT[dir];
  const [deletes, setDeletes] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const { busy, run } = useAction(ctx.setError);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const hasDelete = entries.some((e) => e.kind === "deleted");
  const hasConflict = entries.some((e) => e.conflict || e.shrinks);
  const ticked = (e: SyncEntry) => chosen[e.path] ?? !isNotes(e.path);
  const allowed = (e: SyncEntry) => (deletes || e.kind !== "deleted") && (overwrite || (!e.conflict && !e.shrinks));
  const picks = entries.filter((e) => allowed(e) && ticked(e));
  const willWrite = picks.length;
  const apply = () => {
    if (!window.confirm(`${t.target}に ${willWrite} 件の変更を入れます。変わるファイルは、先にバックアップします(あとから取り消せます)。よろしいですか?`)) return;
    void run(async () => {
      const r = await api.applySync(projectId, { deletes, overwriteConflicts: overwrite, direction: dir, paths: picks.map((e) => e.path) });
      setChosen({});
      setDeletes(false);
      setOverwrite(false);
      ctx.setError(r.applied ? "" : "入れる変更はありませんでした");
      if (dir === "pull") ctx.refresh();
      await reload();
    });
  };
  const restore = (id: string) => {
    if (!window.confirm(`${t.target}を、この操作の直前の状態に戻します。よろしいですか?`)) return;
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
          {entries.some((e) => isNotes(e.path)) && <p className="mt-2 text-[11.5px] text-muted">「メモ」は、AIが書いた設計メモやレポートです。アプリ本体ではないので、はじめはチェックが外れています。必要なものだけ、チェックを入れてください。</p>}
          <ul className="mt-2 max-h-56 overflow-auto text-[12px]">
            {entries.map((e) => (
              <li key={e.path} className="flex items-center gap-2 font-mono">
                <input type="checkbox" aria-label={`${e.path} を反映する`} checked={ticked(e) && allowed(e)} disabled={!allowed(e)} onChange={(ev) => setChosen((c) => ({ ...c, [e.path]: ev.target.checked }))} />
                <span className="w-8 shrink-0 text-muted">{KIND_LABEL[e.kind]}</span>
                <span className="min-w-0 flex-1 break-all">{e.path}</span>
                {isNotes(e.path) && <span className="shrink-0 font-sans text-[11px] text-muted" title="AIが書いたメモやレポートです。はじめはチェックが外れています">メモ</span>}
                {e.shrinks && <Badge tone="warn">長いファイルが半分以下に減ります(中身が消える恐れ)</Badge>}
                {e.conflict && <Badge tone="warn">{dir === "push" ? "元のフォルダでも変更あり" : "このアプリでも変更あり"}</Badge>}
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
              {t.conflict}(「半分以下に減ります」と出たファイルも、チェックしないと入れません)
            </label>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={busy || running || willWrite === 0} onClick={apply}>{t.button(willWrite)}</Button>
            {running && <span className="text-[12px] text-muted">依頼の実行中は反映できません。一時停止してから押してください</span>}
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
  // tagged with the project it belongs to, so switching projects never shows the previous one's state
  const [loaded, setLoaded] = useState<{ projectId: string; state: SyncState | null } | null>(null);
  const state = loaded?.projectId === projectId ? loaded.state : null;
  const { busy } = useAction(ctx.setError);
  const load = useCallback(() => api.sync(projectId).then((s) => setLoaded({ projectId, state: s })).catch(() => setLoaded({ projectId, state: null })), [projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!state || !state.linked) return null;
  const running = ctx.mission?.status === "running";

  return (
    <div id="sync-card">
    <Card
      fold
      open={false} // the tab already shows a badge when the folders differ; a long card must not push the request itself down
      title={
        <span className="flex flex-wrap items-center gap-2">
          {state.createdByApp ? "保存先のフォルダに入れる" : "元のフォルダに反映する"}
          {state.entries.length > 0 && <Badge tone="warn">反映していない変更 {state.entries.length}件</Badge>}
          {state.pullEntries.length > 0 && <Badge tone="info">元のフォルダ側の変更 {state.pullEntries.length}件</Badge>}
        </span>
      }
    >
      <p className="break-all text-[12.5px]"><span className="text-muted">{state.createdByApp ? "保存先のフォルダ: " : "元のフォルダ: "}</span>{state.sourcePath}</p>
      <div className="mt-1.5 rounded-md bg-bg px-3 py-2 text-[12px] leading-relaxed text-muted">
        {state.createdByApp ? (
          <p>このプロジェクトは、このアプリの中で作っています。できたもの(CHANGELOG.md などの更新履歴も)は、下の「反映する」を押すと、上の<b>保存先のフォルダ</b>に入ります。押すまでは、アプリの中にだけあります。</p>
        ) : (
          <p>このアプリは、元のフォルダの<b>コピー</b>で作業しています。AIが変えた内容は、下の「反映する」を押すまで、<b>元のフォルダには入りません</b>。</p>
        )}
        <p className="mt-0.5">反映の前に、変わるファイルは自動でバックアップされます。あとから取り消せます。</p>
      </div>
      {state.problem && <p className="mt-2 text-[12.5px] text-[#9B2C2C]">{state.problem}</p>}
      <Section dir="pull" projectId={projectId} entries={state.pullEntries} backups={state.pullBackups} running={running} ctx={ctx} reload={load} />
      <Section dir="push" projectId={projectId} entries={state.entries} backups={state.backups} running={running} ctx={ctx} reload={load} />
      <div className="mt-3"><Button variant="ghost" disabled={busy} onClick={() => void load()}>差分を再確認</Button></div>
    </Card>
    </div>
  );
}
