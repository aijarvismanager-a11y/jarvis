import { mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./db.ts";
import { Store } from "./store.ts";
import { createDeliveryFolder, uniqueFolder } from "./deliveryFolder.ts";
import { linkKey } from "./projectSync.ts";

describe("createDeliveryFolder", () => {
  it("makes a folder named after the project, links it, and never reuses a name", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "deliv-"));
    const store = new Store(openDatabase(":memory:"), "unused");
    store.createProject({ id: "p", name: "My: App?" });
    const a = createDeliveryFolder(store, "p", "My: App?", root)!;
    expect(existsSync(a)).toBe(true);
    expect(path.basename(a)).toBe("My App");
    expect(store.getSetting<{ createdByApp?: boolean; sourcePath: string }>(linkKey("p"), null)).toMatchObject({ createdByApp: true, sourcePath: a });
    expect(uniqueFolder(root, "My: App?")).toBe(path.join(root, "My App (2)"));
  });
});
