import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";
import type { Ctx } from "../context";
import { formatTime } from "../labels";
import { Badge, Card } from "../ui";
import type { Artifact } from "../types";
import { classifyArtifact, groupByFolder } from "../artifactGroups";

const VALIDATION: Record<string, { label: string; tone: "ok" | "bad" | "neutral" }> = {
  passed: { label: "チェックOK", tone: "ok" },
  failed: { label: "チェックNG", tone: "bad" },
  unvalidated: { label: "未チェック", tone: "neutral" },
};

function FileButton({ a, selected, onSelect }: { a: Artifact; selected: Artifact | null; onSelect: (a: Artifact) => void }) {
  const folder = a.path.includes("/") ? a.path.slice(0, a.path.lastIndexOf("/") + 1) : "";
  return (
    <li>
      <button onClick={() => onSelect(a)} className={`w-full rounded px-2 py-1 text-left ${selected?.path === a.path ? "bg-sidebar" : "hover:bg-bg"}`}>
        {/* the file name first, where it lives under it: a long path no longer breaks in the middle of a word */}
        <span className={`block break-words text-[12.5px] ${selected?.path === a.path ? "font-semibold" : ""}`}>{a.path.split("/").pop()}</span>
        {folder && <span className="block break-all text-[11px] text-muted">{folder}</span>}
      </button>
    </li>
  );
}

export function ArtifactScreen({ ctx, selected, onSelect }: { ctx: Ctx; selected: Artifact | null; onSelect: (a: Artifact) => void }) {
  // What was fetched, tagged with what it was fetched for: anything stale is ignored instead of being cleared in an effect.
  const [loaded, setLoaded] = useState<{ key: string; content: string | null; failure: string | null } | null>(null);
  const projectId = ctx.project?.id;
  // A picture (.svg) is shown as a picture; this turns on its source text instead. Resets when another file is chosen.
  const [showSourceFor, setShowSourceFor] = useState<string | null>(null);
  const showSource = !!selected && showSourceFor === selected.path;
  const setShowSource = (on: boolean) => setShowSourceFor(on && selected ? selected.path : null);

  // Newest version of each path.
  const latest = useMemo(() => {
    const byPath = new Map<string, Artifact>();
    for (const a of ctx.overview.artifacts) {
      const cur = byPath.get(a.path);
      if (!cur || a.version > cur.version) byPath.set(a.path, a);
    }
    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  }, [ctx.overview.artifacts]);
  const made = latest.filter((a) => classifyArtifact(a.path) === "made");
  const notes = latest.filter((a) => classifyArtifact(a.path) === "notes");
  const old = latest.filter((a) => classifyArtifact(a.path) === "old");
  const selectedKind = selected ? classifyArtifact(selected.path) : null;
  const versions = selected ? ctx.overview.artifacts.filter((a) => a.path === selected.path).sort((a, b) => b.version - a.version) : [];
  const shown = selected ? (latest.find((a) => a.path === selected.path) ?? selected) : null;

  const wantKey = projectId && selected ? `${projectId}|${selected.path}|${shown?.version}` : "";
  const current = loaded?.key === wantKey ? loaded : null;
  const content = current?.content ?? null;
  const failure = current?.failure ?? null;

  useEffect(() => {
    if (!projectId || !selected) return;
    const key = `${projectId}|${selected.path}|${shown?.version}`;
    let cancelled = false;
    api.artifactContent(projectId, selected.path).then((c) => !cancelled && setLoaded({ key, content: c, failure: null })).catch((e) => !cancelled && setLoaded({ key, content: null, failure: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [projectId, selected?.path, shown?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (latest.length === 0) return <Card title="できたもの">まだ何もできていません。AI が作業を進めると、作ったファイル(設計書・コードなど)がここに並びます。</Card>;
  const v = VALIDATION[shown?.validationStatus ?? "unvalidated"] ?? VALIDATION.unvalidated;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
      <Card title="できたファイル" className="self-start">
        <p className="mb-2 text-[12px] text-muted">押すと中身を読めます。フォルダの名前を押すと開きます。</p>
        {made.length === 0 && <p className="text-[12px] text-muted">作ったファイルは、まだありません。</p>}
        {groupByFolder(made).map((g) =>
          g.folder === "" ? (
            <ul key="" className="mb-1 space-y-0.5">{g.items.map((a) => <FileButton key={a.path} a={a} selected={selected} onSelect={onSelect} />)}</ul>
          ) : (
            <details key={g.folder} className="mb-1" open={selected ? selected.path.startsWith(`${g.folder}/`) : false}>
              <summary className="cursor-pointer rounded px-2 py-1 text-[13px] font-semibold hover:bg-bg">📁 {g.folder}<span className="ml-1 text-[11px] font-normal text-muted">({g.items.length})</span></summary>
              <ul className="space-y-0.5 pl-2">{g.items.map((a) => <FileButton key={a.path} a={a} selected={selected} onSelect={onSelect} />)}</ul>
            </details>
          ),
        )}
        {notes.length > 0 && (
          <details className="mt-3 border-t border-borderSoft pt-2" open={selectedKind === "notes"}>
            <summary className="cursor-pointer text-[12.5px] text-muted">AIのメモ({notes.length}件: 調べたこと・設計・レビューなど)</summary>
            <ul className="mt-1 space-y-0.5">{notes.map((a) => <FileButton key={a.path} a={a} selected={selected} onSelect={onSelect} />)}</ul>
          </details>
        )}
        {old.length > 0 && (
          <details className="mt-3 border-t border-borderSoft pt-2" open={selectedKind === "old"}>
            <summary className="cursor-pointer text-[12.5px] text-muted">古いファイル・自動でできたファイル({old.length}件: 読まなくて大丈夫です)</summary>
            <ul className="mt-1 space-y-0.5">{old.map((a) => <FileButton key={a.path} a={a} selected={selected} onSelect={onSelect} />)}</ul>
          </details>
        )}
      </Card>
      <Card className="min-w-0">
        {!shown ? (
          <p className="text-[13px] text-muted">左のリストからファイルを選んでください。AI が作った文書やコードを、ここで読めます(ここでは編集できません)。</p>
        ) : (
          <>
            <div className="mb-3 border-b border-borderSoft pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all font-serif text-[15px] font-semibold">{shown.path.split("/").pop()}</span>
                <Badge tone={v.tone}>{v.label}</Badge>
              </div>
              <p className="mt-0.5 break-all text-[11.5px] text-muted">
                {shown.path.includes("/") && <>{shown.path.slice(0, shown.path.lastIndexOf("/") + 1)} · </>}
                第{shown.version}版 · {formatTime(shown.createdAt)}{shown.sourceAi ? ` · ${shown.sourceAi}` : ""}
                {versions.length > 1 && <> · 全{versions.length}版あり(最新を表示)</>}
                {shown.sourceUrl && <> · <a href={shown.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">情報の出どころ</a></>}
              </p>
            </div>
            {failure ? (
              <p className="text-[13px] text-[#9B2C2C]">{failure}</p>
            ) : content === null ? (
              <p className="text-[13px] text-muted">読み込み中…</p>
            ) : /\.svg$/i.test(shown.path) && !showSource ? (
              <div>
                {/* an <img> never runs scripts inside the SVG, so a picture an AI drew is safe to show */}
                <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`} alt={shown.path} className="block w-full rounded-lg border border-borderSoft bg-bg" />
                <button onClick={() => setShowSource(true)} className="mt-2 text-[12px] text-muted hover:underline">図のソース(文字)を見る</button>
              </div>
            ) : shown.path.endsWith(".md") ? (
              <div className="prose-artifact"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>
            ) : (
              <>
                {/\.svg$/i.test(shown.path) && <button onClick={() => setShowSource(false)} className="mb-2 text-[12px] text-accent hover:underline">← 図として見る</button>}
                <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink p-3.5 font-mono text-[12px] leading-relaxed text-[#E9E4D9]">{content}</pre>
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
