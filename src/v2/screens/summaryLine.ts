import { aiNameOf, type Ctx } from "../context";
import { roleLabel } from "../labels";
import type { Task, TaskStatus } from "../types";

/** One sentence on where the request stands, so the screen can be read without opening any row. */
export function summaryLine(tasks: Task[], ctx: Ctx, resting = false): string {
  const by = (st: TaskStatus) => tasks.filter((t) => t.status === st);
  const failed = [...by("failed"), ...by("blocked")];
  if (failed.length > 0) return `うまくいかなかった作業が${failed.length}件あります。下の赤い印の作業を開くと理由が見られます(ホームの「次にやること」にも出ます)。`;
  const waiting = by("waiting");
  if (waiting.length > 0) return `「${roleLabel(waiting[0].role)}」があなたの操作を待っています。ホームの「次にやること」を見てください。`;
  const running = by("running");
  if (running.length > 0 && resting) return `「${roleLabel(running[0].role)}」は、使えるAIが戻るのを待っています(自動で再開します)。`;
  if (running.length > 0) return `いま「${roleLabel(running[0].role)}」を ${aiNameOf(ctx.services, running[0].selectedAi)} が進めています。`;
  if (tasks.length > 0 && tasks.every((t) => t.status === "completed" || t.status === "cancelled")) return "すべての作業が終わりました。「できたもの」で結果を読めます。";
  return "次の作業の開始を待っています。";
}
