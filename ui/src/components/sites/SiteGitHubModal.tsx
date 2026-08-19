import React, { useState, useEffect, useCallback } from "react";
import { api } from "../../hooks/useApi";

type Props = {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onConnected: () => void;
};

type GitHubRepo = {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
};

type TokenStatus = { hasToken: boolean; username: string | null };

type Mode = "check-token" | "setup-token" | "choose" | "create-repo" | "connect-repo";

export function SiteGitHubModal({ projectId, projectName, onClose, onConnected }: Props) {
  const [mode, setMode] = useState<Mode>("check-token");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create repo state
  const [repoName, setRepoName] = useState(projectName.toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-"));
  const [repoDesc, setRepoDesc] = useState("");
  const [repoPrivate, setRepoPrivate] = useState(true);

  // Connect repo state
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [loadingRepos, setLoadingRepos] = useState(false);

  // Check token on mount
  useEffect(() => {
    (async () => {
      try {
        const status = await api<TokenStatus>("/api/sites/github/token");
        if (status.hasToken && status.username) {
          setUsername(status.username);
          setMode("choose");
        } else {
          setMode("setup-token");
        }
      } catch {
        setMode("setup-token");
      }
    })();
  }, []);

  const handleSaveToken = async () => {
    if (!token.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ ok: boolean; username: string }>("/api/sites/github/token", {
        method: "POST",
        body: JSON.stringify({ token: token.trim() }),
      });
      setUsername(result.username);
      setMode("choose");
    } catch (err) {
      setError(err instanceof Error ? err.message : "トークンの検証に失敗しました");
    }
    setLoading(false);
  };

  const handleCreateRepo = async () => {
    if (!repoName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api(`/api/sites/projects/${projectId}/github/repo`, {
        method: "POST",
        body: JSON.stringify({ name: repoName.trim(), description: repoDesc, private: repoPrivate }),
      });
      // Push initial code
      await api(`/api/sites/projects/${projectId}/github/push`, { method: "POST" });
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "リポジトリの作成に失敗しました");
    }
    setLoading(false);
  };

  const handleConnectRepo = async (fullName: string) => {
    setLoading(true);
    setError(null);
    try {
      await api(`/api/sites/projects/${projectId}/github/repo`, {
        method: "POST",
        body: JSON.stringify({ existingRepo: fullName }),
      });
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "リポジトリの接続に失敗しました");
    }
    setLoading(false);
  };

  const loadRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const data = await api<GitHubRepo[]>("/api/sites/github/repos");
      setRepos(data);
    } catch { /* ignore */ }
    setLoadingRepos(false);
  }, []);

  useEffect(() => {
    if (mode === "connect-repo") loadRepos();
  }, [mode, loadRepos]);

  const filteredRepos = repos.filter(r =>
    r.fullName.toLowerCase().includes(repoSearch.toLowerCase())
  );

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>
            {mode === "setup-token" ? "GitHubと接続" :
             mode === "choose" ? "GitHubへプッシュ" :
             mode === "create-repo" ? "新規リポジトリを作成" :
             mode === "connect-repo" ? "既存のリポジトリと接続" :
             "GitHub"}
          </span>
          <button onClick={onClose} style={closeBtnStyle}>x</button>
        </div>

        {/* Error */}
        {error && (
          <div style={errorStyle}>{error}</div>
        )}

        {/* Token setup */}
        {mode === "check-token" && (
          <div style={bodyStyle}>
            <div style={{ color: "var(--ink3)", fontSize: "12px" }}>GitHub接続を確認中...</div>
          </div>
        )}

        {mode === "setup-token" && (
          <div style={bodyStyle}>
            <p style={descStyle}>
              リポジトリの作成・プッシュには<strong>repo</strong>スコープ付きのGitHub個人アクセストークンを入力してください。
            </p>
            <a
              href="https://github.com/settings/tokens/new?scopes=repo&description=JARVIS+Site+Builder"
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle}
            >
              GitHubで新しいトークンを発行
            </a>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveToken(); }}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              style={inputStyle}
              autoFocus
            />
            <button onClick={handleSaveToken} disabled={loading || !token.trim()} style={primaryBtnStyle}>
              {loading ? "検証中..." : "トークンを保存"}
            </button>
          </div>
        )}

        {/* Choose: create or connect */}
        {mode === "choose" && (
          <div style={bodyStyle}>
            <p style={descStyle}>
              <strong>{username}</strong> としてサインイン中
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button onClick={() => setMode("create-repo")} style={optionBtnStyle}>
                <span style={{ fontWeight: 600 }}>新規リポジトリを作成</span>
                <span style={{ fontSize: "11px", color: "var(--ink3)" }}>
                  新しいGitHubリポジトリを作成してこのプロジェクトをプッシュ
                </span>
              </button>
              <button onClick={() => setMode("connect-repo")} style={optionBtnStyle}>
                <span style={{ fontWeight: 600 }}>既存のリポジトリと接続</span>
                <span style={{ fontSize: "11px", color: "var(--ink3)" }}>
                  すでにGitHub上にあるリポジトリとリンク
                </span>
              </button>
            </div>
            <button
              onClick={async () => {
                await api("/api/sites/github/token", { method: "DELETE" });
                setUsername(null);
                setToken("");
                setMode("setup-token");
              }}
              style={{ ...smallTextBtn, marginTop: "12px" }}
            >
              GitHubアカウントの接続を解除
            </button>
          </div>
        )}

        {/* Create new repo */}
        {mode === "create-repo" && (
          <div style={bodyStyle}>
            <button onClick={() => setMode("choose")} style={backBtnStyle}>戻る</button>
            <label style={labelStyle}>リポジトリ名</label>
            <input
              type="text"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              style={inputStyle}
              autoFocus
            />
            <label style={labelStyle}>説明（任意）</label>
            <input
              type="text"
              value={repoDesc}
              onChange={(e) => setRepoDesc(e.target.value)}
              placeholder="簡単な説明..."
              style={inputStyle}
            />
            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={repoPrivate}
                onChange={(e) => setRepoPrivate(e.target.checked)}
              />
              非公開リポジトリ
            </label>
            <button onClick={handleCreateRepo} disabled={loading || !repoName.trim()} style={primaryBtnStyle}>
              {loading ? "作成中..." : "作成してプッシュ"}
            </button>
          </div>
        )}

        {/* Connect existing repo */}
        {mode === "connect-repo" && (
          <div style={bodyStyle}>
            <button onClick={() => setMode("choose")} style={backBtnStyle}>戻る</button>
            <input
              type="text"
              value={repoSearch}
              onChange={(e) => setRepoSearch(e.target.value)}
              placeholder="リポジトリを検索..."
              style={inputStyle}
              autoFocus
            />
            <div style={{ maxHeight: 250, overflow: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
              {loadingRepos ? (
                <div style={{ fontSize: "11px", color: "var(--ink3)", padding: "8px 0" }}>リポジトリを読み込み中...</div>
              ) : filteredRepos.length === 0 ? (
                <div style={{ fontSize: "11px", color: "var(--ink3)", padding: "8px 0" }}>
                  {repoSearch ? "一致するリポジトリがありません" : "リポジトリが見つかりません"}
                </div>
              ) : (
                filteredRepos.map((r) => (
                  <button
                    key={r.fullName}
                    onClick={() => handleConnectRepo(r.fullName)}
                    disabled={loading}
                    style={repoItemStyle}
                  >
                    <span style={{ fontWeight: 500 }}>{r.fullName}</span>
                    {r.private && <span style={privateBadge}>非公開</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ──

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--rule)",
  borderRadius: "12px",
  width: 420,
  maxHeight: "80vh",
  overflow: "auto",
  boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px 20px",
  borderBottom: "1px solid var(--rule)",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--ink3)",
  cursor: "pointer",
  fontSize: "16px",
};

const bodyStyle: React.CSSProperties = {
  padding: "16px 20px",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
};

const descStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--ink2)",
  lineHeight: 1.5,
  margin: 0,
};

const linkStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "var(--ink)",
  textDecoration: "none",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: "13px",
  background: "var(--bg)",
  border: "1px solid var(--rule)",
  borderRadius: "6px",
  color: "var(--ink)",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  color: "var(--ink2)",
  marginTop: "4px",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  fontSize: "13px",
  fontWeight: 600,
  background: "rgba(0, 212, 255, 0.15)",
  border: "1px solid rgba(0, 212, 255, 0.4)",
  borderRadius: "6px",
  color: "var(--ink)",
  cursor: "pointer",
  marginTop: "4px",
};

const optionBtnStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  padding: "12px 16px",
  background: "var(--bg)",
  border: "1px solid var(--rule)",
  borderRadius: "8px",
  color: "var(--ink)",
  cursor: "pointer",
  textAlign: "left",
  fontSize: "13px",
};

const backBtnStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  background: "none",
  border: "none",
  color: "var(--ink)",
  cursor: "pointer",
  fontSize: "12px",
  padding: 0,
  marginBottom: "4px",
};

const smallTextBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--ink3)",
  cursor: "pointer",
  fontSize: "11px",
  padding: 0,
  textAlign: "left",
};

const repoItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 12px",
  background: "none",
  border: "1px solid transparent",
  borderRadius: "6px",
  color: "var(--ink)",
  cursor: "pointer",
  textAlign: "left",
  fontSize: "12px",
};

const privateBadge: React.CSSProperties = {
  fontSize: "9px",
  padding: "1px 5px",
  borderRadius: "3px",
  background: "rgba(0,212,255,0.1)",
  color: "var(--ink)",
  marginLeft: "auto",
};

const errorStyle: React.CSSProperties = {
  padding: "8px 20px",
  fontSize: "12px",
  color: "var(--j-error)",
  background: "rgba(239,68,68,0.1)",
};
