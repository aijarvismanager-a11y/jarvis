import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { SKIP_DIRS } from "./projectImport.ts";

// A browser AI cannot open the project's files. What it gets instead is written into its prompt: the list of files (so it knows what
// exists) and the excerpts of the files the task names (its inputs, or a file whose name the task text mentions).

const CODE_EXTENSIONS = new Set([".md", ".txt", ".json", ".csv", ".html", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".yaml", ".yml", ".toml", ".cs", ".xaml", ".csproj", ".py", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".hpp", ".rb", ".php", ".vue", ".svelte", ".sql"]);
const SECRET_NAME = /(^\.env)|\.(pem|key|pfx|p12)$|secret|credential|id_rsa|password/i;
export const MAX_TREE_FILES = 80;
export const MAX_REF_FILE_CHARS = 12_000;
export const MAX_REF_TOTAL_CHARS = 30_000;
const MAX_REF_FILES = 6;

/** How many characters of project files each site takes in one prompt (its box and context differ a lot; a cautious default for unlisted ones). */
const REFERENCE_BUDGET: Record<string, number> = { "claude-web": 100_000, gemini: 100_000, chatgpt: 40_000, grok: 40_000, copilot: 6_000 };
export const referenceBudget = (aiId?: string | null) => (aiId && REFERENCE_BUDGET[aiId]) || MAX_REF_TOTAL_CHARS;

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

const MAX_BLOCK_LINES = 400;

/**
 * The method/block a line belongs to, found by indentation; 2 lines either side when no block is found or it is over MAX_BLOCK_LINES.
 * A line that opens a block itself (`void Foo()` followed by `{` at the same indent, or ending in `{`) is that block's own header: the
 * whole body is taken, not the class around it. Any other line takes the block it sits in (header = the nearest line indented less).
 */
function enclosingBlock(rows: string[], i: number): [number, number] {
  const fallback: [number, number] = [Math.max(0, i - 2), Math.min(rows.length - 1, i + 2)];
  const indent = (r: string) => r.length - r.trimStart().length;
  if (!rows[i].trim()) return fallback;
  const here = indent(rows[i]);
  const closeFrom = (start: number, level: number): number => {
    let end = start;
    while (end < rows.length && (!rows[end].trim() || indent(rows[end]) > level)) end++;
    return Math.min(end, rows.length - 1); // the closing line (indent == level) is included
  };
  let next = i + 1;
  while (next < rows.length && !rows[next].trim()) next++;
  const opensOwn = rows[i].trimEnd().endsWith("{") || (next < rows.length && rows[next].trim() === "{" && indent(rows[next]) === here);
  if (opensOwn) {
    const end = closeFrom(next < rows.length && rows[i].trimEnd().endsWith("{") === false ? next + 1 : i + 1, here);
    if (end - i <= MAX_BLOCK_LINES) return [Math.min(i, fallback[0]), Math.max(end, fallback[1])];
    return fallback;
  }
  let h = i - 1;
  while (h >= 0 && i - h <= MAX_BLOCK_LINES && (!rows[h].trim() || indent(rows[h]) >= here)) h--;
  if (h < 0 || i - h > MAX_BLOCK_LINES) return fallback;
  const head = indent(rows[h]);
  const end = closeFrom(i + 1, head);
  const from = rows[h].trim() === "{" ? Math.max(0, h - 1) : h;
  if (end - from > MAX_BLOCK_LINES) return fallback;
  return [Math.min(from, fallback[0]), Math.max(end, fallback[1])];
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
      const [from, to] = enclosingBlock(rows, i);
      for (let k = from; k <= to; k++) keep.add(k);
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
export function referenceContext(root: string, refs: string[], texts: string[], budget = MAX_REF_TOTAL_CHARS): string[] {
  const perFile = Math.min(budget, Math.max(MAX_REF_FILE_CHARS, Math.floor(budget / 2)));
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
    if (total >= budget) break;
    try {
      const abs = path.join(root, rel);
      if (!statSync(abs).isFile() || statSync(abs).size > 2_000_000) continue;
      const whole = readFileSync(abs, "utf8");
      // A file too long to show whole: show the lines that mention the task's identifiers instead of its first screenful.
      let snippet = !named.has(rel) ? keywordHits.get(rel) : undefined;
      if (!snippet && whole.length > perFile && tokens.length) {
        const m = matchSnippet(whole, tokens.map((t) => t.toLowerCase()));
        if (m.score > 0) snippet = m.snippet;
      }
      const body = snippet ? snippet.join("\n").slice(0, perFile) : whole.slice(0, perFile);
      total += body.length;
      excerpts.push(`--- ${rel} ---`, body);
    } catch {
      /* unreadable: skip */
    }
  }
  if (excerpts.length) lines.push("", "【参照ファイル(抜粋)】", ...excerpts);
  return lines;
}
