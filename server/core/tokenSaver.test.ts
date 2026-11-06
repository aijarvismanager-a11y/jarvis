import { describe, expect, it } from "vitest";
import { chooseModel, parseSaverCapabilities, saverArgs } from "./tokenSaver.ts";

describe("tokenSaver", () => {
  it("light work runs light, a failed attempt moves one step up", () => {
    expect(chooseModel("document").model).toBe("haiku");
    expect(chooseModel("coding")).toEqual({ model: "sonnet", effort: "medium" });
    expect(chooseModel("coding", 1)).toEqual({ model: "sonnet", effort: "medium" });
    expect(chooseModel("coding", 2)).toEqual({ model: "opus", effort: "high" });
    expect(chooseModel("coding", 3, "別のAI(Qwen)のレビューで").model).toBe("sonnet");
    expect(chooseModel("document", 2).model).toBe("sonnet");
    expect(chooseModel("unknown-role").model).toBe("sonnet");
    expect(chooseModel("coding", 5).model).toBe("opus");
  });
  it("only uses flags the CLI lists", () => {
    const help = "  --model <m>\n  --effort <l>\n  --strict-mcp-config\n  --disable-slash-commands\n  --exclude-dynamic-system-prompt-sections\n";
    const caps = parseSaverCapabilities(help);
    expect(saverArgs(caps, { model: "haiku", effort: "low" })).toEqual(["--disable-slash-commands", "--strict-mcp-config", "--exclude-dynamic-system-prompt-sections", "--model", "haiku", "--effort", "low"]);
    expect(saverArgs(parseSaverCapabilities("--print"), { model: "haiku", effort: "low" })).toEqual([]);
    expect(saverArgs(undefined, null)).toEqual([]);
  });
});
