import { describe, expect, it } from "vitest";

describe("workspace context menu contracts", () => {
  it("uses Open label for item menus and supports pin toggling semantics in source", async () => {
    const { readFileSync } = await import("node:fs");
    const file = readFileSync("/home/thunderboltdy/ai-school/src/components/workspace/workspace-canvas.tsx", "utf8");

    expect(file).toContain('label={EMPTY_CANVAS_MENU_ACTIONS.note.label}');
    expect(file).toContain('label={EMPTY_CANVAS_MENU_ACTIONS.code.label}');
    expect(file).toContain('label={EMPTY_CANVAS_MENU_ACTIONS.workstream.label}');
    expect(file).toContain('label="Open"');
    expect(file).toContain('label={pinnedItemIds.has(itemContextMenu.itemId) ? "Unpin" : "Pin"}');
    expect(file).toContain('body: JSON.stringify({ action: "pin", itemId, pinned: nextPinned })');
  });

  it("routes group add-item actions to type-appropriate creation intents", async () => {
    const { readFileSync } = await import("node:fs");
    const file = readFileSync("/home/thunderboltdy/ai-school/src/components/workspace/workspace-canvas.tsx", "utf8");

    expect(file).toContain('groupContextMenu.groupType === "threads" ? "chat"');
    expect(file).toContain('groupContextMenu.groupType === "planner" ? "planner"');
  });
});
