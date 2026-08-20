import { describe, expect, it, vi } from "vitest";
import {
  commandContext,
  commandForBinding,
  executeCommand,
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

  it("adds and dismisses selection-driven contextual tabs", () => {
    expect(tabsFor("presentation", "Shape")).toContain("Shape");
    expect(tabsFor("presentation")).not.toContain("Shape");
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
