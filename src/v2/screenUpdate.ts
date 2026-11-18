/** The screen (the built JavaScript) can change while a tab stays open: an old tab keeps old wording and old behaviour until it is reloaded. */

/** The built entry script's file name ("index-s5IUbJlY.js") in an index.html text or a script src, or null. */
export function bundleName(html: string): string | null {
  return /\/assets\/(index-[\w-]+\.js)/.exec(html)?.[1] ?? null;
}

/** Is the open screen older than the one the server serves now? (Unknown on either side means "no": never reload on a guess.) */
export function isScreenOutdated(running: string | null, served: string | null): boolean {
  return !!running && !!served && running !== served;
}

/** Reloading throws away what was typed and not yet sent, so it only happens by itself when nothing is being written. */
export function canReloadNow(doc: Pick<Document, "activeElement" | "querySelectorAll">): boolean {
  const a = doc.activeElement as HTMLElement | null;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
  for (const el of Array.from(doc.querySelectorAll("textarea, input[type=text], input:not([type])")) as (HTMLInputElement | HTMLTextAreaElement)[]) {
    if (el.value && el.value.trim() !== "") return false;
  }
  return true;
}
