import { aiNameOf, type Ctx } from "../context";
import { isRefusedNote, roleLabel } from "../labels";
import type { Task, TaskStatus } from "../types";

/** One sentence on where the request stands, so the screen can be read without opening any row. */
export function summaryLine(tasks: Task[], ctx: Ctx, resting = false): string {
  const by = (st: TaskStatus) => tasks.filter((t) => t.status === st);
  const failed = [...by("failed"), ...by("blocked")];
  const refused = by("failed").filter((t) => isRefusedNote(ctx.overview?.taskNotes?.[t.id]));
  if (refused.length > 0 && refused.length === by("failed").length) return `あなたが許可しなかった作業があるため、ここで止まっています。許可しなかった作業は行っていません(後ろの作業${by("blocked").length + by("pending").length}件も進みません)。`;
  if (failed.length > 0) return `うまくいかなかった作業が${failed.length}件あります。赤くなっている作業に理由が出ます(ホームの「次にやること」にも出ます)。`;
  const waiting = by("waiting");
  if (waiting.length > 0) return `「${roleLabel(waiting[0].role)}」があなたの操作を待っています。ホームの「次にやること」を見てください。`;
  const running = by("running");
  const asked = ctx.approvals.filter((a) => tasks.some((t) => t.id === a.taskId));
  if (asked.length > 0) return `「${roleLabel(tasks.find((t) => t.id === asked[0].taskId)?.role ?? "")}」は、あなたの許可を待っています。画面の上の「許可して続ける」か「拒否する」を押してください。`;
  if (running.length > 0 && resting) return `「${roleLabel(running[0].role)}」は、使えるAIが戻るのを待っています(自動で再開します)。`;
  if (running.length > 0) return `いま「${roleLabel(running[0].role)}」を ${aiNameOf(ctx.services, running[0].selectedAi)} が進めています。`;
  const cancelled = by("cancelled");
  if (cancelled.length > 0 && cancelled.length < tasks.length && tasks.every((t) => t.status === "completed" || t.status === "cancelled")) return `途中で中止したため、${tasks.length - cancelled.length}件の作業だけが終わっています(残り${cancelled.length}件は行っていません)。`;
  if (tasks.length > 0 && tasks.every((t) => t.status === "completed" || t.status === "cancelled")) return "すべての作業が終わりました。「できたもの」で結果を読めます。";
  return "次の作業の開始を待っています。";
}
