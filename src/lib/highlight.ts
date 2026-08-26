import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

type Highlighter = Awaited<ReturnType<typeof createHighlighterCore>>;

let highlighterPromise: Promise<Highlighter> | null = null;

const THEME = "github-dark";

// Fine-grained bundle: static imports of only the languages/theme we need,
// plus the pure-JS regex engine (no oniguruma wasm), so the bundler only
// pulls in what this app actually uses instead of shiki's full ~180-grammar
// convenience bundle.
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import("shiki/themes/github-dark.mjs"),
      import("shiki/langs/typescript.mjs"),
      import("shiki/langs/tsx.mjs"),
      import("shiki/langs/javascript.mjs"),
      import("shiki/langs/jsx.mjs"),
      import("shiki/langs/json.mjs"),
      import("shiki/langs/bash.mjs"),
      import("shiki/langs/python.mjs"),
      import("shiki/langs/html.mjs"),
      import("shiki/langs/css.mjs"),
      import("shiki/langs/yaml.mjs"),
    ]).then(([theme, ...langs]) =>
      createHighlighterCore({
        themes: [theme.default],
        langs: langs.map((l) => l.default),
        engine: createJavaScriptRegexEngine(),
      }),
    );
  }
  return highlighterPromise;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  sh: "bash",
  bash: "bash",
  py: "python",
  html: "html",
  css: "css",
  yml: "yaml",
  yaml: "yaml",
};

export function langForPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return EXT_TO_LANG[ext] ?? null;
}

export async function highlightCode(code: string, path: string): Promise<string | null> {
  const lang = langForPath(path);
  if (!lang) return null;
  try {
    const highlighter = await getHighlighter();
    return highlighter.codeToHtml(code, { lang, theme: THEME });
  } catch {
    return null;
  }
}
