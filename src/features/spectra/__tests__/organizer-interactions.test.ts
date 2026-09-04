import { describe, expect, it } from "vitest";
import {
  expandedAncestorsForPath,
  isOpenWorkNode,
  opensOnPlainClick,
  resolveKey,
  selectRow,
  selectedWorkSourceIds,
  windowRange,
} from "../organization/tree-model";
import { ROW_HEIGHT } from "../organization/organizer-row";
import type { TreeNode } from "../organization/tree-client";
import { readFileSync } from "node:fs";
import path from "node:path";

function workRow(nodeId: string, sourceId: string): TreeNode {
  return {
    nodeId,
    parentId: null,
    kind: "work",
    name: sourceId,
    sourceId,
    orderKey: nodeId,
    pinned: false,
    isContainer: false,
    createdAt: 0,
    updatedAt: 0,
    activityAt: 0,
  };
}

describe("Library row interactions", () => {
  it("keeps ancestors open without forcing the current folder open", () => {
    expect(
      expandedAncestorsForPath({
        ancestors: [{ nodeId: "school" }, { nodeId: "class" }],
      }),
    ).toEqual(["school", "class"]);
  });
  it("opens folders and work on an ordinary click", () => {
    expect(
      opensOnPlainClick(
        { shiftKey: false, metaKey: false, ctrlKey: false },
        false,
      ),
    ).toBe(true);
  });

  it("keeps open-work presentation separate from picker selection", () => {
    const row = workRow("n1", "work-a");
    expect(isOpenWorkNode(row, "work-a")).toBe(true);
    expect(isOpenWorkNode(row, "work-b")).toBe(false);
    expect(isOpenWorkNode(row)).toBe(false);
    expect(
      isOpenWorkNode({ kind: "thread", sourceId: "work-a" }, "work-a"),
    ).toBe(false);
  });

  it("preserves explicit selection gestures", () => {
    expect(
      opensOnPlainClick(
        { shiftKey: true, metaKey: false, ctrlKey: false },
        false,
      ),
    ).toBe(false);
    expect(
      opensOnPlainClick(
        { shiftKey: false, metaKey: false, ctrlKey: false },
        true,
      ),
    ).toBe(false);
  });

  it("publishes every selected work id, not only the last click", () => {
    const rows = [workRow("n1", "a"), workRow("n2", "b"), workRow("n3", "c")];
    const first = selectRow(
      { ids: new Set(), anchorId: null, cursorId: null },
      rows,
      "n1",
      "replace",
    );
    const ranged = selectRow(first, rows, "n3", "range");
    expect(selectedWorkSourceIds(ranged, rows)).toEqual(["a", "b", "c"]);
  });
});

describe("Library windowRange density", () => {
  it("windows 10k rows to a viewport plus overscan instead of mounting them all", () => {
    const range = windowRange(0, 800, ROW_HEIGHT, 10_000);
    expect(range.start).toBe(0);
    expect(range.end).toBeLessThan(80);
    expect(range.end - range.start).toBeLessThan(80);
    expect(range.padBottom).toBe((10_000 - range.end) * ROW_HEIGHT);
  });

  it("keeps the mounted window bounded after scrolling deep into 10k rows", () => {
    const range = windowRange(ROW_HEIGHT * 5_000, 800, ROW_HEIGHT, 10_000);
    expect(range.end - range.start).toBeLessThan(80);
    expect(range.start).toBeGreaterThan(4_900);
    expect(range.end).toBeLessThan(5_100);
    expect(
      range.padTop + range.padBottom + (range.end - range.start) * ROW_HEIGHT,
    ).toBe(10_000 * ROW_HEIGHT);
  });
});

describe("Library keyboard open", () => {
  const none = { shiftKey: false, metaKey: false, ctrlKey: false };
  const empty = { ids: new Set<string>(), anchorId: null, cursorId: null };

  it("opens the first visible row when Enter arrives with no cursor", () => {
    const rows = [workRow("n1", "a"), workRow("n2", "b")];
    expect(resolveKey("Enter", none, rows, empty)).toEqual({
      type: "open",
      nodeId: "n1",
    });
  });

  it("moves onto the first row from Search with ArrowDown", () => {
    const rows = [workRow("n1", "a"), workRow("n2", "b")];
    expect(resolveKey("ArrowDown", none, rows, empty)).toEqual({
      type: "move",
      nodeId: "n1",
      extend: false,
    });
  });

  it("keeps Search ArrowDown/Enter and cursor-row Enter on the shared keyboard path", () => {
    const search = readFileSync(
      path.join(process.cwd(), "src/features/spectra/organization/surface-chrome.tsx"),
      "utf8",
    );
    const row = readFileSync(
      path.join(process.cwd(), "src/features/spectra/organization/organizer-row.tsx"),
      "utf8",
    );
    const organizer = readFileSync(
      path.join(
        process.cwd(),
        "src/features/spectra/organization/library-organizer.tsx",
      ),
      "utf8",
    );
    expect(search).toContain("onMoveToResults");
    expect(search).toContain("onOpenFirstResult");
    expect(search).toContain('event.key === "ArrowDown"');
    expect(row).toContain("tabIndex={cursor ? 0 : -1}");
    expect(row).toContain("callbacks.onOpen(node)");
    expect(organizer).toContain("onMoveToResults=");
    expect(organizer).toContain("onOpenFirstResult=");
    expect(organizer).toContain("scrollRef.current?.focus()");
    expect(organizer).toContain("if (selectionMode) publishWorkSelection(next);");
    expect(organizer).toContain("isAuthenticated && live ? {} : \"skip\"");
    expect(organizer).toContain("setLive(false)");
    expect(organizer).toContain("subscribeIdleSurfaceRefresh");
  });
});
