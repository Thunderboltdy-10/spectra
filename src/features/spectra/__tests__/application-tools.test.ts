import { describe, expect, it } from "vitest";
import { spectraToolRegistry } from "../tools/registry";
import { decideAiAuthority } from "../ai/authority-policy";

describe("application capability registry", () => {
  it("exposes canonical Library search separately from artifact retrieval", () => {
    expect(
      spectraToolRegistry.parseInput("search_library", {
        query: "Arduino_IA",
        kinds: ["folder", "work"],
        scopeNodeId: "physics-node",
      }),
    ).toMatchObject({
      query: "Arduino_IA",
      kinds: ["folder", "work"],
      scopeNodeId: "physics-node",
    });
  });

  it("requires only the fields that each organization action actually needs", () => {
    expect(
      spectraToolRegistry.parseInput("organize_library", {
        action: "create_folder",
        name: "Sources",
      }),
    ).toMatchObject({ action: "create_folder", targetIds: [] });

    expect(() =>
      spectraToolRegistry.parseInput("organize_library", {
        action: "move",
        targetIds: [],
      }),
    ).toThrow(/targetIds/i);
    expect(() =>
      spectraToolRegistry.parseInput("organize_library", {
        action: "move",
        targetIds: ["node-1"],
      }),
    ).toThrow(/destination/i);
  });

  it("keeps consequential app actions behind the shared authority table", () => {
    expect(decideAiAuthority({ target: "settings" }).decision).toBe(
      "always-confirm",
    );
    expect(decideAiAuthority({ target: "sharing" }).decision).toBe("confirm");
    expect(
      decideAiAuthority({ target: "local_file", fileCount: 3 }).consequence,
    ).toBe("This will affect 3 files on this PC.");
    expect(decideAiAuthority({ target: "bridge_pair" }).decision).toBe(
      "prohibited",
    );
  });
});
