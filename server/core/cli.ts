import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openDatabase } from "./db.ts";
import { applyPlan, backupLegacy, buildPlan, renderReport } from "./legacyImport.ts";
import { Store } from "./store.ts";

// Usage:
//   npm run migrate:legacy             dry run: reads config/ + workspace/, writes only data/migration-report.md
//   npm run migrate:legacy -- --apply  backs up config/ + workspace/, then imports into data/orchestrator.db and projects/
const ROOT = path.resolve(process.cwd());
const apply = process.argv.includes("--apply");

const configDir = path.join(ROOT, "config");
const workspaceDir = path.join(ROOT, "workspace");
const dataDir = path.join(ROOT, "data");

const plan = buildPlan({
  workflowPath: path.join(configDir, "workflow.json"),
  aiServicesPath: path.join(configDir, "ai_services.json"),
  workspaceDir,
});

mkdirSync(dataDir, { recursive: true });
const reportPath = path.join(dataDir, "migration-report.md");

if (!apply) {
  writeFileSync(reportPath, renderReport(plan), "utf-8");
  console.log(`ドライラン完了(何も変更していません)。レポート: ${reportPath}`);
  console.log(`プロジェクト ${plan.projects.length}件 / AIサービス ${plan.aiServices.length}件 / 警告 ${plan.warnings.length + plan.projects.reduce((n, p) => n + p.warnings.length, 0)}件`);
  console.log("適用するには: npm run migrate:legacy -- --apply");
} else {
  const backup = backupLegacy({ configDir, workspaceDir, backupsDir: path.join(ROOT, "backups") });
  console.log(`バックアップ作成: ${backup}`);
  if (!existsSync(backup)) throw new Error("バックアップの作成に失敗したため中止します");
  const db = openDatabase(path.join(dataDir, "orchestrator.db"));
  const store = new Store(db, path.join(ROOT, "projects"));
  const result = applyPlan(store, plan, { workspaceDir });
  writeFileSync(reportPath, renderReport(plan, result), "utf-8");
  db.close();
  console.log(`取込 ${result.imported.length}件 / スキップ ${result.skipped.length}件 / AIサービス ${result.aiServices}件。レポート: ${reportPath}`);
}
