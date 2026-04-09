import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workspaceCanvasPath = path.join(
  process.cwd(),
  "src",
  "components",
  "workspace",
  "workspace-canvas.tsx",
);
const workspaceCanvasSource = readFileSync(workspaceCanvasPath, "utf8");

describe("workspace context menu contracts", () => {
  it("uses Open label for item menus and supports pin toggling semantics in source", async () => {
    expect(workspaceCanvasSource).toContain('label={EMPTY_CANVAS_MENU_ACTIONS.note.label}');
    expect(workspaceCanvasSource).toContain('label={EMPTY_CANVAS_MENU_ACTIONS.code.label}');
    expect(workspaceCanvasSource).toContain('label={EMPTY_CANVAS_MENU_ACTIONS.workstream.label}');
    expect(workspaceCanvasSource).toContain('label="Open"');
    expect(workspaceCanvasSource).toContain('label={pinnedItemIds.has(itemContextMenu.itemId) ? "Unpin" : "Pin"}');
    expect(workspaceCanvasSource).toContain(
      'body: JSON.stringify({ action: "pin", itemId, pinned: nextPinned })',
    );
  });

  it("routes group add-item actions to type-appropriate creation intents", async () => {
    expect(workspaceCanvasSource).toContain('groupContextMenu.groupType === "threads" ? "chat"');
    expect(workspaceCanvasSource).toContain('groupContextMenu.groupType === "planner" ? "planner"');
  });
});
