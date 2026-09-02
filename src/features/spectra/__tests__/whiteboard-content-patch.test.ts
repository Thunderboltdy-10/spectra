import { describe, expect, it } from "vitest";
import { applyResolvedContentPatch } from "../ai/document-content-patch";
import { normalizeArtifactContent } from "../ai/content-normalization";
import { parseModelOperation } from "../operations/schema";
import {
  canonicalizeWhiteboardPatchChange,
  coerceWhiteboardColorValue,
  remapWhiteboardRecolorChanges,
  resolveWhiteboardNodePatchPath,
} from "../ai/whiteboard-content-patch";

function enzymeInhibitionBoard() {
  return normalizeArtifactContent("whiteboard", {
    viewport: { x: 0, y: 0, zoom: 1, pageId: "page-1" },
    pages: [{ id: "page-1", name: "Canvas" }],
    layers: [
      {
        id: "layer-1",
        pageId: "page-1",
        name: "Canvas",
        visible: true,
        locked: false,
      },
    ],
    nodes: [
      {
        id: "node-comp",
        type: "shape",
        pageId: "page-1",
        layerId: "layer-1",
        x: 40,
        y: 40,
        width: 220,
        height: 120,
        rotation: 0,
        zIndex: 1,
        content: { text: "Competitive Inhibition", shape: "rounded-rectangle" },
        style: { fill: "var(--bg-user-bubble)", stroke: "var(--brand-primary)", color: "var(--brand-primary)" },
      },
      {
        id: "node-non",
        type: "shape",
        pageId: "page-1",
        layerId: "layer-1",
        x: 300,
        y: 40,
        width: 220,
        height: 120,
        rotation: 0,
        zIndex: 2,
        content: {
          text: "Non-competitive Inhibition",
          shape: "rounded-rectangle",
        },
        style: { fill: "color-mix(in oklab, var(--accent-gold) 28%, var(--bg-elevated))", stroke: "var(--accent-gold)", color: "var(--text-primary)" },
      },
      {
        id: "node-un",
        type: "shape",
        pageId: "page-1",
        layerId: "layer-1",
        x: 40,
        y: 200,
        width: 220,
        height: 120,
        rotation: 0,
        zIndex: 3,
        content: {
          text: "Uncompetitive Inhibition",
          shape: "rounded-rectangle",
        },
        style: { fill: "color-mix(in oklab, var(--success) 12%, var(--bg-elevated))", stroke: "var(--success)", color: "var(--success)" },
      },
    ],
    edges: [],
  });
}

describe("whiteboard contentPatch recolor coerce", () => {
  it("coerces named and nested color values to hex", () => {
    expect(coerceWhiteboardColorValue("clearer blue")).toBe("#2563eb");
    expect(coerceWhiteboardColorValue("Blue")).toBe("#2563eb");
    expect(coerceWhiteboardColorValue("#abc")).toBe("#aabbcc");
    expect(coerceWhiteboardColorValue({ fill: "blue" })).toBe("#2563eb");
    expect(coerceWhiteboardColorValue("rgb(37, 99, 235)")).toBe("#2563eb");
  });

  it("resolves id, title, and bare fill paths onto style.fill", () => {
    const board = enzymeInhibitionBoard();
    expect(
      resolveWhiteboardNodePatchPath(board, "/nodes/id:node-comp/style/fill"),
    ).toBe("/nodes/0/style/fill");
    expect(
      resolveWhiteboardNodePatchPath(board, "/nodes/competitive/fill"),
    ).toBe("/nodes/0/style/fill");
    expect(resolveWhiteboardNodePatchPath(board, "/nodes/0/fill")).toBe(
      "/nodes/0/style/fill",
    );
    expect(
      canonicalizeWhiteboardPatchChange(board, {
        path: "/nodes/id:node-comp/style/fill",
        value: "clearer blue",
      }),
    ).toEqual({ path: "/nodes/0/style/fill", value: "#2563eb" });
  });

  it("remaps a recolor prompt onto the competitive node by title", () => {
    const board = enzymeInhibitionBoard();
    const remapped = remapWhiteboardRecolorChanges(
      board,
      "recolor the competitive inhibition node to a clearer blue",
      [
        {
          op: "replace",
          path: "/nodes/competitive/fill",
          value: "clearer blue",
        } as { path: string; value: unknown },
      ],
    );
    expect(remapped).toEqual([
      { path: "/nodes/0/style/fill", value: "#2563eb" },
    ]);
  });

  it("applies a coerced recolor patch without touching sibling nodes", () => {
    const board = enzymeInhibitionBoard();
    const next = normalizeArtifactContent(
      "whiteboard",
      applyResolvedContentPatch(board, {
        changes: remapWhiteboardRecolorChanges(
          board,
          "recolor the competitive inhibition node to a clearer blue",
          [{ path: "/nodes/id:node-comp/fill", value: "blue" }],
        ),
      }),
    ) as {
      nodes: Array<{ id: string; style?: { fill?: string; stroke?: string } }>;
    };

    expect(next.nodes[0]?.style?.fill).toBe("#2563eb");
    expect(next.nodes[1]?.style?.fill).toBe("color-mix(in oklab, var(--accent-gold) 28%, var(--bg-elevated))");
    expect(next.nodes[2]?.style?.fill).toBe("color-mix(in oklab, var(--success) 12%, var(--bg-elevated))");
  });

  it("lets propose_operation-shaped updates with op + missing nulls parse after coerce", () => {
    const board = enzymeInhibitionBoard();
    const coercedChanges = remapWhiteboardRecolorChanges(
      board,
      "recolor the competitive inhibition node to a clearer blue",
      [
        {
          path: "/nodes/id:node-comp/style/fill",
          value: "clearer blue",
        },
      ],
    );
    const operation = parseModelOperation({
      type: "artifact.update",
      input: {
        artifactId: "wb-1",
        blueprintKey: "whiteboard",
        title: null,
        summary: null,
        content: null,
        contentPatch: { changes: coercedChanges },
        tags: null,
      },
    });
    expect(operation.type).toBe("artifact.update");
    if (operation.type === "artifact.update") {
      expect(operation.input.contentPatch?.changes[0]).toEqual({
        path: "/nodes/0/style/fill",
        value: "#2563eb",
      });
    }

    // The raw slips that previously produced path:input invalid_union.
    const stableSelector = parseModelOperation({
      type: "artifact.update",
      input: {
        artifactId: "wb-1",
        blueprintKey: "whiteboard",
        title: null,
        summary: null,
        content: null,
        tags: null,
        contentPatch: {
          changes: [
            {
              path: "/nodes/id:node-comp/style/fill",
              value: "#2563eb",
            },
          ],
        },
      },
    });
    expect(stableSelector.type).toBe("artifact.update");
    if (stableSelector.type === "artifact.update") {
      expect(stableSelector.input.contentPatch?.changes[0]?.path).toBe(
        "/nodes/id:node-comp/style/fill",
      );
    }
    expect(() =>
      parseModelOperation({
        type: "artifact.update",
        input: {
          artifactId: "wb-1",
          blueprintKey: "whiteboard",
          title: null,
          summary: null,
          content: null,
          tags: null,
          contentPatch: {
            changes: [
              {
                op: "replace",
                path: "/nodes/id:node-comp/style/fill",
                value: "#2563eb",
              },
            ],
          },
        },
      }),
    ).toThrow();
  });
});
