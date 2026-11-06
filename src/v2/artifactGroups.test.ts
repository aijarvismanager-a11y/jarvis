import { describe, expect, it } from "vitest";
import { classifyArtifact, groupByFolder } from "./artifactGroups";

describe("artifactGroups", () => {
  it("sorts files into made / notes / old", () => {
    expect(classifyArtifact("src/Fence.App/Settings.cs")).toBe("made");
    expect(classifyArtifact("PLAN.md")).toBe("made");
    expect(classifyArtifact("_ai-records/reviews/t.md")).toBe("notes");
    expect(classifyArtifact("web-ai/x.md")).toBe("notes");
    expect(classifyArtifact("_archive/2026-11-06_old/Gage.exe")).toBe("old");
    expect(classifyArtifact("src/App/bin/Debug/App.dll")).toBe("old");
    expect(classifyArtifact("Gage-win-x64.zip.old-2026-08-30")).toBe("old");
    expect(classifyArtifact("make_zip.py.unused")).toBe("old");
  });
  it("groups by top folder, loose files first", () => {
    const g = groupByFolder([{ path: "src/a.cs" }, { path: "README.md" }, { path: "docs/x.md" }, { path: "src/b.cs" }]);
    expect(g.map((x) => x.folder)).toEqual(["", "docs", "src"]);
    expect(g[2].items).toHaveLength(2);
  });
});
