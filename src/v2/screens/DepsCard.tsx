import { useState } from "react";
import { api } from "../api";
import type { Ctx } from "../context";
import { useAction, usePoll } from "../hooks";
import { Badge, Button, Card, Details } from "../ui";
import type { DepsState } from "../types";

/** An imported project has no node_modules, so it cannot be previewed: offers to install them, only when the user clicks. */
export function DepsCard({ ctx }: { ctx: Ctx }) {
  const projectId = ctx.project!.id;
  const [state, setState] = useState<{ projectId: string; deps: DepsState } | null>(null);
  const { busy, run } = useAction(ctx.setError);
  const load = usePoll(async () => setState({ projectId, deps: await api.deps(projectId) }), 4000, [projectId]);
  const deps = state?.projectId === projectId ? state.deps : null;
  if (!deps) return null;
  const { install } = deps;
  const missing = deps.missing.map((d) => (d === "." ? "プロジェクト直下" : d));
  if (missing.length === 0 && install.state !== "done" && install.state !== "error") return null;

  const start = () => {
    if (!window.confirm(`次のフォルダで npm install を実行します(パッケージをダウンロードし、プロジェクト自身のインストール用スクリプトも動きます)。\n\n${missing.join("\n")}\n\nよろしいですか?`)) return;
    void run(async () => {
      await api.installDeps(projectId);
      load();
    });
  };
  const badge =
    install.state === "installing" ? <Badge tone="info">インストール中</Badge> : install.state === "error" ? <Badge tone="bad">失敗</Badge> : missing.length === 0 ? <Badge tone="ok">完了</Badge> : <Badge tone="warn">未インストール</Badge>;
  return (
    <Card title="動かすための部品(依存パッケージ)">
      <div className="flex flex-wrap items-center gap-2">
        {badge}
        {missing.length > 0 && install.state !== "installing" && <Button disabled={busy} onClick={start}>{install.state === "error" ? "もう一度インストール" : "インストールする"}</Button>}
      </div>
      {missing.length > 0 && install.state !== "installing" && (
        <p className="mt-2 text-[12.5px]">このプロジェクトを動かして確認するには、部品(ライブラリ)のインストールが必要です。「インストールする」を押してください。({missing.join("、")})</p>
      )}
      {install.message && <p className={`mt-2 text-[12.5px] ${install.state === "error" ? "text-[#9B2C2C]" : ""}`}>{install.message}</p>}
      {install.log && install.state === "error" && (
        <Details summary="ログを見る">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px]">{install.log}</pre>
        </Details>
      )}
    </Card>
  );
}
