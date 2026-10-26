// A chat page shows an answer as rendered HTML, so reading its text (innerText) loses the headings, lists, tables and code
// blocks the AI wrote in Markdown. This is a small converter that runs INSIDE the page and turns the answer element back
// into Markdown. It is kept as a string (not a function) so that no build step can rewrite it before it reaches the page.
// Backticks are built with String.fromCharCode because this file is itself a template string.

export const HTML_TO_MARKDOWN_JS = String.raw`(root) => {
  const TICK = String.fromCharCode(96);
  const FENCE = TICK + TICK + TICK;
  const SKIP = new Set(["SCRIPT", "STYLE", "BUTTON", "SVG", "SUP", "NOSCRIPT", "TEXTAREA", "INPUT", "IMG", "MAT-ICON", "SOURCE-FOOTNOTE", "SOURCES-CAROUSEL"]);
  const noisy = (e) => {
    if (SKIP.has(e.tagName.toUpperCase())) return true;
    // Gemini marks its citations with their own tags (source-footnote, sources-carousel-inline, source-inline-chip); the TEXT they
    // belong to sits in ordinary elements (some with a class such as "citation-23"), which must stay
    if (/source-?chip|source-footnote|sources|footnote/i.test(e.tagName)) return true;
    const cls = e.getAttribute("class") || "";
    return e.getAttribute("aria-hidden") === "true" || /source-?chip|footnote|copy-?button|code-block-decoration/i.test(cls);
  };
  const LANGS = /^(javascript|typescript|python|html|css|json|bash|shell|sh|sql|java|c|c\+\+|c#|go|rust|ruby|php|yaml|xml|markdown|text|plaintext|jsx|tsx|powershell)$/i;
  const inline = (n) => {
    if (n.nodeType === 3) return n.nodeValue.replace(/\s+/g, " ");
    if (n.nodeType !== 1 || noisy(n)) return "";
    const t = n.tagName.toLowerCase();
    const kids = () => Array.from(n.childNodes).map(inline).join("");
    if (t === "br") return "\n";
    if (t === "strong" || t === "b") { const s = kids().trim(); return s ? "**" + s + "**" : ""; }
    if (t === "em" || t === "i") { const s = kids().trim(); return s ? "*" + s + "*" : ""; }
    if (t === "code") return TICK + n.textContent + TICK;
    if (t === "a") { const s = kids().trim(); const h = n.getAttribute("href") || ""; return s && /^https?:/.test(h) ? "[" + s + "](" + h + ")" : s; }
    return kids();
  };
  const isBlock = (n) => {
    if (n.nodeType !== 1) return false;
    const t = n.tagName.toLowerCase();
    if (/^(p|div|ul|ol|li|h[1-6]|pre|table|blockquote|hr|section|article|header|footer|details|summary|message-content)$/.test(t)) return true;
    // a custom element that wraps a table, a code block, a list or paragraphs (it is "inline" to the browser) is still a block
    if (n.querySelector("table, pre, ul, ol, h1, h2, h3, h4, h5, h6, p, blockquote")) return true;
    const d = getComputedStyle(n).display;
    return !/^(inline|inline-block|contents|none)$/.test(d);
  };
  // the text of a code block without the buttons a page puts inside it ("Copy"); lines that the page lays out as blocks keep their breaks
  const codeText = (e) => {
    let s = "";
    for (const c of Array.from(e.childNodes)) {
      if (c.nodeType === 3) { s += c.nodeValue; continue; }
      if (c.nodeType !== 1) continue;
      if (c.tagName === "BUTTON" || /copy|toolbar/i.test(c.getAttribute("class") || "")) continue;
      if (c.tagName === "BR") { s += "\n"; continue; }
      const inner = codeText(c);
      s += inner;
      if (inner && !inner.endsWith("\n") && /^(block|flex|grid|list-item)$/.test(getComputedStyle(c).display)) s += "\n";
    }
    return s;
  };
  const cellText = (c) => inline(c).replace(/\n/g, " ").replace(/\|/g, "\\|").trim();
  const list = (n, indent) => {
    const ordered = n.tagName.toLowerCase() === "ol";
    let out = "";
    let i = 0;
    for (const li of Array.from(n.children)) {
      if (li.tagName.toLowerCase() !== "li" || noisy(li)) continue;
      i += 1;
      let text = "";
      let nested = "";
      for (const c of Array.from(li.childNodes)) {
        const ct = c.nodeType === 1 ? c.tagName.toLowerCase() : "";
        if (ct === "ul" || ct === "ol") nested += list(c, indent + "  ");
        else if (c.nodeType === 1 && /^(p|div)$/.test(ct)) text += " " + inline(c).trim();
        else text += inline(c);
      }
      out += indent + (ordered ? i + ". " : "- ") + text.replace(/\s+/g, " ").trim() + "\n" + nested;
    }
    return out;
  };
  const table = (n) => {
    const rows = Array.from(n.querySelectorAll("tr")).map((r) => Array.from(r.children).map(cellText));
    if (!rows.length) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const line = (r) => "| " + Array.from({ length: width }, (_, k) => r[k] || "").join(" | ") + " |";
    return [line(rows[0]), "| " + Array.from({ length: width }, () => "---").join(" | ") + " |", ...rows.slice(1).map(line)].join("\n") + "\n\n";
  };
  const block = (n) => {
    if (n.nodeType === 3) { const s = n.nodeValue.replace(/\s+/g, " ").trim(); return s ? s + "\n\n" : ""; }
    if (n.nodeType !== 1 || noisy(n)) return "";
    const t = n.tagName.toLowerCase();
    if (/^h[1-6]$/.test(t)) { const s = inline(n).trim(); return s ? "#".repeat(Number(t[1])) + " " + s + "\n\n" : ""; }
    if (t === "p") { const s = inline(n).trim(); return s ? s + "\n\n" : ""; }
    if (t === "ul" || t === "ol") return list(n, "") + "\n";
    if (t === "pre" && n.querySelector(".monaco-editor .view-line")) {
      // a code block drawn by the Monaco editor (Qwen): one element per line, in order of their vertical position; the language is in the header
      const lines = Array.from(n.querySelectorAll(".view-line")).sort((a, b) => (parseFloat(a.style.top) || 0) - (parseFloat(b.style.top) || 0)).map((l) => (l.textContent || "").replace(/ /g, " "));
      const header = n.querySelector("[class*='code-header'] > div");
      const lang = header ? header.textContent.trim().toLowerCase() : "";
      return FENCE + (/^[a-z0-9+#-]{1,12}$/.test(lang) ? lang : "") + "\n" + lines.join("\n").replace(/\s+$/, "") + "\n" + FENCE + "\n\n";
    }
    if (t === "pre") {
      const code = n.querySelector("code") || n;
      const m = /language-([A-Za-z0-9+#-]+)/.exec((code.getAttribute("class") || "") + " " + (n.getAttribute("class") || ""));
      return FENCE + (m ? m[1] : "") + "\n" + (codeText(code) || code.innerText || code.textContent || "").replace(/\s+$/, "") + "\n" + FENCE + "\n\n";
    }
    if (t === "table") return table(n);
    if (t === "blockquote") return Array.from(n.childNodes).map(block).join("").trim().split("\n").map((l) => "> " + l).join("\n") + "\n\n";
    if (t === "hr") return "---\n\n";
    // a table made of divs in a CSS grid (Mistral): the columns come from the grid, the cells are the children in order
    if (getComputedStyle(n).display === "grid" && !n.querySelector("p, pre, ul, ol, table, h1, h2, h3, h4, h5, h6")) {
      const cols = getComputedStyle(n).gridTemplateColumns.split(" ").filter(Boolean).length;
      const kids = Array.from(n.children);
      if (cols >= 2 && kids.length >= cols * 2 && kids.length % cols === 0) {
        const rows = [];
        for (let r = 0; r < kids.length; r += cols) rows.push(kids.slice(r, r + cols).map((c) => (c.innerText || "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim()));
        const keep = Array.from({ length: cols }, (_, k) => k).filter((k) => rows.some((row) => row[k]));
        if (keep.length >= 2) {
          const line = (row) => "| " + keep.map((k) => row[k]).join(" | ") + " |";
          return [line(rows[0]), "| " + keep.map(() => "---").join(" | ") + " |", ...rows.slice(1).map(line)].join("\n") + "\n\n";
        }
      }
    }
    // a generic container: block children are blocks, the runs of inline content between them are paragraphs
    let out = "";
    let run = "";
    const flush = () => { const s = run.replace(/[ \t]+\n/g, "\n").trim(); if (s) out += s + "\n\n"; run = ""; };
    for (const c of Array.from(n.childNodes)) {
      if (isBlock(c)) { flush(); out += block(c); } else run += inline(c);
    }
    flush();
    return out;
  };
  // a language label that a page prints above a code block ("JavaScript") becomes the language of the fence
  const md = block(root).replace(/\n{3,}/g, "\n\n").trim();
  // the buttons of a code block's header ("Copy", "Download") come out as lines of text too
  const UI = "(?:(?:Copy|Download|Copy code|Run|Edit|コピー|コードをコピー|コードをコピーする|ダウンロード)\\n+)";
  const labelled = new RegExp("(^|\\n)([A-Za-z+#]{1,12})\\n+" + UI + "*(" + FENCE + ")([A-Za-z0-9+#-]*)\\n", "g");
  const bare = new RegExp("(^|\\n)" + UI + "+(" + FENCE + ")", "g");
  return md.replace(labelled, (m, pre, label, fence, lang) => (LANGS.test(label) ? pre + fence + (lang || label.toLowerCase()) + "\n" : m)).replace(bare, "$1$2");
}`;
