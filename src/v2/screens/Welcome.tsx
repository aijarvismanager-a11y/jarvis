import { useState } from "react";
import { api } from "../api";
import { usePoll } from "../hooks";
import type { ClaudeStatus } from "../types";
import { Badge, Button, Card } from "../ui";

/** Claude Code is the one thing this app cannot work without. Says so, and what to do, before the first request fails. */
export function ClaudeCheck({ always = false }: { always?: boolean }) {
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [checking, setChecking] = useState(false);
  // a problem is re-checked often (the person is probably fixing it); a working setup only now and then
  const refresh = usePoll(async () => setStatus(await api.systemStatus()), status && status.state === "ready" ? 60000 : 8000, [status?.state]);
  if (!status) return null;
  if (status.state === "ready") return always ? <p className="text-[12.5px] text-status-done">✓ 準備OK:Claude Code が使えます(バージョン {status.version})</p> : null;
  const recheck = async () => {
    setChecking(true);
    try {
      setStatus(await api.systemStatus(true));
    } finally {
      setChecking(false);
    }
  };
  void refresh;
  return (
    <Card className="border-[#E7C4C4] bg-[#FBEFEF]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="bad">準備が必要です</Badge>
        <span className="text-[13px] font-semibold">{status.state === "not_installed" ? "Claude Code が見つかりません" : status.state === "not_logged_in" ? "Claude Code にログインしてください" : "Claude Code の状態を確認できません"}</span>
      </div>
      <p className="mt-2 text-[13px]">{status.message}</p>
      <p className="mt-1 text-[12px] text-muted">このアプリは、あなたのパソコンの Claude Code(AI)に作業を頼んで動きます。準備ができるまで、作業は始められません。</p>
      <div className="mt-2"><Button variant="ghost" disabled={checking} onClick={() => void recheck()}>{checking ? "確認中…" : "もう一度確認する"}</Button></div>
    </Card>
  );
}

const STEPS = [
  { n: 1, title: "作りたいものを書く", text: "「商品管理ができるWebアプリ」のように、普通の言葉で。" },
  { n: 2, title: "計画を確認して承認する", text: "よければ「この計画で開始」を押します。" },
  { n: 3, title: "できあがりを確かめる", text: "「動かして確認」で、実際に動かして見られます。" },
];

/** Shown when there is nothing yet: what this app does, in three steps, and the two ways to start. */
export function Welcome({ onHelp, onImport }: { onHelp: () => void; onImport: () => void }) {
  return (
    <Card>
      <h2 className="font-serif text-[20px] font-semibold">AIオーケストラへようこそ</h2>
      <p className="mt-1 text-[13px] text-[#4a473f]">作りたいものを伝えると、AI が計画を立てて、あなたのパソコン上で作ってくれるアプリです。はじめ方は2つあります。</p>
      <h3 className="mt-3 text-[13px] font-semibold">A. 新しく作る(いちばん下の入力欄に書いて「送る」)</h3>
      <ol className="mt-1.5 grid gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n}>
            <span className="font-semibold text-accent">{s.n}. {s.title}</span>
            <span className="block text-[12px] text-muted">{s.text}</span>
          </li>
        ))}
      </ol>
      <h3 className="mt-3 text-[13px] font-semibold">B. 作りかけのフォルダを続ける</h3>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted">Claude Code や Codex などで作っている途中のフォルダを、ここで続けたいとき:</span>
        <Button variant="ghost" onClick={onImport}>ほかで作っているものを引き継ぐ</Button>
        <Button variant="ghost" onClick={onHelp}>使い方を見る</Button>
      </div>
      <div className="mt-3"><ClaudeCheck always /></div>
    </Card>
  );
}
