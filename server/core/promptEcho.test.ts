import { describe, expect, it } from "vitest";
import { isPromptEcho } from "./browserDriver.js";

const prompt = "あなたはソフトウェア開発依頼「試験」の次の作業を担当します。\n役割: document\n目的: dock-test.md を作る\n\n【回答の形式】\n回答の本文がそのまま保存されます。";

describe("isPromptEcho", () => {
  it("the page showing the whole prompt is an echo", () => expect(isPromptEcho(prompt, prompt)).toBe(true));
  it("white space differences do not hide it", () => expect(isPromptEcho(prompt.replace(/\n/g, "  \n "), prompt)).toBe(true));
  it("the start of the prompt (still being drawn) is an echo", () => expect(isPromptEcho(prompt.slice(0, 80), prompt)).toBe(true));
  it("a long piece from inside the prompt is an echo", () => expect(isPromptEcho("役割: document 目的: dock-test.md を作る 【回答の形式】", prompt)).toBe(true));
  it("a real answer is not", () => expect(isPromptEcho("指示欄の通し試験", prompt)).toBe(false));
  it("a long real answer that mentions the task is not", () => expect(isPromptEcho("# dock-test.md\n\nこのファイルは、指示欄の通し試験のために作りました。内容は次のとおりです。", prompt)).toBe(false));
  it("short texts are never called echoes", () => expect(isPromptEcho("あなたは", prompt)).toBe(false));
});
