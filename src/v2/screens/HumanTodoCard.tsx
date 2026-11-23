import { useState } from "react";
import { api } from "../api";
import type { Ctx } from "../context";
import { useAction, usePoll } from "../hooks";
import type { HumanTodoView } from "../types";
import { Badge, Button, Card } from "../ui";

/** Things only the person can do, with their steps: shown until the person says they are done. */
export function HumanTodoCard({ ctx }: { ctx: Ctx }) {
  const projectId = ctx.project?.id;
  const [todos, setTodos] = useState<HumanTodoView[]>([]);
  const [copied, setCopied] = useState("");
  const { busy, run } = useAction(ctx.setError);
  const load = async () => setTodos(projectId ? await api.humanTodos(projectId).catch(() => []) : []);
  usePoll(load, 20_000, [projectId]);
  if (!projectId || todos.length === 0) return null;
  return (
    <>
      {todos.map((t) => (
        <Card key={t.id} title="あなたがやること(AIにはできない作業)">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">{t.title}</span>
            {t.source === "legacy" && <Badge tone="warn">古い記録から拾いました</Badge>}
          </div>
          {t.why && <p className="mb-2 text-[13px] text-muted">{t.why}</p>}
          <ol className="mb-3 space-y-2">
            {t.steps.map((s, i) => (
              <li key={i} className="text-[13.5px] leading-relaxed">
                <span className="mr-2 font-semibold text-muted">{i + 1}.</span>
                <span>{s.text}</span>
                {s.command && (
                  <div className="mt-1">
                    <Button variant="ghost" className="!px-2.5 !py-1 !text-[12px]" onClick={() => void navigator.clipboard?.writeText(s.command!).then(() => setCopied(`${t.id}:${i}`)).catch(() => undefined)}>
                      {copied === `${t.id}:${i}` ? "コピーしました" : "コマンドをコピー"}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy} onClick={() => run(async () => { await api.humanTodoDone(projectId, t.id); await load(); })}>やりました(この案内を消す)</Button>
            <span className="text-[12px] text-muted">不要な案内も、「やりました」で消せます。書かれている場所: {t.sourceFile}</span>
          </div>
        </Card>
      ))}
    </>
  );
}
