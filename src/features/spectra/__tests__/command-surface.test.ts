import { describe, expect, it, vi } from "vitest";
import {
  commandContext,
  commandForBinding,
  executeCommand,
  resolveCommandLayout,
  tabsFor,
} from "../commands";
import { preferenceLayerValuesSchema, resolvePreferences } from "../settings/schema";
import { requireArtifactTypeManifest } from "../artifacts/registry";

describe("N2 command surface", () => {
  it("provides the complete durable command record and one execute path", () => {
    const mutation = vi.fn();
    const command = commandForBinding("document", {
      id: "insert-equation",
      label: "Equation",
      onSelect: mutation,
      requires: "edit",
    }, 2);
    expect(command).toMatchObject({
      id: "document.insert.equation",
      domain: "artifact:document",
      defaultPlacement: { tab: "Equation", order: 2 },
      contextualTab: "Equation",
      risk: "safe",
      undo: "yjs",
    });
    const context = commandContext("document", () => true, "edit", "Equation");
    expect(executeCommand(command, context)).toBe(true);
    expect(mutation).toHaveBeenCalledOnce();
  });

  it("uses the same availability function for human and AI consumers", () => {
    const command = commandForBinding("sheets", {
      id: "formula",
      label: "Formula",
      requires: "edit",
      onSelect: vi.fn(),
    }, 0);
    const denied = commandContext("sheets", () => false, "read_only", "Formula");
    expect(command.availability(denied)).toEqual({ state: "hidden" });
    expect(executeCommand(command, denied)).toBe(false);
  });

  it("decides strict-native availability per command", () => {
    const blocked = commandForBinding("document", {
      id: "apply-template",
      label: "Apply template",
      strictNative: {
        available: false,
        reason: "Templates replace the whole linked Word document.",
      },
      onSelect: vi.fn(),
    }, 0);
    const safe = commandForBinding("document", {
      id: "export-copy",
      label: "Export a copy",
      onSelect: vi.fn(),
    }, 1);
    const context = commandContext("document", () => true, "edit", undefined, {
      compatibilityProfile: "strict-native",
      fidelity: { trackedChanges: "PRESERVED" },
    });
    expect(blocked.availability(context)).toEqual({
      state: "disabled",
      reason: "Templates replace the whole linked Word document.",
    });
    expect(safe.availability(context)).toEqual({ state: "enabled" });
  });

  it("adds and dismisses selection-driven contextual tabs", () => {
    expect(tabsFor("presentation", "Shape")).toContain("Shape");
    expect(tabsFor("presentation")).not.toContain("Shape");
  });

  it("keeps honest type-specific tabs and honors persisted customization", () => {
    expect(tabsFor("document")).toEqual(["General", "Insert", "Format", "Layout", "References"]);
    expect(tabsFor("sheets")).toEqual(["General", "Insert", "Format", "Data", "Formula", "Review"]);
    expect(tabsFor("presentation")).toEqual(["General", "Insert", "Design", "Arrange", "Animate", "Present"]);
    expect(tabsFor("document", undefined, { tabOrder: ["References", "General"] }))
      .toEqual(["References", "General", "Insert", "Format", "Layout"]);
  });

  it("keeps category commands in their category and reserves General for favorites", () => {
    expect(commandForBinding("sheets", {
      id: "chart",
      label: "Chart",
      priority: "essential",
      onSelect: vi.fn(),
    }, 0).defaultPlacement.tab).toBe("Insert");
    expect(commandForBinding("sheets", {
      id: "find",
      label: "Find",
      priority: "essential",
      onSelect: vi.fn(),
    }, 0).defaultPlacement.tab).toBe("General");
  });

  it("pins and renames commands through the persisted layout, keeping the shipped order", () => {
    const chart = commandForBinding("sheets", {
      id: "chart",
      label: "Chart",
      onSelect: vi.fn(),
    }, 9);
    const resolved = resolveCommandLayout(chart, {
      commands: { "sheets.chart": { pinned: true, label: "Quick chart" } },
    });
    expect(resolved.title).toBe("Quick chart");
    expect(resolved.defaultPlacement).toMatchObject({ tab: "General", order: 9 });
    expect(resolved.sourceTab).toBe("Insert");
  });

  it("namespaces every manifest operation as a command id", () => {
    for (const type of ["document", "sheets", "presentation"] as const) {
      expect(requireArtifactTypeManifest(type).operations.every((id) => id.startsWith(`${type}.`))).toBe(true);
    }
  });
});

describe("N2 account preference validation", () => {
  it("rejects malformed writes and drops unknown legacy keys", () => {
    expect(() => preferenceLayerValuesSchema.parse({ ai: { completedRunRetentionMinutes: 1 } })).toThrow();
    const parsed = preferenceLayerValuesSchema.parse({ writing: { smartCompletion: false, legacyGhost: true }, oldToolbar: true });
    expect(parsed.writing?.smartCompletion).toBe(false);
    expect(parsed).not.toHaveProperty("oldToolbar");
    expect(parsed.writing).not.toHaveProperty("legacyGhost");
  });

  it("preserves account, workspace, work-type, device merge order", () => {
    const result = resolvePreferences([
      { scope: "device", values: { writing: { delayMs: 800 } } },
      { scope: "account", values: { writing: { delayMs: 200 } } },
      { scope: "work_type", values: { writing: { delayMs: 600 } } },
      { scope: "workspace", values: { writing: { delayMs: 400 } } },
    ]);
    expect(result.writing.delayMs).toBe(800);
  });
});
