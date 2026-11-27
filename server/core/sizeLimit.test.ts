import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectValidator, sizeLimitReason, statedSizeLimit } from "./taskValidator.ts";
import type { Task } from "./store.ts";

describe("statedSizeLimit", () => {
  it("reads 1行だけ", () => expect(statedSizeLimit("_ai-records/dock-test.md を新規作成し、本文を「指示欄の通し試験」の1行だけにする")).toEqual({ lines: 1 }));
  it("reads 以内 for lines and characters", () => expect(statedSizeLimit("3行以内で、200文字以内にまとめる")).toEqual({ lines: 3, chars: 200 }));
  it("takes the stricter of several", () => expect(statedSizeLimit("5行以内。内容は1行だけ")).toEqual({ lines: 1 }));
  it("a hint without だけ/のみ/以内 is not a rule", () => expect(statedSizeLimit("結果を3行で要約する")).toBeNull());
  it("a limit on each part is not a limit on the file", () => expect(statedSizeLimit("各項目は1行だけで書く")).toBeNull());
  it("a limit on what is added is not a limit on the file", () => {
    expect(statedSizeLimit("max 関数の使い方を2行だけ追記する")).toBeNull();
    expect(statedSizeLimit("README.md に使い方を3行まで足して")).toBeNull();
  });
  it("nothing stated, nothing fixed", () => expect(statedSizeLimit("設計書を書く")).toBeNull());
});

describe("sizeLimitReason", () => {
  it("passes one line", () => expect(sizeLimitReason("指示欄の通し試験\n", { lines: 1 })).toBeNull());
  it("ignores empty lines and code fence marks", () => expect(sizeLimitReason("\n```\n確認OK\n```\n\n", { lines: 1 })).toBeNull());
  it("fails a long file", () => expect(sizeLimitReason("a\nb\nc\n", { lines: 1 })).toContain("3行あります"));
  it("fails too many characters", () => expect(sizeLimitReason("あ".repeat(30), { chars: 20 })).toContain("30文字"));
});

describe("ProjectValidator size limit", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), "size-limit-")); });
  afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }));
  const task = (over: Partial<Task> = {}) => ({ id: "t1", projectId: "p1", role: "document", objective: "_ai-records/dock-test.md を作り、本文を「試験」の1行だけにする", constraints: [], expectedOutputs: ["_ai-records/dock-test.md"], ...over }) as Task;
  const put = (text: string) => { const f = path.join(root, "p1", "_ai-records", "dock-test.md"); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };

  it("sends back a file that holds the whole prompt instead of one line", async () => {
    put("あなたは…\n役割: document\n目的: x\n【回答の形式】\n本文だけ返してください\n");
    const r = await new ProjectValidator(root).validate(task(), { artifacts: ["_ai-records/dock-test.md"] } as never);
    expect(r.passed).toBe(false);
    expect(r.detail).toContain("1行以内");
  });
  it("accepts one line", async () => {
    put("試験\n");
    expect((await new ProjectValidator(root).validate(task(), { artifacts: ["_ai-records/dock-test.md"] } as never)).passed).toBe(true);
  });
  it("does not limit a task that states no size", async () => {
    put("a\nb\nc\n");
    expect((await new ProjectValidator(root).validate(task({ objective: "メモを書く" }), { artifacts: [] } as never)).passed).toBe(true);
  });
});
