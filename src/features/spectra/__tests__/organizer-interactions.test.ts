import { describe, expect, it } from "vitest";
import {
  opensOnPlainClick,
  selectRow,
  selectedWorkSourceIds,
  windowRange,
} from "../organization/tree-model";
import { ROW_HEIGHT } from "../organization/organizer-row";
import type { TreeNode } from "../organization/tree-client";

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
  it("opens folders and work on an ordinary click", () => {
    expect(
      opensOnPlainClick(
        { shiftKey: false, metaKey: false, ctrlKey: false },
        false,
      ),
    ).toBe(true);
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
    expect(range.padTop + range.padBottom + (range.end - range.start) * ROW_HEIGHT).toBe(
      10_000 * ROW_HEIGHT,
    );
  });
});
