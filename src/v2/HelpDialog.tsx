import { useEffect } from "react";
import { Button } from "./ui";

const GLOSSARY: [string, string][] = [
  ["依頼", "あなたが AI に頼む1回のまとまり(例:「ログイン画面を作って」)。1つのプロジェクトに、何度でも出せます。"],
  ["計画", "依頼を受けて AI が立てる作業の予定です。始める前に必ずあなたが確認します。"],
  ["作業", "計画の1つ1つの手順です(設計 → 実装 → レビュー など)。順番に実行されます。"],
  ["許可", "削除や公開など、取り返しにくい作業をする前に、AI があなたに確認を求める仕組みです。"],
  ["あなたの操作が必要", "別の AI(ChatGPT など)に頼むとき、指示文を貼り付けて、返事をここへ貼る作業です。「Web AIを使う」を入れたときだけ出ます。"],
  ["取り込み", "すでにあるフォルダを、このアプリに読み込むことです。フォルダは丸ごと「コピー」して作業し、元のフォルダは勝手に変えません。"],
  ["同期", "コピーと元のフォルダの違いを見比べて、確認したうえで、元のフォルダへ反映することです。反映の前に、元のファイルは自動でバックアップされます。"],
  ["動かして確認", "作りかけのアプリを実際に起動して、画面で試せます。あなたのパソコン上だけで動きます。"],
];

const FAQ: [string, string][] = [
  ["最初に必要なものは?", "パソコンに Claude Code が入っていて、ログインしていることです。ホーム画面の上に、使えるかどうかが出ます。出ていなければ、案内のとおりに準備してください。"],
  ["作ったものはどこに保存される?", "「できたもの」タブで、ファイルを読めます。取り込んだフォルダの場合は、「元のフォルダとの同期」から元の場所へ書き込めます。"],
  ["AI が間違えたら?", "作業の下の「変更内容を見る」で、何が変わったかを確認できます。「この作業の変更を元に戻す」で、その作業の前の状態に戻せます。"],
  ["途中でやめたい・方針を変えたい", "実行中は「一時停止」「方針を変える」「中止」が使えます。完了済みの作業は残ります。"],
  ["試しに取り込んだプロジェクトを消したい", "「設定」タブの一番上の「このプロジェクトを削除」で消せます。消えるのはこのアプリの中のコピーと記録だけで、元のフォルダは残ります。"],
  ["お金はかかる?", "このアプリ自体は無料です。AI の利用は、あなたの Claude Code の契約(利用枠)から使われます。画面に使用量の目安が出ます。"],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="使い方" onClick={onClose}>
      <div className="my-6 w-full max-w-2xl rounded-xl border border-border bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-serif text-[20px] font-semibold">使い方 <a href="/MANUAL.html" target="_blank" rel="noreferrer noopener" className="ml-2 text-[12px] font-normal text-accent hover:underline">説明書を別のタブで開く</a></h2>
          <Button variant="ghost" onClick={onClose}>閉じる</Button>
        </div>

        <h3 className="mt-4 text-[14px] font-semibold">基本の流れ</h3>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-[13px]">
          <li><b>ホーム</b>で、作りたいものを書いて「開発を開始」を押す。</li>
          <li>AI が出した<b>計画</b>を読み、よければ「この計画で開始」を押す(直したいときは書いて「修正して再提案」)。</li>
          <li>AI が作業します。画面の一番上の「次にやること」を見れば、いま自分がやることが分かります。</li>
          <li>終わったら「動かして確認」で試す。続きは「新しい依頼」で頼む。</li>
        </ol>

        <h3 className="mt-4 text-[14px] font-semibold">画面の見かた</h3>
        <ul className="mt-1 space-y-1 text-[13px]">
          <li><b>ホーム</b> … 次にやること、いまの依頼、新しい依頼の入力。</li>
          <li><b>進み具合</b> … いまの依頼が全体のどこまで進んだか、作業ごとの状況。</li>
          <li><b>これまでの記録</b> … 過去の依頼の一覧と、何が起きたかの履歴。</li>
          <li><b>できたもの</b> … AI が作ったファイルを選んで読めます。</li>
          <li><b>設定</b> … プロジェクトの削除、使える AI の一覧など。ふだんは触らなくて大丈夫です。</li>
        </ul>

        <h3 className="mt-4 text-[14px] font-semibold">用語</h3>
        <dl className="mt-1 space-y-1.5 text-[13px]">
          {GLOSSARY.map(([w, d]) => (
            <div key={w} className="grid gap-x-3 sm:grid-cols-[9rem_1fr]">
              <dt className="font-semibold">{w}</dt>
              <dd className="text-[#4a473f]">{d}</dd>
            </div>
          ))}
        </dl>

        <h3 className="mt-4 text-[14px] font-semibold">よくある質問</h3>
        <div className="mt-1 space-y-2 text-[13px]">
          {FAQ.map(([q, a]) => (
            <div key={q}>
              <p className="font-semibold">{q}</p>
              <p className="text-[#4a473f]">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
