import type { api } from "./api";

type Imported = Awaited<ReturnType<typeof api.importProject>>;
type Weight = { name: string; bytes: number };

export type ImportNote = { summary: string; /** what was not copied, by name */ left: string[] };

/** The result of an import, in words, with the names of everything that was left behind. */
export function importNote(r: Imported): ImportNote {
  if (r.existing) return { summary: `このフォルダは取り込み済みです。「${r.project.name}」を開きました(コピーは増やしません)`, left: [] };
  const kinds: [string, string[]][] = [
    ["除くと選んだフォルダ", r.excluded ?? []],
    ["作り直せるフォルダ", r.skippedDirs ?? []],
    ["パスワードや鍵が入りうるファイル", r.skippedSecrets],
    ["記録ファイルなど", r.skippedOther ?? []],
  ];
  const history = r.history ? (r.history.ok ? `。会話履歴(${r.history.sessions}セッション)を要約して引き継ぎました` : `。会話履歴の引き継ぎはできませんでした(${r.history.error})`) : "";
  return { summary: `${r.files}ファイルを取り込みました${history}`, left: kinds.filter(([, names]) => names.length > 0).map(([kind, names]) => `${kind}(${names.length}件): ${names.join("、")}`) };
}

/** What stays ticked after a try that was still too large: everything chosen before, plus the obviously heavy ones. */
export function nextLeaveOut(chosen: string[], folders: Weight[]): Set<string> {
  const heavy = folders.filter((f, i) => i < 3 && f.bytes > 20 * 1024 ** 2 && !f.name.startsWith("(")).map((f) => f.name);
  return new Set([...chosen, ...heavy]);
}
