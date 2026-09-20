import { describe, expect, it } from "vitest";
import {
  APPLICATION_AGENT_TOOL_IDS,
  spectraToolRegistry,
} from "../tools/registry";
import { decideAiAuthority } from "../ai/authority-policy";

describe("application capability registry", () => {
  it("preserves bounded Office selectors and paginated Calendar discovery after integration", () => {
    expect(spectraToolRegistry.parseInput("read_artifact", { artifactId: "dense", cellAddresses: ["P9996"], sheetId: "first" })).toMatchObject({ cellAddresses: ["P9996"], sheetId: "first" });
    expect(spectraToolRegistry.parseInput("read_calendar", { from: 1, to: 2, targetItemId: "block", cursor: "next" })).toMatchObject({ targetItemId: "block", cursor: "next" });
    expect(APPLICATION_AGENT_TOOL_IDS).toEqual(expect.arrayContaining(["create_calendar_personal_event", "import_managebac_resource"]));
  });
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

  it("exposes typed disambiguation tools to the agent", () => {
    expect(APPLICATION_AGENT_TOOL_IDS).toEqual(
      expect.arrayContaining(["ask_user_choice", "request_context_target"]),
    );
    expect(
      spectraToolRegistry.parseInput("request_context_target", {
        question: "Which Physics Essay should I change?",
        candidates: [
          {
            id: "essay-a",
            title: "Physics Essay",
            type: "document",
            workspaceTitle: "Mechanics",
          },
          {
            id: "essay-b",
            title: "Physics Essay",
            type: "document",
            workspaceTitle: "Waves",
          },
        ],
      }),
    ).toMatchObject({
      question: "Which Physics Essay should I change?",
      candidates: [{ id: "essay-a" }, { id: "essay-b" }],
    });
    expect(() =>
      spectraToolRegistry.parseInput("request_context_target", {
        question: "Which one?",
        candidates: [{ id: "only", title: "Only candidate" }],
      }),
    ).toThrow();
    expect(() =>
      spectraToolRegistry.parseInput("ask_user_choice", {
        question: "Which one?",
        options: [{ title: "Only option" }],
      }),
    ).toThrow();
  });
});
