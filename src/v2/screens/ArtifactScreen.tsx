import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "../api";
import type { Ctx } from "../context";
import { formatTime } from "../labels";
import { Badge, Card } from "../ui";
import type { Artifact } from "../types";

const VALIDATION: Record<string, { label: string; tone: "ok" | "bad" | "neutral" }> = {
  passed: { label: "検証OK", tone: "ok" },
  failed: { label: "検証NG", tone: "bad" },
  unvalidated: { label: "未検証", tone: "neutral" },
};

export function ArtifactScreen({ ctx, selected, onSelect }: { ctx: Ctx; selected: Artifact | null; onSelect: (a: Artifact) => void }) {
  // What was fetched, tagged with what it was fetched for: anything stale is ignored instead of being cleared in an effect.
  const [loaded, setLoaded] = useState<{ key: string; content: string | null; failure: string | null } | null>(null);
  const projectId = ctx.project?.id;

  // Newest version of each path.
  const latest = useMemo(() => {
    const byPath = new Map<string, Artifact>();
    for (const a of ctx.overview.artifacts) {
      const cur = byPath.get(a.path);
      if (!cur || a.version > cur.version) byPath.set(a.path, a);
    }
    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  }, [ctx.overview.artifacts]);
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

  if (latest.length === 0) return <Card>まだ成果物がありません。開発が進むとここに表示されます。</Card>;
  const v = VALIDATION[shown?.validationStatus ?? "unvalidated"] ?? VALIDATION.unvalidated;
  return (
    <div className="grid gap-4 md:grid-cols-[240px_1fr]">
      <Card title="ファイル" className="self-start">
        <ul className="space-y-0.5">
          {latest.map((a) => (
            <li key={a.path}>
              <button onClick={() => onSelect(a)} className={`w-full break-all rounded px-2 py-1 text-left text-[12.5px] ${selected?.path === a.path ? "bg-sidebar font-semibold" : "hover:bg-bg"}`}>{a.path}</button>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        {!shown ? (
          <p className="text-[13px] text-muted">左のリストからファイルを選んでください。</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="break-all text-[13px] font-semibold">{shown.path}</span>
              <Badge tone={v.tone}>{v.label}</Badge>
              <span className="text-[11px] text-muted">v{shown.version} · {formatTime(shown.createdAt)}{shown.sourceAi ? ` · ${shown.sourceAi}` : ""}</span>
              {shown.sourceUrl && <a href={shown.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-[11px] text-accent hover:underline">取得元</a>}
              {versions.length > 1 && <span className="text-[11px] text-muted">(全{versions.length}版・表示は最新)</span>}
            </div>
            {failure ? (
              <p className="text-[13px] text-[#9B2C2C]">{failure}</p>
            ) : content === null ? (
              <p className="text-[13px] text-muted">読み込み中…</p>
            ) : shown.path.endsWith(".md") ? (
              <div className="prose-artifact"><ReactMarkdown>{content}</ReactMarkdown></div>
            ) : (
              <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink p-3.5 font-mono text-[12px] leading-relaxed text-[#E9E4D9]">{content}</pre>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
