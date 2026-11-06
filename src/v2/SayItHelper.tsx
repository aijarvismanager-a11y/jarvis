// "How do I tell the orchestra?" - sentence starters that go into the text box with one press, so nobody has to ask
// another AI how to word a request. The parts written with ◯◯ are meant to be rewritten.

export type SayItKind = "first" | "plan" | "change" | "retry";

type Example = { label: string; text: string };

const EXAMPLES: Record<SayItKind, Example[]> = {
  first: [
    { label: "誰が何をできるように", text: "◯◯をする人が、△△できるようにしたい。" },
    { label: "参考にするもの", text: "参考にしたいもの: ◯◯(アプリ名・サイトのURL・手持ちの画像など)。この点を似せたい: △△。" },
    { label: "作らないでほしいこと", text: "作らないでほしいこと: ◯◯。" },
    { label: "最初は小さく", text: "最初は一番大事な機能「◯◯」だけ作ってください。ほかは後で頼みます。" },
    { label: "見た目の希望", text: "見た目は「◯◯」のようにしてください(色: △△ / 雰囲気: □□)。" },
  ],
  plan: [
    { label: "この作業は要らない", text: "作業◯は要りません。理由: △△。" },
    { label: "もっと小さく", text: "最初は一番大事な機能だけにしてください。ほかの作業は後回しにしてください。" },
    { label: "順番を変える", text: "◯◯を先に作ってください。△△はその後にしてください。" },
    { label: "足りないこと", text: "計画に足りないこと: ◯◯もやってください。" },
    { label: "動かして確かめたい", text: "途中でも動かして確かめられるよう、先に画面の動くところまで作ってください。" },
  ],
  change: [
    { label: "今と違うところ", text: "今は「◯◯」になっていますが、「△△」にしてほしいです。" },
    { label: "先にやってほしい", text: "◯◯を先に作ってください。△△は後回しでかまいません。" },
    { label: "やめてほしい", text: "◯◯はやめてください(すでに作ったものは残してかまいません)。" },
    { label: "見た目の希望", text: "見た目は「◯◯」のようにしてください(参考: △△)。" },
  ],
  retry: [
    { label: "今と違うところ", text: "今は「◯◯」になっていますが、「△△」にしてほしいです。" },
    { label: "範囲を絞る", text: "◯◯だけ直してください。ほかの部分は変えないでください。" },
    { label: "簡単にする", text: "もっと簡単な作りにしてください。細かい機能は後回しでかまいません。" },
    { label: "直したあと確かめる", text: "直したら、実際に動かして確かめてから終わってください。" },
  ],
};

const TIP: Record<SayItKind, string> = {
  first: "「誰が・何を・できるように」を書くと、思った形に近づきます。むずかしければ、下の例を押して書き換えてください。",
  plan: "合わないと思う点は、作業の番号と一緒に書くと伝わります。下の例を押すと入力欄に入ります。",
  change: "「今はこう → こうしてほしい」の形が一番伝わります。下の例を押して書き換えてください。",
  retry: "直してほしい点を1つに絞ると、うまくいきます。下の例を押して書き換えてください。",
};

export function SayItHelper({ kind, value, onChange }: { kind: SayItKind; value: string; onChange: (next: string) => void }) {
  const add = (text: string) => onChange(value.trim() ? `${value.replace(/\s+$/, "")}\n${text}` : text);
  return (
    <div className="mb-2 rounded-lg bg-sidebar px-3 py-2">
      <p className="mb-1.5 text-[13px] leading-relaxed text-[#4a473f]">{TIP[kind]}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="伝え方の例">
        {EXAMPLES[kind].map((e) => (
          <button key={e.label} type="button" onClick={() => add(e.text)} title={e.text} className="rounded-full border border-border bg-panel px-3 py-1 text-[13px] hover:bg-bg">
            ＋ {e.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[12px] text-muted">「◯◯」「△△」のところは、自分の言葉に書き換えてください。</p>
    </div>
  );
}
