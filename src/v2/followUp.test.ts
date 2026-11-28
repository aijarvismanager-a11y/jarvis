import { describe, expect, it } from "vitest";
import { condenseAnswers, shortGoal } from "./labels";

describe("shortGoal for a follow-up request", () => {
  const goal = "これまでの回答について、次の確認への答えを反映して、やり直し・修正してください:\n質問: 確認の優先順位は?\n答え: レイアウト順が先で良い\n質問: 直す?\n答え: 直して\n\n【これまでの回答(要点)】\n【作業1:技術調査】\n本文";
  it("shows what was decided instead of the same fixed sentence every time", () => {
    const s = shortGoal(goal);
    expect(s.head).toBe("前回の回答への続き: レイアウト順が先で良い");
    expect(s.long).toBe(true);
  });
  it("leaves an ordinary request alone", () => {
    expect(shortGoal("電卓を作って")).toEqual({ head: "電卓を作って", long: false });
  });
});

describe("condenseAnswers", () => {
  const part = (n: number, len: number) => `【作業${n}:調査】\n${"あいうえお。".repeat(Math.ceil(len / 6))}`;
  it("keeps short answers whole", () => {
    expect(condenseAnswers("【作業1:調査】\n短い", 2200)).toBe("【作業1:調査】\n短い");
  });
  it("gives every task a share, so a long first answer does not push the later ones out", () => {
    const out = condenseAnswers([part(1, 5000), part(2, 5000), part(3, 5000)].join("\n\n"), 2200);
    expect(out).toContain("【作業1:");
    expect(out).toContain("【作業2:");
    expect(out).toContain("【作業3:");
    expect(out.length).toBeLessThan(2400);
  });
  it("cuts at a sentence end, not in the middle of a word", () => {
    const out = condenseAnswers([part(1, 5000), part(2, 5000)].join("\n\n"), 1000);
    for (const p of out.split("\n\n")) expect(p.replace("…(以下略)", "").endsWith("。")).toBe(true);
  });
});

import { taskTitle } from "./labels";
describe("taskTitle", () => {
  it("gives the real technical task wordings a plain short name", () => {
    expect(taskTitle("capture.ps1 -Action Start を実行する前に、%APPDATA%\HyperPlayer\settings.json の SHA256 を取得して数値のまま記録する")).toBe("設定ファイルの控えを取る");
    expect(taskTitle("capture.ps1 -Action Start で 1000x600 に起動し、プレイヤーのサイトモードで YouTube などのページを読み込ませる")).toBe("アプリを起動して画面を撮る");
    expect(taskTitle("capture.ps1 -Action Stop と -Action Status を実行して settings.json の復元を確かめる")).toBe("終了と設定の復元を確かめる");
    expect(taskTitle("dotnet build tests/HyperPlayer.Tests.csproj を1回、続けて dotnet test")).toBe("ビルドとテストを動かす");
  });
  it("calls a task a record only when a record is what gets added to", () => {
    expect(taskTitle("README.md に min 関数の使い方を2行だけ追記する。1行目は import 例、2行目は呼び出し例と結果とする。README.md が既にあれば末尾に追記し、なければ新しく作る")).toMatch(/^README\.md に min/);
    expect(taskTitle("プロジェクトの一番上のフォルダに CHANGELOG.md が無ければ新しく作り、あれば先頭(新しい順)に追記する")).toBe("記録に結果を書き足す");
    expect(taskTitle("今回の結果を更新履歴へ追記する")).toBe("記録に結果を書き足す");
  });
  it("skips the opening preparation steps and names what the task does", () => {
    expect(taskTitle("docs/status-report.md と docs/previous-conversation.md があれば先に読み、README.md の既存の内容と改行・書き方を確認したうえで、README.md の末尾に「分割確認1行目」「分割確認2行目」の2行だけを追記する")).toMatch(/^README\.md の末尾に「分割確認1行目」/);
    expect(taskTitle("docs/status-report.md があれば先に読み、src/sum.mjs に関数 sum を作る")).toMatch(/^src\/sum\.mjs に関数 sum/);
    expect(taskTitle("CLAUDE.md があれば先に読み、ログイン画面の入力チェックを直す")).toBe("ログイン画面の入力チェックを直す");
    // nothing left after the opening: the text stays as it is
    expect(taskTitle("README.md の内容を確認したうえで、")).not.toBe("");
  });
  it("does not title a task just 読み when it begins by reading one file", () => {
    expect(taskTitle("README.md を読み、末尾に「分割確認1行目」「分割確認2行目」の2行が順番どおり追記されていることを確認し、結果を答える")).toMatch(/^README\.md の末尾に「分割確認1行目」/);
    expect(taskTitle("src/Fence.App/Services/FileWatcherService.cs を実際に読み、ファイル監視の仕組み(監視対象など)を10行程度の設計メモにまとめる")).toBe("ファイル監視の仕組み");
  });
  it("keeps the file name when making that file is the first thing the task does", () => {
    expect(taskTitle("package.jsonを作成し、`npm test`でNode.js組み込みのテストランナーを実行するtestスクリプトを定義する")).toBe("package.jsonを作成");
    expect(taskTitle("package.json を新しく作り、scripts を設定する")).toBe("package.json を新しく作り");
  });
  it("ends the heading at the action, not with the し that leads into the next one", () => {
    expect(taskTitle("npm testを実行し、結果を記録する")).toBe("npm testを実行");
    expect(taskTitle("csvsum.jsとテストコードをレビューし、問題点を挙げる")).toMatch(/レビュー$/);
    expect(taskTitle("画面の文言の見直し、ボタンの配置の確認")).toBe("画面の文言の見直し");
    expect(taskTitle("npm install を実行して、依存パッケージを入れる")).toBe("npm install を実行");
    expect(taskTitle("画面の文言を見直して、直す")).toBe("画面の文言を見直して");
  });
  it("otherwise uses the first phrase without command names, cut at 28 characters", () => {
    expect(taskTitle("capture.ps1 の使い方(Start/Shot/Click/Keys/Stop/Status/Windows)、確認用素材")).toBe("使い方");
    expect(taskTitle("src/sum.mjs に、数値の配列を合計する関数 sum を作る")).toMatch(/^src\/sum\.mjs に、数値の配列/);
    expect(taskTitle("test/sum.test.mjs に node:test のテストを3件書く")).toMatch(/^test\/sum\.test\.mjs に node:t/);
    const t = taskTitle("白基調のスタジオ各画面を作り直すために必要な共通部品の洗い出しと整理をまとめて行う作業");
    expect(t.length).toBeLessThanOrEqual(29);
  });
});

import { plainLogText } from "./labels";
describe("plainLogText", () => {
  it("replaces the developer-English permission error, leaves other text alone", () => {
    expect(plainLogText("Permission for this tool use was denied. It requires approval, and this session has no approval surface")).toContain("承認が必要");
    expect(plainLogText("ファイルを書く: a.md")).toBe("ファイルを書く: a.md");
  });
});

describe("shortGoal heading length", () => {
  it("keeps a long request's heading to about two lines (56 characters)", () => {
    const g = "HyperPlayer の実機確認で、Get-FileHash と capture.ps1(Start/Shot/Stop/Status)が毎回承認で止まる原因を調べて直してください。直したら画面で確かめてください。";
    const s = shortGoal(g);
    expect(s.long).toBe(true);
    expect(s.head.length).toBeLessThanOrEqual(57);
  });
});
