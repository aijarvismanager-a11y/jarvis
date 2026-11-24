// 固定テスト(15件)。作る側には見せない。使い方: BENCH_APP_DIR=<完成品のフォルダ> node --test benchmark/timer-memo/hidden-tests
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const appDir = process.env.BENCH_APP_DIR;
if (!appDir) throw new Error("BENCH_APP_DIR に完成品のフォルダを指定してください");
const { createStore } = await import(pathToFileURL(path.resolve(appDir, "src", "core.mjs")).href);
const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), "memo-")), "memos.json");

test("01 追加すると決められた形のメモが返る", () => {
  const m = createStore(tmpFile()).add({ text: "牛乳" });
  assert.equal(m.text, "牛乳");
  assert.equal(typeof m.id, "string");
  assert.ok(m.id.length > 0);
  assert.equal(m.remindAt, null);
  assert.equal(m.notified, false);
  assert.ok(!Number.isNaN(Date.parse(m.createdAt)));
});
test("02 本文の前後の空白は取り除かれる", () => {
  assert.equal(createStore(tmpFile()).add({ text: "  あいう \n" }).text, "あいう");
});
test("03 空の本文・空白だけの本文は例外", () => {
  const s = createStore(tmpFile());
  assert.throws(() => s.add({ text: "" }));
  assert.throws(() => s.add({ text: "   \n " }));
  assert.equal(s.list().length, 0);
});
test("04 200文字は通り、201文字は例外", () => {
  const s = createStore(tmpFile());
  assert.equal(s.add({ text: "あ".repeat(200) }).text.length, 200);
  assert.throws(() => s.add({ text: "あ".repeat(201) }));
});
test("05 通知時刻: 文字列とDateが受け付けられ、ISO文字列で残る。読めない文字列は例外", () => {
  const s = createStore(tmpFile());
  const a = s.add({ text: "a", remindAt: "2030-01-02T03:04:05.000Z" });
  assert.equal(a.remindAt, "2030-01-02T03:04:05.000Z");
  const b = s.add({ text: "b", remindAt: new Date("2031-05-06T07:08:09.000Z") });
  assert.equal(b.remindAt, "2031-05-06T07:08:09.000Z");
  assert.throws(() => s.add({ text: "c", remindAt: "あした" }));
});
test("06 idは重ならない", () => {
  const s = createStore(tmpFile());
  const ids = new Set(Array.from({ length: 50 }, (_, i) => s.add({ text: `m${i}` }).id));
  assert.equal(ids.size, 50);
});
test("07 一覧は追加した順(古い順)", () => {
  const s = createStore(tmpFile());
  for (const t of ["1", "2", "3"]) s.add({ text: t });
  assert.deepEqual(s.list().map((m) => m.text), ["1", "2", "3"]);
});
test("08 返した一覧を書き換えても中身は変わらない", () => {
  const s = createStore(tmpFile());
  s.add({ text: "x" });
  const l = s.list();
  l.length = 0;
  assert.equal(s.list().length, 1);
  const first = s.list()[0];
  first.text = "改ざん";
  assert.equal(s.list()[0].text, "x");
});
test("09 削除: 消せたらtrue、無いidはfalse", () => {
  const s = createStore(tmpFile());
  const m = s.add({ text: "x" });
  assert.equal(s.remove(m.id), true);
  assert.equal(s.remove(m.id), false);
  assert.equal(s.remove("no-such-id"), false);
  assert.equal(s.list().length, 0);
});
test("10 追加と削除は、作り直したストアにも残る(保存)", () => {
  const f = tmpFile();
  const s = createStore(f);
  const a = s.add({ text: "a", remindAt: "2030-01-01T00:00:00.000Z" });
  const b = s.add({ text: "b" });
  s.remove(b.id);
  const again = createStore(f).list();
  assert.equal(again.length, 1);
  assert.equal(again[0].id, a.id);
  assert.equal(again[0].remindAt, "2030-01-01T00:00:00.000Z");
});
test("11 ファイルが無ければ空で始まる", () => {
  assert.deepEqual(createStore(tmpFile()).list(), []);
});
test("12 壊れたファイルは例外なしで空になり、.corruptに残る", () => {
  const f = tmpFile();
  writeFileSync(f, "{ 壊れた", "utf-8");
  const s = createStore(f);
  assert.deepEqual(s.list(), []);
  assert.ok(existsSync(`${f}.corrupt`));
  assert.equal(readFileSync(`${f}.corrupt`, "utf-8"), "{ 壊れた");
  s.add({ text: "ok" });
  assert.equal(createStore(f).list().length, 1);
});
test("13 due: 時刻が来た未通知のメモだけを返す(ちょうどの時刻も含む)", () => {
  const s = createStore(tmpFile());
  const past = s.add({ text: "past", remindAt: "2030-01-01T00:00:00.000Z" });
  const exact = s.add({ text: "exact", remindAt: "2030-01-01T12:00:00.000Z" });
  s.add({ text: "future", remindAt: "2030-01-02T00:00:00.000Z" });
  s.add({ text: "none" });
  const ids = s.due(new Date("2030-01-01T12:00:00.000Z")).map((m) => m.id).sort();
  assert.deepEqual(ids, [past.id, exact.id].sort());
});
test("14 markNotified: 1回だけ知らせる。保存もされる", () => {
  const f = tmpFile();
  const s = createStore(f);
  const m = s.add({ text: "x", remindAt: "2030-01-01T00:00:00.000Z" });
  const now = new Date("2030-01-01T00:00:01.000Z");
  assert.equal(s.due(now).length, 1);
  assert.equal(s.markNotified(m.id), true);
  assert.equal(s.due(now).length, 0);
  assert.equal(createStore(f).due(now).length, 0);
  assert.equal(createStore(f).list()[0].notified, true);
});
test("15 markNotified: 無いidはfalse。削除したメモはdueに出ない", () => {
  const s = createStore(tmpFile());
  assert.equal(s.markNotified("no-such-id"), false);
  const m = s.add({ text: "x", remindAt: "2030-01-01T00:00:00.000Z" });
  s.remove(m.id);
  assert.equal(s.due(new Date("2031-01-01T00:00:00.000Z")).length, 0);
});
