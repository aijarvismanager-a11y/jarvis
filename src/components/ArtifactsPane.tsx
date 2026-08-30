import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ArtifactFile } from "../lib/api";
import { highlightCode, langForPath } from "../lib/highlight";

type Props = {
  files: ArtifactFile[];
  selectedPath: string | null;
  content: string | null;
  loading: boolean;
  onSelect: (path: string) => void;
};

function isMarkdown(p: string) {
  return p.endsWith(".md");
}

function CodePreview({ path, content }: { path: string; content: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    highlightCode(content, path).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [path, content]);

  if (html) {
    return <div className="artifact-code text-[12px] leading-relaxed rounded-[10px] overflow-hidden [&_pre]:p-3.5 [&_pre]:m-0 [&_pre]:overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <pre className="font-mono text-[12px] leading-relaxed bg-ink text-[#E9E4D9] rounded-[10px] p-3.5 whitespace-pre-wrap break-words">
      {content}
    </pre>
  );
}

export function ArtifactsPane({ files, selectedPath, content, loading, onSelect }: Props) {
  return (
    <div className="flex flex-col w-[340px] shrink-0 border-l border-border bg-[#FCFAF6]">
      <div className="px-4 pt-4 pb-2.5">
        <span className="text-xs font-semibold text-muted tracking-wide uppercase">Artifacts</span>
      </div>

      <div className="flex gap-0.5 px-3 border-b border-borderSoft overflow-x-auto">
        {files.length === 0 && (
          <span className="text-[12px] text-muted px-2 py-2">
            まだ成果物がありません（ステップを進めるとここに表示されます）
          </span>
        )}
        {files.map((f) => {
          const active = f.path === selectedPath;
          return (
            <button
              key={f.path}
              onClick={() => onSelect(f.path)}
              className="px-2.5 py-2 text-[12px] font-semibold rounded-t-md whitespace-nowrap"
              style={{
                background: active ? "#FFFFFF" : "transparent",
                color: active ? "#2B2A26" : "#8A8578",
                borderBottom: `2px solid ${active ? "#B5563A" : "transparent"}`,
              }}
            >
              {f.path}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4.5">
        {loading && <span className="text-[12.5px] text-muted">読み込み中...</span>}
        {!loading && !selectedPath && <span className="text-[12.5px] text-muted">プレビューするファイルを選択してください</span>}
        {!loading && selectedPath && content !== null && (
          isMarkdown(selectedPath) ? (
            <div className="prose-artifact">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          ) : langForPath(selectedPath) ? (
            <CodePreview path={selectedPath} content={content} />
          ) : (
            <pre className="font-mono text-[12px] leading-relaxed bg-ink text-[#E9E4D9] rounded-[10px] p-3.5 whitespace-pre-wrap break-words">
              {content}
            </pre>
          )
        )}
      </div>

      <div className="px-4 py-3 border-t border-borderSoft text-[11.5px] text-muted">
        workspace/ を監視中
      </div>
    </div>
  );
}
