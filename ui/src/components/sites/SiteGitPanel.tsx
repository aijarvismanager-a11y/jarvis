import React, { useState, useEffect, useCallback } from "react";
import { api } from "../../hooks/useApi";
import { confirmDialog } from "../../v2/ui/ConfirmDialog";
import type { GitBranch, GitCommit } from "./types";
import { SiteGitHubModal } from "./SiteGitHubModal";

type GitRemoteStatus = {
  hasRemote: boolean;
  remoteUrl: string | null;
  owner: string | null;
  repo: string | null;
  ahead: number;
  behind: number;
  lastPushedAt: number | null;
};

type Props = {
  projectId: string;
  projectName: string;
  githubUrl: string | null;
  onClose: () => void;
  onGitHubChange: () => void;
};

export function SiteGitPanel({ projectId, projectName, githubUrl, onClose, onGitHubChange }: Props) {
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBranchName, setNewBranchName] = useState("");
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [mergeBranch, setMergeBranch] = useState<string | null>(null);
  const [mergeStrategy, setMergeStrategy] = useState<"merge" | "rebase">("merge");
  const [actionMessage, setActionMessage] = useState<{ text: string; type: "ok" | "error" } | null>(null);

  // GitHub state
  const [showGitHubModal, setShowGitHubModal] = useState(false);
  const [remoteStatus, setRemoteStatus] = useState<GitRemoteStatus | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);

  const currentBranch = branches.find((b) => b.current)?.name ?? "main";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [b, c] = await Promise.all([
        api<GitBranch[]>(`/api/sites/projects/${projectId}/git/branches`),
        api<GitCommit[]>(`/api/sites/projects/${projectId}/git/log?limit=30`),
      ]);
      setBranches(b);
      setCommits(c);
    } catch { /* ignore */ }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSwitchBranch = async (name: string) => {
    try {
      await api(`/api/sites/projects/${projectId}/git/branch`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setActionMessage({ text: `${name}に切り替えました`, type: "ok" });
      refresh();
    } catch (err) {
      setActionMessage({ text: err instanceof Error ? err.message : "切り替えに失敗しました", type: "error" });
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    try {
      await api(`/api/sites/projects/${projectId}/git/branches`, {
        method: "POST",
        body: JSON.stringify({ name: newBranchName.trim() }),
      });
      setNewBranchName("");
      setShowNewBranch(false);
      setActionMessage({ text: `ブランチ ${newBranchName} を作成しました`, type: "ok" });
      refresh();
    } catch (err) {
      setActionMessage({ text: err instanceof Error ? err.message : "作成に失敗しました", type: "error" });
    }
  };

  const handleMerge = async () => {
    if (!mergeBranch) return;
    try {
      const result = await api<{ success: boolean; conflicts?: string[] }>(`/api/sites/projects/${projectId}/git/merge`, {
        method: "POST",
        body: JSON.stringify({ branch: mergeBranch, strategy: mergeStrategy }),
      });
      if (result.success) {
        setActionMessage({ text: `${mergeBranch} を${mergeStrategy === "merge" ? "マージ" : "リベース"}しました`, type: "ok" });
      } else {
        setActionMessage({ text: `競合が発生: ${result.conflicts?.join(", ")}`, type: "error" });
      }
      setMergeBranch(null);
      refresh();
    } catch (err) {
      setActionMessage({ text: err instanceof Error ? err.message : "マージに失敗しました", type: "error" });
    }
  };

  // Fetch remote status when panel opens and project has GitHub
  useEffect(() => {
    if (!githubUrl) return;
    (async () => {
      try {
        const status = await api<GitRemoteStatus>(`/api/sites/projects/${projectId}/github/status`);
        setRemoteStatus(status);
      } catch { /* ignore */ }
    })();
  }, [projectId, githubUrl]);

  const handlePush = async () => {
    setPushing(true);
    setActionMessage(null);
    try {
      await api(`/api/sites/projects/${projectId}/github/push`, { method: "POST" });
      setActionMessage({ text: "GitHubにプッシュしました", type: "ok" });
      // Refresh status
      const status = await api<GitRemoteStatus>(`/api/sites/projects/${projectId}/github/status`);
      setRemoteStatus(status);
    } catch (err) {
      setActionMessage({ text: err instanceof Error ? err.message : "プッシュに失敗しました", type: "error" });
    }
    setPushing(false);
  };

  const handlePull = async () => {
    setPulling(true);
    setActionMessage(null);
    try {
      const result = await api<{ success: boolean; conflicts?: string[]; error?: string }>(
        `/api/sites/projects/${projectId}/github/pull`, { method: "POST" }
      );
      if (result.success) {
        setActionMessage({ text: "GitHubからプルしました", type: "ok" });
      } else if (result.conflicts?.length) {
        setActionMessage({ text: `競合: ${result.conflicts.join(", ")}`, type: "error" });
      } else {
        setActionMessage({ text: result.error ?? "プルに失敗しました", type: "error" });
      }
      refresh();
      const status = await api<GitRemoteStatus>(`/api/sites/projects/${projectId}/github/status`);
      setRemoteStatus(status);
    } catch (err) {
      setActionMessage({ text: err instanceof Error ? err.message : "プルに失敗しました", type: "error" });
    }
    setPulling(false);
  };

  const handleDisconnect = async () => {
    if (!await confirmDialog("このプロジェクトのGitHub接続を解除しますか？（リモートリポジトリは削除されません）")) return;
    try {
      await api(`/api/sites/projects/${projectId}/github/repo`, { method: "DELETE" });
      setRemoteStatus(null);
      setActionMessage({ text: "GitHubとの接続を解除しました", type: "ok" });
      onGitHubChange();
    } catch (err) {
      setActionMessage({ text: err instanceof Error ? err.message : "接続解除に失敗しました", type: "error" });
    }
  };

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span style={{ fontWeight: 600, fontSize: "13px" }}>Git</span>
        <button onClick={onClose} style={closeBtnStyle}>x</button>
      </div>

      {actionMessage && (
        <div style={{
          padding: "6px 10px", margin: "0 8px 8px", borderRadius: "4px", fontSize: "11px",
          background: actionMessage.type === "ok" ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
          color: actionMessage.type === "ok" ? "var(--ok)" : "var(--j-error)",
        }}>
          {actionMessage.text}
        </div>
      )}

      {/* Branches */}
      <div style={sectionStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={sectionLabelStyle}>ブランチ</span>
          <button onClick={() => setShowNewBranch(!showNewBranch)} style={smallBtnStyle}>+ 新規</button>
        </div>

        {showNewBranch && (
          <div style={{ display: "flex", gap: "4px", marginBottom: 6 }}>
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateBranch(); }}
              placeholder="branch-name"
              style={inputStyle}
              autoFocus
            />
            <button onClick={handleCreateBranch} style={smallBtnStyle}>作成</button>
          </div>
        )}

        {loading ? (
          <div style={{ fontSize: "11px", color: "var(--ink3)", padding: "4px 0" }}>読み込み中...</div>
        ) : (
          branches.map((b) => (
            <div
              key={b.name}
              onClick={() => !b.current && handleSwitchBranch(b.name)}
              style={{
                ...branchItemStyle,
                fontWeight: b.current ? 600 : 400,
                color: b.current ? "var(--ink)" : "var(--ink2)",
                cursor: b.current ? "default" : "pointer",
              }}
            >
              <span>{b.current ? "* " : "  "}{b.name}</span>
              {!b.current && (
                <button
                  onClick={(e) => { e.stopPropagation(); setMergeBranch(b.name); }}
                  style={{ ...smallBtnStyle, fontSize: "10px", padding: "1px 6px" }}
                >
                  マージ
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Merge dialog */}
      {mergeBranch && (
        <div style={{ ...sectionStyle, background: "rgba(0,212,255,0.05)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: "4px", margin: "0 8px 8px" }}>
          <div style={{ fontSize: "11px", marginBottom: 6, color: "var(--ink)" }}>
            <strong>{mergeBranch}</strong> を <strong>{currentBranch}</strong> にマージ
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <select
              value={mergeStrategy}
              onChange={(e) => setMergeStrategy(e.target.value as "merge" | "rebase")}
              style={{ ...inputStyle, flex: "none", width: 80 }}
            >
              <option value="merge">マージ</option>
              <option value="rebase">リベース</option>
            </select>
            <button onClick={handleMerge} style={smallBtnStyle}>確認</button>
            <button onClick={() => setMergeBranch(null)} style={{ ...smallBtnStyle, color: "var(--ink3)" }}>キャンセル</button>
          </div>
        </div>
      )}

      {/* Commit log */}
      <div style={sectionStyle}>
        <span style={sectionLabelStyle}>コミット</span>
        <div style={{ maxHeight: 300, overflow: "auto", marginTop: 4 }}>
          {commits.map((c) => (
            <div key={c.hash} style={commitStyle} title={`${c.hash}\n${c.author}\n${new Date(c.date).toLocaleString()}`}>
              <span style={{ color: "var(--ink)", fontSize: "10px", fontFamily: "monospace", marginRight: 6 }}>
                {c.shortHash}
              </span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.message}
              </span>
              <span style={{ fontSize: "10px", color: "var(--ink3)", marginLeft: 8, whiteSpace: "nowrap" }}>
                {formatRelativeDate(c.date)}
              </span>
            </div>
          ))}
          {commits.length === 0 && !loading && (
            <div style={{ fontSize: "11px", color: "var(--ink3)", padding: "4px 0" }}>まだコミットがありません</div>
          )}
        </div>
      </div>

      {/* GitHub section */}
      <div style={{ ...sectionStyle, borderTop: "1px solid var(--rule)" }}>
        <span style={sectionLabelStyle}>GitHub</span>
        {githubUrl ? (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: "6px" }}>
            <a href={githubUrl} target="_blank" rel="noopener noreferrer" style={ghLinkStyle}>
              {githubUrl.replace("https://github.com/", "")}
            </a>
            {remoteStatus && (
              <div style={{ display: "flex", gap: "8px", fontSize: "11px" }}>
                {remoteStatus.ahead > 0 && (
                  <span style={{ color: "var(--ink)" }}>{remoteStatus.ahead} 件先行</span>
                )}
                {remoteStatus.behind > 0 && (
                  <span style={{ color: "var(--j-warning)" }}>{remoteStatus.behind} 件遅れ</span>
                )}
                {remoteStatus.ahead === 0 && remoteStatus.behind === 0 && (
                  <span style={{ color: "var(--ink3)" }}>最新の状態</span>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: "4px", marginTop: 2 }}>
              <button onClick={handlePush} disabled={pushing} style={smallBtnStyle}>
                {pushing ? "プッシュ中..." : "プッシュ"}
              </button>
              <button onClick={handlePull} disabled={pulling} style={smallBtnStyle}>
                {pulling ? "プル中..." : "プル"}
              </button>
              <button onClick={handleDisconnect} style={{ ...smallBtnStyle, color: "var(--ink3)", borderColor: "var(--rule)", marginLeft: "auto" }}>
                接続解除
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 6 }}>
            <button onClick={() => setShowGitHubModal(true)} style={smallBtnStyle}>
              GitHubにプッシュ
            </button>
          </div>
        )}
      </div>

      {/* GitHub modal */}
      {showGitHubModal && (
        <SiteGitHubModal
          projectId={projectId}
          projectName={projectName}
          onClose={() => setShowGitHubModal(false)}
          onConnected={() => {
            setShowGitHubModal(false);
            onGitHubChange();
          }}
        />
      )}
    </div>
  );
}

function formatRelativeDate(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "たった今";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}時間前`;
  return `${Math.floor(diff / 86400_000)}日前`;
}

const panelStyle: React.CSSProperties = {
  position: "absolute",
  top: 38,
  right: 8,
  width: 340,
  maxHeight: "70vh",
  background: "var(--panel)",
  border: "1px solid var(--rule)",
  borderRadius: "8px",
  zIndex: 100,
  overflow: "auto",
  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 12px",
  borderBottom: "1px solid var(--rule)",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--ink3)",
  cursor: "pointer",
  fontSize: "14px",
};

const sectionStyle: React.CSSProperties = {
  padding: "8px 12px",
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 600,
  color: "var(--ink3)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const smallBtnStyle: React.CSSProperties = {
  padding: "2px 8px",
  fontSize: "11px",
  background: "rgba(0,212,255,0.1)",
  border: "1px solid rgba(0,212,255,0.3)",
  borderRadius: "3px",
  color: "var(--ink)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "4px 8px",
  fontSize: "12px",
  background: "var(--bg)",
  border: "1px solid var(--rule)",
  borderRadius: "3px",
  color: "var(--ink)",
  outline: "none",
};

const branchItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "3px 4px",
  fontSize: "12px",
  borderRadius: "3px",
};

const commitStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "4px 0",
  fontSize: "11px",
  color: "var(--ink2)",
  borderBottom: "1px solid var(--rule)",
};

const ghLinkStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--ink)",
  textDecoration: "none",
  fontFamily: "monospace",
};
