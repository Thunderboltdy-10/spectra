import { describe, expect, it } from "vitest";
import {
  opensOnPlainClick,
  selectRow,
  selectedWorkSourceIds,
} from "../organization/tree-model";
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
