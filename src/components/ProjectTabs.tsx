import type { Project } from "../types/workflow";

type Props = {
  projects: Project[];
  currentId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
};

export function ProjectTabs({ projects, currentId, onSelect, onAdd, onDelete }: Props) {
  return (
    <div className="flex items-center gap-1 px-4 h-11 border-b border-border bg-sidebar overflow-x-auto shrink-0">
      {projects.map((p) => {
        const active = p.id === currentId;
        return (
          <div
            key={p.id}
            className="group flex items-center gap-1.5 pl-3.5 pr-2 h-8 rounded-lg cursor-pointer shrink-0"
            style={{
              background: active ? "#FFFFFF" : "transparent",
              border: active ? "1px solid #E9E4D9" : "1px solid transparent",
            }}
            onClick={() => onSelect(p.id)}
          >
            <span
              className="text-[13px] whitespace-nowrap"
              style={{ color: active ? "#2B2A26" : "#8A8578", fontWeight: active ? 600 : 500 }}
            >
              {p.name}
            </span>
            {projects.length > 1 && (
              <button
                title="プロジェクトを削除"
                className="opacity-0 group-hover:opacity-50 hover:!opacity-100 p-0.5 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(p.id);
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#2B2A26" strokeWidth="2.4">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onAdd}
        className="flex items-center gap-1 px-3 h-8 rounded-lg text-[13px] font-semibold shrink-0"
        style={{ color: "#B5563A" }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B5563A" strokeWidth="2.2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        新しいプロジェクト
      </button>
    </div>
  );
}
