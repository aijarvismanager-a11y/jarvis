import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Ctx } from "../context";
import { formatTime } from "../labels";
import { Badge, Button, Card, Details } from "../ui";
import { useAction } from "../hooks";
import { applyNotice, placeName, restoreNotice, type SyncNotice } from "../syncText";
import type { SyncBackup, SyncEntry, SyncState, VerifyInfo } from "../types";

const KIND_LABEL: Record<SyncEntry["kind"], string> = { added: "追加", modified: "変更", deleted: "削除" };
type Direction = "push" | "pull";

// Files the AI wrote about the work (design notes, reviews, reports) rather than part of the app: not ticked by default.
const isNotes = (p: string) => /^(design|review|reviews|docs|reports?|notes)\//i.test(p);

// What each direction means, in the user's words. `f` is the folder's name: the original of an imported project, or the save folder the app made.
const textFor = (f: string) =>
  ({
    push: {
      title: `① このアプリで変えた分を、${f}へ反映する`,
      intro: `AIが作った・直したファイルです。チェックを入れたものだけが、${f}に入ります。`,
      empty: `このアプリで変えた分はありません。${f}と同じです。`,
      conflict: `${f}側でも変えられたファイルを、上書きする(チェックしないと、そのファイルは反映しません)`,
      del: `このアプリで消したファイルを、${f}からも消す(チェックしないと、残します)`,
      button: (n: number) => `${n}件を${f}へ反映する`,
      target: f,
      back: "この反映を取り消す",
      backupsLabel: `反映する前の${f}(バックアップ)`,
    },
    pull: {
      title: `② ${f}で変わった分を、このアプリへ取り込む`,
      intro: `${f}を、ほかのツールで編集したときの変更です。このアプリ側で変えていないファイルは、依頼が動いていないときに、自動で取り込まれます。ここに残るのは、依頼の実行中のものと、自動では取り込まないもの(両方で変えたファイル・消されたファイル)です。`,
      empty: `${f}側で変わった分はありません。`,
      conflict: "このアプリ側でも変えたファイルを、上書きする(チェックしないと、そのファイルは取り込みません)",
      del: `${f}で消されたファイルを、このアプリからも消す(チェックしないと、残します)`,
      button: (n: number) => `${n}件をこのアプリへ取り込む`,
      target: "このアプリのコピー",
      back: "この取り込みを取り消す",
      backupsLabel: "取り込む前のこのアプリのコピー(バックアップ)",
    },
  }) as const;

function Section({ dir, place, projectId, entries, backups, running, ctx, reload }: { dir: Direction; place: string; projectId: string; entries: SyncEntry[]; backups: SyncBackup[]; running: boolean; ctx: Ctx; reload: () => Promise<void> }) {
  const t = textFor(place)[dir];
  const [notice, setNotice] = useState<SyncNotice | null>(null);
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
    setNotice(null);
    void run(async () => {
      try {
        const r = await api.applySync(projectId, { deletes, overwriteConflicts: overwrite, direction: dir, paths: picks.map((e) => e.path) });
        setChosen({});
        setDeletes(false);
        setOverwrite(false);
        setNotice(applyNotice(t.target, r));
        if (dir === "pull") ctx.refresh();
      } finally {
        // even after an error: some files may already be in, so the list must be read again
        await reload();
        ctx.refreshSync?.();
      }
    });
  };
  const restore = (id: string) => {
    if (!window.confirm(`${t.target}を、この操作の直前の状態に戻します。そのあとで中身が変えられたファイルは、そのまま残します。よろしいですか?`)) return;
    setNotice(null);
    void run(async () => {
      try {
        setNotice(restoreNotice(t.target, await api.restoreSync(projectId, id, dir)));
        if (dir === "pull") ctx.refresh();
      } finally {
        await reload();
        ctx.refreshSync?.();
      }
    });
  };
  return (
    <div className="mt-4 border-t border-borderSoft pt-3">
      <h3 className="text-[13px] font-semibold">{t.title}</h3>
      <p className="mt-0.5 text-[12px] text-muted">{t.intro}</p>
      {notice && (
        <div role="status" className={`mt-2 rounded-md border px-3 py-2 text-[12.5px] ${notice.tone === "ok" ? "border-[#BFDCC6] bg-[#EEF7F0]" : "border-[#E8D3A6] bg-[#FBF4E4]"}`}>
          {notice.lines.map((l, i) => <p key={i} className="break-all">{l}</p>)}
        </div>
      )}
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
                {e.shrinkVerdict === "safe" && <Badge tone="ok">半分以下に減りますが安全と確認済み</Badge>}
                {e.shrinks && <Badge tone="warn">長いファイルが半分以下に減ります(中身が消える恐れ)</Badge>}
                {e.conflict && <Badge tone="warn">{dir === "push" ? `${place}でも変更あり` : "このアプリでも変更あり"}</Badge>}
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
            {!running && willWrite === 0 && <span className="text-[12px] text-muted">{entries.some(allowed) ? "入れるファイルに、チェックを入れると押せます" : "残っているのは、そのままでは入れないファイルです。入れるときは、上の「上書きする」や「消す」の欄にチェックを入れてください"}</span>}
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
const VERIFY_TONE = { passed: "ok", failed: "bad", postponed: "warn", running: "info" } as const;
const VERIFY_LABEL = { passed: "通過", failed: "失敗", postponed: "あとで実行", running: "実行中" } as const;

/** "Reflect, then build, start and measure the real app": the approval of the script, its latest result, and a button to run it again. */
function VerifyBox({ projectId, info, ctx, reload }: { projectId: string; info: VerifyInfo; ctx: Ctx; reload: () => Promise<void> }) {
  const [script, setScript] = useState<string | null>(null);
  const r = info.result;
  useEffect(() => {
    if (r?.status !== "running" && r?.status !== "postponed") return;
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
  }, [r?.status, reload]);
  const fail = (e: unknown) => ctx.setError(e instanceof Error ? e.message : String(e));
  return (
    <div className="mt-2 rounded-md border border-borderSoft bg-white px-3 py-2 text-[12.5px]">
      <p className="font-semibold">反映後の自動確認(ビルド → 起動 → 測定)</p>
      <p className="mt-0.5 text-[11.5px] text-muted">依頼を元のフォルダへ自動で反映したあと、このPCで実際にアプリを作り直して動かし、測ります。PCを使っている間は、使い終わるまで待ちます。</p>
      {!info.approved && (
        <p className="mt-1.5 text-[12px] text-[#7A5410]">{info.changed ? "確認の手順の中身が変わりました。読んでから、もう一度承認してください。" : "この確認は、あなたが手順を読んで承認するまで、実行されません。"}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => void api.verifyScript(projectId).then((v) => setScript(script === null ? v.text : null)).catch(fail)}>{script === null ? "手順を読む" : "手順を閉じる"}</Button>
        {!info.approved && <Button onClick={() => void api.approveVerify(projectId).then(reload).catch(fail)}>この手順を承認する</Button>}
        {info.approved && <Button variant="ghost" disabled={r?.status === "running"} onClick={() => void api.runVerify(projectId).then(() => reload()).catch(fail)}>確認を実行</Button>}
        {r && <Badge tone={VERIFY_TONE[r.status]}>{VERIFY_LABEL[r.status]}</Badge>}
      </div>
      {script !== null && <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 text-[11px]">{script}</pre>}
      {r && <p className="mt-1.5 text-[12px]">{formatTime(r.at)} · {r.summary}</p>}
      {r?.tail && r.status !== "running" && (
        <details className="mt-1"><summary className="cursor-pointer text-[11.5px] text-muted">くわしい出力</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 text-[11px]">{r.tail}</pre></details>
      )}
    </div>
  );
}

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
  const place = placeName(state.createdByApp);

  return (
    <div id="sync-card">
    <Card
      fold
      open={false} // the tab already shows a badge when the folders differ; a long card must not push the request itself down
      title={
        <span className="flex flex-wrap items-center gap-2">
          {state.createdByApp ? "保存先のフォルダに入れる" : "元のフォルダに反映する"}
          {state.entries.length > 0 && <Badge tone="warn">反映していない変更 {state.entries.length}件</Badge>}
          {state.pullEntries.length > 0 && <Badge tone="info">{place}側の変更 {state.pullEntries.length}件</Badge>}
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
      <label className="mt-2 flex items-start gap-2 text-[12.5px]">
        <input type="checkbox" className="mt-0.5" checked={!!state.autoReflect} onChange={(e) => void api.setAutoReflect(projectId, e.target.checked).then(load).catch((err) => ctx.setError(err instanceof Error ? err.message : String(err)))} />
        <span><b>依頼が終わったら、安全なものは自動で反映する</b><span className="block text-[11.5px] text-muted">コンフリクトのないファイルだけを入れます。削除・AIのメモ・「半分以下に減る」ファイルは入れず、ここに残します。反映前にバックアップします。</span></span>
      </label>
      {state.verify?.available && <VerifyBox projectId={projectId} info={state.verify} ctx={ctx} reload={load} />}
      {state.problem ? (
        // the two folders could not be compared: saying "no differences" here would be false
        <div className="mt-2 rounded-md border border-[#E7C4C4] bg-[#FBEFEF] px-3 py-2 text-[12.5px]">
          <p className="font-semibold text-[#9B2C2C]">{state.problem === "元のフォルダが見つかりません" ? `${place}が見つからないため、違いを調べられません。` : `違いを調べられません(${state.problem})`}</p>
          {state.createdByApp ? (
            <>
              <p className="mt-1">フォルダを移した・名前を変えた場合は、上の場所と名前に戻してから「差分を再確認」を押してください。消した場合は、下のボタンで空のフォルダを作り直せます(そのあと「反映する」で中身が入ります)。</p>
              <div className="mt-2"><Button onClick={() => void api.recreateSyncFolder(projectId).then(load).then(() => ctx.refreshSync?.()).catch((e) => ctx.setError(e instanceof Error ? e.message : String(e)))}>保存先のフォルダを作り直す</Button></div>
            </>
          ) : (
            <p className="mt-1">フォルダを移した・名前を変えた場合は、上の場所と名前に戻してから、下の「差分を再確認」を押してください。つないでいた外付けドライブなどが外れていないかも確かめてください。</p>
          )}
        </div>
      ) : (
        <>
          <Section dir="push" place={place} projectId={projectId} entries={state.entries} backups={state.backups} running={running} ctx={ctx} reload={load} />
          <Section dir="pull" place={place} projectId={projectId} entries={state.pullEntries} backups={state.pullBackups} running={running} ctx={ctx} reload={load} />
        </>
      )}
      <div className="mt-3"><Button variant="ghost" disabled={busy} onClick={() => void load()}>差分を再確認</Button></div>
    </Card>
    </div>
  );
}
