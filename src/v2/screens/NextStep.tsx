import type { Step } from "../nextStep";

const TONE = {
  go: "border-accent bg-[#FBF1EC]",
  wait: "border-[#BFD3EA] bg-[#F1F6FC]",
  bad: "border-[#E7C4C4] bg-[#FBEFEF]",
  done: "border-[#BCD6C6] bg-[#EEF6F1]",
} as const;
const MARK = { go: "👉", wait: "⏳", bad: "⚠", done: "✅" } as const;

export function NextStepBanner({ step }: { step: Step }) {
  return (
    <section className={`rounded-xl border-2 p-4 ${TONE[step.tone]}`} aria-label="次にやること">
      <p className="text-[11px] font-semibold tracking-wide text-muted">次にやること</p>
      <p className="mt-1 font-serif text-[17px] font-semibold"><span aria-hidden className="mr-1.5">{MARK[step.tone]}</span>{step.title}</p>
      <p className="mt-1 text-[13px] text-[#4a473f]">{step.detail}</p>
      {step.action && (
        <button onClick={step.action.run} className="mt-3 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover">{step.action.label}</button>
      )}
    </section>
  );
}
