import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { SKIP_DIRS } from "./projectImport.ts";

// A browser AI cannot open the project's files. What it gets instead is written into its prompt: the list of files (so it knows what
// exists) and the excerpts of the files the task names (its inputs, or a file whose name the task text mentions).

const CODE_EXTENSIONS = new Set([".md", ".txt", ".json", ".csv", ".html", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".yaml", ".yml", ".toml", ".cs", ".xaml", ".csproj", ".py", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".hpp", ".rb", ".php", ".vue", ".svelte", ".sql"]);
const SECRET_NAME = /(^\.env)|\.(pem|key|pfx|p12)$|secret|credential|id_rsa|password/i;
export const MAX_TREE_FILES = 80;
export const MAX_REF_FILE_CHARS = 5000;
export const MAX_REF_TOTAL_CHARS = 14_000;
const MAX_REF_FILES = 5;

/** Relative paths (forward slashes) of the text files in the project, breadth-first so the top of the tree comes first. */
export function listProjectFiles(root: string, limit = MAX_TREE_FILES * 4): string[] {
  const out: string[] = [];
  const queue: string[] = [""];
  while (queue.length && out.length < limit) {
    const rel = queue.shift()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".github") continue;
      const next = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && next.split("/").length <= 6 && !e.isSymbolicLink()) queue.push(next);
      } else if (e.isFile() && CODE_EXTENSIONS.has(path.extname(e.name).toLowerCase()) && !SECRET_NAME.test(e.name)) {
        out.push(next);
      }
    }
  }
  return out;
}

const STOP_TOKENS = new Set(["true", "false", "null", "this", "that", "with", "from", "have", "will", "task", "file", "files", "docs", "review", "markdown", "design", "json", "code", "work", "done", "only", "none"]);

/** Identifier-like words (ASCII, 4+ chars) in the task text, most specific (longest) first. */
export function identifierTokens(text: string, limit = 8): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]{3,}/g)) {
    const t = m[0];
    if (!STOP_TOKENS.has(t.toLowerCase())) seen.add(t);
  }
  return [...seen].sort((a, b) => b.length - a.length).slice(0, limit);
}

/** Files whose path or content mention the tokens, best first, each with the matching lines (plus 2 lines of context). */
function keywordFiles(root: string, files: string[], tokens: string[], max: number): { rel: string; snippet: string[] }[] {
  const lower = tokens.map((t) => t.toLowerCase());
  const scored: { rel: string; score: number; snippet: string[] }[] = [];
  for (const rel of files) {
    let text: string;
    try {
      const abs = path.join(root, rel);
      if (statSync(abs).size > 500_000) continue;
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const m = matchSnippet(text, lower);
    const score = m.score + lower.filter((t) => rel.toLowerCase().includes(t)).length * 5;
    if (score === 0) continue;
    scored.push({ rel, score, snippet: m.snippet });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max);
}

/** The lines of `text` that mention a token (lower-cased), with 2 lines of context and line numbers; score = number of hits. */
function matchSnippet(text: string, lowerTokens: string[]): { score: number; snippet: string[] } {
  const rows = text.split(/\r?\n/);
  const keep = new Set<number>();
  let score = 0;
  rows.forEach((row, i) => {
    const r = row.toLowerCase();
    const hits = lowerTokens.filter((t) => r.includes(t)).length;
    if (hits) {
      score += hits;
      for (let k = Math.max(0, i - 2); k <= Math.min(rows.length - 1, i + 2); k++) keep.add(k);
    }
  });
  const snippet: string[] = [];
  let prev = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i !== prev + 1) snippet.push("...");
    snippet.push(`${i + 1}: ${rows[i]}`);
    prev = i;
  }
  return { score, snippet };
}

/**
 * Lines to add to a web AI's prompt: the file list, then the files the task refers to. `refs` are paths the task names (its inputs);
 * `texts` are the task's sentences, searched for the names of files that exist. Never reads outside `root`; empty when there is nothing.
 */
export function referenceContext(root: string, refs: string[], texts: string[]): string[] {
  if (!existsSync(root)) return [];
  const files = listProjectFiles(root);
  if (files.length === 0) return [];
  const chosen: string[] = [];
  const add = (rel: string) => {
    if (chosen.length < MAX_REF_FILES && !chosen.includes(rel)) chosen.push(rel);
  };
  const normalised = (s: string) => s.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  for (const r of refs.map(normalised)) {
    if (files.includes(r)) add(r);
    else for (const f of files.filter((x) => x.startsWith(r.endsWith("/") ? r : `${r}/`)).slice(0, 2)) add(f); // a folder: its first files
  }
  const sentence = texts.join("\n");
  for (const f of files) {
    const base = path.basename(f);
    if (base.length >= 6 && sentence.includes(base)) add(f);
  }
  const named = new Set(chosen);
  // Files nobody named: pick the ones whose path or content mention the task's identifiers (e.g. "IsRolledUp", "FenceWindow").
  const tokens = identifierTokens(sentence);
  const keywordHits = new Map<string, string[]>();
  if (tokens.length && chosen.length < MAX_REF_FILES) {
    for (const f of keywordFiles(root, files, tokens, MAX_REF_FILES - chosen.length)) {
      add(f.rel);
      keywordHits.set(f.rel, f.snippet);
    }
  }
  const lines: string[] = ["", `【プロジェクトのファイル一覧(${Math.min(files.length, MAX_TREE_FILES)}件まで)】`, ...files.slice(0, MAX_TREE_FILES)];
  let total = 0;
  const excerpts: string[] = [];
  for (const rel of chosen) {
    if (total >= MAX_REF_TOTAL_CHARS) break;
    try {
      const abs = path.join(root, rel);
      if (!statSync(abs).isFile() || statSync(abs).size > 2_000_000) continue;
      const whole = readFileSync(abs, "utf8");
      // A file too long to show whole: show the lines that mention the task's identifiers instead of its first screenful.
      let snippet = !named.has(rel) ? keywordHits.get(rel) : undefined;
      if (!snippet && whole.length > MAX_REF_FILE_CHARS && tokens.length) {
        const m = matchSnippet(whole, tokens.map((t) => t.toLowerCase()));
        if (m.score > 0) snippet = m.snippet;
      }
      const body = snippet ? snippet.join("\n").slice(0, MAX_REF_FILE_CHARS) : whole.slice(0, MAX_REF_FILE_CHARS);
      total += body.length;
      excerpts.push(`--- ${rel} ---`, body);
    } catch {
      /* unreadable: skip */
    }
  }
  if (excerpts.length) lines.push("", "【参照ファイル(抜粋)】", ...excerpts);
  return lines;
}
