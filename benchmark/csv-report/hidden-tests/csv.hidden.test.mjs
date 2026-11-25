// 固定テスト。使い方: BENCH_APP_DIR=<完成品のフォルダ> node --test benchmark/csv-report/hidden-tests
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const appDir = process.env.BENCH_APP_DIR;
if (!appDir) throw new Error("BENCH_APP_DIR に完成品のフォルダを指定してください");
const imp = (f) => import(pathToFileURL(path.resolve(appDir, f)).href);
const { parseCsv } = await imp("src/parse.mjs");
const { summarize } = await imp("src/stats.mjs");
const { toMarkdownTable } = await imp("src/format.mjs");

test("01 parse: 基本", () => assert.deepEqual(parseCsv("a,b\n1,2\n3,4\n"), [{ a: "1", b: "2" }, { a: "3", b: "4" }]));
test("02 parse: CRLFと最後の改行なし", () => assert.deepEqual(parseCsv("a,b\r\n1,2\r\n3,4"), [{ a: "1", b: "2" }, { a: "3", b: "4" }]));
test("03 parse: 引用符の中のカンマ・改行・二重引用符", () =>
  assert.deepEqual(parseCsv('a,b\n"x,y","l1\nl2"\n"say ""hi""",z\n'), [{ a: "x,y", b: "l1\nl2" }, { a: 'say "hi"', b: "z" }]));
test("04 parse: 空行は読みとばす", () => assert.deepEqual(parseCsv("a\n1\n\n2\n"), [{ a: "1" }, { a: "2" }]));
test("05 parse: 足りない値は空文字、多い値は捨てる", () => assert.deepEqual(parseCsv("a,b,c\n1,2\n1,2,3,4\n"), [{ a: "1", b: "2", c: "" }, { a: "1", b: "2", c: "3" }]));
test("06 parse: 空・列名だけは空配列", () => { assert.deepEqual(parseCsv(""), []); assert.deepEqual(parseCsv("a,b\n"), []); });

const rows = [
  { g: "b", v: "10" }, { g: "a", v: "1" }, { g: "b", v: "20" }, { g: "a", v: " 2 " }, { g: "a", v: "abc" }, { g: "c", v: "" }, { g: "a", v: "3" },
];
test("07 summarize: グループ・並び・集計", () => {
  const r = summarize(rows, { groupBy: "g", valueKey: "v" });
  assert.deepEqual(r.groups, [
    { key: "a", count: 3, sum: 6, avg: 2, min: 1, max: 3 },
    { key: "b", count: 2, sum: 30, avg: 15, min: 10, max: 20 },
  ]);
});
test("08 summarize: skipped を数え、数値が無いグループは出さない", () => {
  const r = summarize(rows, { groupBy: "g", valueKey: "v" });
  assert.equal(r.skipped, 2);
  assert.equal(r.groups.some((g) => g.key === "c"), false);
});
test("09 summarize: avg は丸めない", () => {
  const r = summarize([{ g: "x", v: "1" }, { g: "x", v: "1" }, { g: "x", v: "1.5" }].map((o) => o), { groupBy: "g", valueKey: "v" });
  assert.equal(r.groups[0].avg, 3.5 / 3);
});
test("10 summarize: 負の数と小数と最小最大", () => {
  const r = summarize([{ g: "x", v: "-5" }, { g: "x", v: "2.5" }], { groupBy: "g", valueKey: "v" });
  assert.deepEqual(r.groups[0], { key: "x", count: 2, sum: -2.5, avg: -1.25, min: -5, max: 2.5 });
});
test("11 summarize: 空は {groups:[], skipped:0}", () => assert.deepEqual(summarize([], { groupBy: "g", valueKey: "v" }), { groups: [], skipped: 0 }));
test("12 summarize: キーは文字列の昇順(大文字が先)", () => {
  const r = summarize([{ g: "b", v: "1" }, { g: "B", v: "1" }, { g: "a", v: "1" }], { groupBy: "g", valueKey: "v" });
  assert.deepEqual(r.groups.map((g) => g.key), ["B", "a", "b"]);
});

test("13 format: 表の形と avg の丸め", () => {
  const groups = [{ key: "a", count: 3, sum: 10, avg: 10 / 3, min: 1, max: 5 }, { key: "b", count: 2, sum: 5, avg: 2.5, min: 2, max: 3 }, { key: "c", count: 1, sum: 15, avg: 15, min: 15, max: 15 }];
  assert.equal(toMarkdownTable(groups, "team"),
    "| team | count | sum | avg | min | max |\n|---|---|---|---|---|---|\n| a | 3 | 10 | 3.33 | 1 | 5 |\n| b | 2 | 5 | 2.5 | 2 | 3 |\n| c | 1 | 15 | 15 | 15 | 15 |");
});
test("14 format: 既定の見出しと空のグループ", () => assert.equal(toMarkdownTable([]), "| key | count | sum | avg | min | max |\n|---|---|---|---|---|---|"));

const dir = mkdtempSync(path.join(tmpdir(), "csvbench-"));
const csv = path.join(dir, "d.csv");
writeFileSync(csv, "team,pts\nb,10\na,1\nb,20\na,x\n", "utf8");
const run = (...args) => spawnSync(process.execPath, [path.resolve(appDir, "src/cli.mjs"), ...args], { encoding: "utf8" });
test("15 cli: 集計して表を出す(skipped つき)", () => {
  const r = run(csv, "--group", "team", "--value", "pts");
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "| team | count | sum | avg | min | max |\n|---|---|---|---|---|---|\n| a | 1 | 1 | 1 | 1 | 1 |\n| b | 2 | 30 | 15 | 10 | 20 |\nskipped: 1\n");
});
test("16 cli: 引数の順番が違っても動く", () => {
  const r = run("--value", "pts", "--group", "team", csv);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\| b \| 2 \| 30 \| 15 \| 10 \| 20 \|/);
});
test("17 cli: ファイルが無い", () => {
  const r = run(path.join(dir, "none.csv"), "--group", "team", "--value", "pts");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ファイルが見つかりません/);
});
test("18 cli: 列が無い", () => {
  const r = run(csv, "--group", "nothing", "--value", "pts");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /列が見つかりません: nothing/);
});
test("19 cli: 引数が足りない", () => {
  const r = run(csv, "--group", "team");
  assert.equal(r.status, 2);
  assert.ok(r.stderr.length > 0);
});
