// Looks at an AI site in the automation browser profile (the one with the person's sign-ins) so a site profile can be written
// or re-checked from facts, not guesses. Run from the repository folder:
//
//   npm run probe:site -- <aiId>                                 look only: inputs, buttons, pictures, a screenshot
//   npm run probe:site -- <aiId> --send "prompt" --yes           type the prompt, send it, read the answer (SPENDS FREE ALLOWANCE)
//   npm run probe:site -- <aiId> --send "prompt" --images --yes  the same, waiting for pictures instead of text
//
// Options: --url <address> (default: the service's page), --out <folder> (default: a temp folder), --wait <seconds> before looking.
// The server must not be driving the same profile at that moment (a sign-in window or a running task): the script says so and stops.
// The browser is always shut down at the end, and the script waits until the profile is free again.
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUILT_IN_WEB_AIS } from "../server/core/aiRegistry.ts";
import { ChromiumDriver, findBrowserExecutable, WebAiProfileBusyError } from "../server/core/browserDriver.ts";
import { BUNDLED_SITE_PROFILES, type SiteProfile } from "../server/core/webAiSites.ts";

const args = process.argv.slice(2);
const aiId = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);

if (!aiId) {
  console.error('使い方: npm run probe:site -- <aiId> [--send "prompt" [--images] --yes] [--url <address>] [--out <folder>] [--wait <seconds>]');
  process.exit(2);
}
const service = BUILT_IN_WEB_AIS.find((s) => s.id === aiId);
const url = opt("url") ?? service?.url;
if (!url) {
  console.error(`「${aiId}」のページが分かりません。--url で指定してください。`);
  process.exit(2);
}
const prompt = opt("send");
if (prompt && !flag("yes")) {
  console.error("--send は、サイトの無料枠を使います。実行するなら --yes を付けてください。");
  process.exit(2);
}
const executable = findBrowserExecutable();
if (!executable) {
  console.error("Edge・Chrome・Braveが見つかりません。");
  process.exit(1);
}
const out = opt("out") ?? path.join(os.tmpdir(), "probe-site");
mkdirSync(out, { recursive: true });
const wait = Number(opt("wait") ?? 8) * 1000;

const driver = new ChromiumDriver({ executable, profileDir: path.join(process.cwd(), "data", "browser-profile") });
const bundled: SiteProfile | undefined = BUNDLED_SITE_PROFILES[aiId];
// Without a profile, "body" only proves the page opens; the look-around below is what tells which selectors to write.
const site: SiteProfile = bundled ?? { inputSelector: "body", responseSelector: "body" };

try {
  const page = (await driver.open({ url, site })) as unknown as {
    cdp: { evaluate<T>(expr: string): Promise<T>; send(method: string, params?: object): Promise<{ data: string }> };
    fillPrompt(t: string): Promise<void>;
    submit(): Promise<void>;
    waitForResponse(o: { timeoutMs: number }): Promise<string>;
    waitForImages?(o: { timeoutMs: number }): Promise<void>;
    readImages?(): Promise<{ mime: string; base64: string }[]>;
  };
  console.log(`開きました: ${url}${bundled ? "(同梱のサイト設定を使用)" : "(サイト設定なし)"}`);
  await new Promise((r) => setTimeout(r, wait));
  const look = await page.cdp.evaluate<unknown>(`(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return {
      url: location.href,
      title: document.title,
      textareas: [...document.querySelectorAll('textarea')].filter(vis).map((e) => ({ placeholder: e.placeholder, id: e.id, ariaHidden: e.getAttribute('aria-hidden'), cls: String(e.className).slice(0, 50) })),
      editable: [...document.querySelectorAll('[contenteditable="true"]')].filter(vis).map((e) => ({ role: e.getAttribute('role'), cls: String(e.className).slice(0, 50) })),
      buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40)).filter(Boolean).slice(0, 40),
      pictures: [...document.images].filter((i) => i.naturalWidth >= 200).map((i) => ({ size: i.naturalWidth + 'x' + i.naturalHeight, inLink: !!i.closest('a'), src: i.src.slice(-50) })).slice(0, 12),
      text: document.body.innerText.slice(0, 300),
    };
  })()`);
  console.log(JSON.stringify(look, null, 1));
  const shot = async (name: string) => {
    const s = await page.cdp.send("Page.captureScreenshot", { format: "png" });
    const file = path.join(out, name);
    writeFileSync(file, Buffer.from(s.data, "base64"));
    console.log(`画面の写真: ${file}`);
  };
  await shot(`${aiId}-look.png`);

  if (prompt) {
    if (!bundled) throw new Error("サイト設定がないので、送信できません。先に webAiSites.ts に書いてください。");
    await page.fillPrompt(prompt);
    await page.submit();
    console.log("送信しました");
    if (flag("images")) {
      await page.waitForImages!({ timeoutMs: 150_000 });
      const pics = await page.readImages!();
      pics.forEach((p, k) => {
        const file = path.join(out, `${aiId}-pic${k}.png`);
        writeFileSync(file, Buffer.from(p.base64, "base64"));
        console.log(`画像${k}: ${file}(${p.base64.length} 文字)`);
      });
      if (pics.length === 0) console.log("画像は取れませんでした");
    } else {
      console.log("答え:", (await page.waitForResponse({ timeoutMs: 150_000 })).slice(0, 500));
    }
    await shot(`${aiId}-after.png`);
  }
} catch (err) {
  console.error(err instanceof WebAiProfileBusyError ? `${err.message}` : `失敗: ${String(err)}`);
  process.exitCode = 1;
} finally {
  await driver.shutdown();
  process.exit(process.exitCode ?? 0);
}
