import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  WHITEBOARD_CAPABILITIES,
  WHITEBOARD_MANIFEST_OPERATIONS,
  capabilitiesFor,
} from "../capabilities";
import { commandContext } from "../commands/registry";
import { requireArtifactTypeManifest } from "../artifacts/registry";
import {
  WHITEBOARD_SCHEMA_VERSION,
  migrateWhiteboardContent,
  whiteboardContentSchema,
} from "../artifacts/schema/whiteboard";
import {
  normalizeWhiteboardContent,
  type WhiteboardContent,
} from "../whiteboard/model";
import {
  adjustWhiteboardVote,
  applyWhiteboardTemplate,
  arrangeWhiteboardNodes,
  groupWhiteboardNodes,
  reorderWhiteboardNodes,
  setWhiteboardNodeLock,
  setWhiteboardShapeKind,
  shouldVirtualizeWhiteboard,
  ungroupWhiteboardNodes,
  whiteboardConnectorGeometry,
  whiteboardFrameNodeIds,
} from "../whiteboard/operations";
import { buildWhiteboardPackage, buildWhiteboardSvg } from "../whiteboard/io";

function legacyBoard() {
  return {
    viewport: { pageId: "page-1", x: 13, y: -21, zoom: 1.25 },
    pages: [{ id: "page-1", name: "Depth" }],
    layers: [
      {
        id: "layer-1",
        pageId: "page-1",
        name: "Ideas",
        visible: true,
        locked: false,
      },
    ],
    nodes: [
      {
        id: "frame-1",
        type: "frame",
        pageId: "page-1",
        layerId: "layer-1",
        x: 10,
        y: 20,
        width: 760,
        height: 480,
        rotation: 0,
        zIndex: 0,
        content: { title: "Frame alpha" },
      },
      {
        id: "shape-1",
        type: "shape",
        pageId: "page-1",
        layerId: "layer-1",
        frameId: "frame-1",
        x: 80,
        y: 100,
        width: 180,
        height: 100,
        rotation: 7,
        zIndex: 2,
        content: { text: "Decision", shape: "diamond" },
        style: { fill: "#eaf1ff", stroke: "#64748b" },
      },
      {
        id: "note-1",
        type: "note",
        pageId: "page-1",
        layerId: "layer-1",
        frameId: "frame-1",
        x: 360,
        y: 120,
        width: 180,
        height: 120,
        rotation: 0,
        zIndex: 1,
        voteCount: 3,
        content: { text: "Evidence" },
      },
      {
        id: "outside-1",
        type: "note",
        pageId: "page-1",
        layerId: "layer-1",
        x: 1000,
        y: 1000,
        width: 160,
        height: 100,
        rotation: 0,
        zIndex: 4,
        content: { text: "Outside frame" },
      },
    ],
    edges: [
      {
        id: "edge-1",
        pageId: "page-1",
        layerId: "layer-1",
        from: "shape-1",
        to: "note-1",
        label: "supports",
      },
    ],
    settings: { gridSize: 20 },
  };
}

function board(): WhiteboardContent {
  return normalizeWhiteboardContent(legacyBoard());
}

describe("P12.I3 whiteboard inventory and IR closure", () => {
  it("closes every inventory row with the final 90-definition census", () => {
    const inventory = readFileSync(
      "docs/spectra-nova/workbar-artifact-capability/WHITEBOARD-CAPABILITY-INVENTORY.md",
      "utf8",
    );
    expect(WHITEBOARD_CAPABILITIES).toHaveLength(90);
    expect(capabilitiesFor("whiteboard")).toEqual(WHITEBOARD_CAPABILITIES);
    expect(
      WHITEBOARD_CAPABILITIES.filter(
        (definition) => definition.delivery?.status === "ship",
      ),
    ).toHaveLength(85);
    expect(
      WHITEBOARD_CAPABILITIES.filter(
        (definition) => definition.delivery?.status === "refuse",
      ),
    ).toHaveLength(4);
    expect(
      WHITEBOARD_CAPABILITIES.filter(
        (definition) => definition.delivery?.status === "defer",
      ),
    ).toHaveLength(1);
    expect(inventory).toContain("P12.I3 final IR census:** 90 definitions");
    for (const definition of WHITEBOARD_CAPABILITIES) {
      expect(definition.delivery).toBeTruthy();
      expect(inventory).toContain(
        `\`${definition.id.slice("whiteboard.".length)}\``,
      );
    }
  });

  it("uses the same disabled reason for refused and deferred human or AI paths", () => {
    const context = commandContext("whiteboard", () => true, "edit");
    for (const definition of WHITEBOARD_CAPABILITIES) {
      const availability = definition.availability(context);
      if (definition.delivery?.status === "ship") {
        expect(availability.state, definition.id).toBe("enabled");
      } else {
        expect(availability).toEqual({
          state: "disabled",
          reason: definition.delivery?.reason,
        });
      }
    }
  });

  it("derives manifest operations from every AI-exposed definition", () => {
    const exposed = WHITEBOARD_CAPABILITIES.filter(
      (definition) => definition.ai.exposed,
    );
    expect(WHITEBOARD_MANIFEST_OPERATIONS).toEqual(
      exposed.map((definition) => definition.id.slice("whiteboard.".length)),
    );
    expect(requireArtifactTypeManifest("whiteboard").operations).toEqual(
      exposed.map((definition) => definition.id),
    );
  });
});

describe("P12.I3 whiteboard schema migration", () => {
  it("migrates v1 to v2 without changing stable identity or geometry", () => {
    const migrated = migrateWhiteboardContent(legacyBoard(), 1);
    expect(WHITEBOARD_SCHEMA_VERSION).toBe(2);
    expect(migrated.nodes.map((node) => node.id)).toEqual([
      "frame-1",
      "shape-1",
      "note-1",
      "outside-1",
    ]);
    expect(migrated.nodes[1]).toMatchObject({
      x: 80,
      y: 100,
      width: 180,
      height: 100,
      rotation: 7,
      shapeKind: "diamond",
    });
    expect(migrated.edges[0]).toMatchObject({
      route: "straight",
      fromAnchor: "auto",
      toAnchor: "auto",
      startCap: "none",
      endCap: "arrow",
    });
    expect(migrated.zOrder).toEqual([
      "frame-1",
      "note-1",
      "shape-1",
      "outside-1",
    ]);
    expect(migrated.settings).toMatchObject({
      showGrid: true,
      snapToGrid: true,
      virtualizeAfter: 300,
    });
    expect(whiteboardContentSchema.safeParse(migrated).success).toBe(true);
    expect(migrateWhiteboardContent(migrated, 2)).toEqual(migrated);
  });
});

describe("P12.I3 whiteboard operations", () => {
  it("aligns and distributes on both axes while preserving locked objects", () => {
    const input = board();
    input.nodes[3]!.locked = true;
    const ids = ["shape-1", "note-1", "outside-1"];
    const aligned = arrangeWhiteboardNodes(input, ids, "bottom");
    expect(aligned.nodes.find((node) => node.id === "shape-1")?.y).toBe(140);
    expect(aligned.nodes.find((node) => node.id === "note-1")?.y).toBe(120);
    expect(aligned.nodes.find((node) => node.id === "outside-1")?.y).toBe(1000);

    const three = normalizeWhiteboardContent({
      ...legacyBoard(),
      nodes: legacyBoard().nodes.slice(0, 3),
    });
    const horizontal = arrangeWhiteboardNodes(
      three,
      three.nodes.map((node) => node.id),
      "horizontal",
    );
    expect(horizontal.nodes[0]?.x).toBe(10);
    expect(horizontal.nodes[2]?.x).toBe(360);
    const vertical = arrangeWhiteboardNodes(
      three,
      three.nodes.map((node) => node.id),
      "vertical",
    );
    expect(vertical.nodes[0]?.y).toBe(20);
    expect(vertical.nodes[2]?.y).toBe(120);
  });

  it("keeps locks, groups, votes, shape changes, and z-order canonical", () => {
    const input = board();
    const locked = setWhiteboardNodeLock(input, ["shape-1"], true);
    expect(locked.nodes.find((node) => node.id === "shape-1")?.locked).toBe(
      true,
    );
    expect(setWhiteboardShapeKind(locked, "shape-1", "hexagon")).toBe(locked);

    const voted = adjustWhiteboardVote(input, "note-1", 2);
    expect(voted.nodes.find((node) => node.id === "note-1")?.voteCount).toBe(5);
    const shaped = setWhiteboardShapeKind(input, "shape-1", "hexagon");
    expect(shaped.nodes.find((node) => node.id === "shape-1")?.shapeKind).toBe(
      "hexagon",
    );

    const grouped = groupWhiteboardNodes(
      input,
      ["shape-1", "note-1"],
      "group-1",
    );
    expect(grouped.zOrder[0]).toBe("group-1");
    expect(
      grouped.nodes.filter((node) => node.parentId === "group-1"),
    ).toHaveLength(2);
    const ungrouped = ungroupWhiteboardNodes(grouped, ["group-1"]);
    expect(ungrouped.nodes.some((node) => node.id === "group-1")).toBe(false);
    expect(ungrouped.nodes.some((node) => node.parentId === "group-1")).toBe(
      false,
    );

    const front = reorderWhiteboardNodes(input, ["frame-1"], "front");
    expect(front.zOrder.at(-1)).toBe("frame-1");
    expect(
      front.nodes
        .slice()
        .sort((left, right) => left.zIndex - right.zIndex)
        .map((node) => node.id),
    ).toEqual(front.zOrder);
  });

  it("treats a locked layer as immutable for object operations", () => {
    const input = board();
    input.layers[0]!.locked = true;
    expect(setWhiteboardNodeLock(input, ["shape-1"], true)).toBe(input);
    expect(adjustWhiteboardVote(input, "note-1", 1)).toBe(input);
    expect(setWhiteboardShapeKind(input, "shape-1", "triangle")).toBe(input);
  });

  it("uses attached anchors for straight, elbow, and curved connectors", () => {
    const input = board();
    const from = input.nodes.find((node) => node.id === "shape-1")!;
    const to = input.nodes.find((node) => node.id === "note-1")!;
    const edge = {
      ...input.edges[0]!,
      fromAnchor: "right" as const,
      toAnchor: "left" as const,
    };
    const straight = whiteboardConnectorGeometry(edge, from, to);
    expect(straight.start).toEqual({ x: 260, y: 150 });
    expect(straight.end).toEqual({ x: 360, y: 180 });
    expect(straight.path).toBe("M 260 150 L 360 180");
    expect(
      whiteboardConnectorGeometry({ ...edge, route: "elbow" }, from, to).path,
    ).toContain(" L ");
    expect(
      whiteboardConnectorGeometry({ ...edge, route: "curve" }, from, to).path,
    ).toContain(" C ");
  });

  it("builds a nested brainwriting section and virtualizes only at threshold", () => {
    const input = board();
    let ordinal = 0;
    const templated = applyWhiteboardTemplate(input, {
      template: "brainwriting",
      pageId: "page-1",
      layerId: "layer-1",
      x: 0,
      y: 0,
      snap: (value) => value,
      id: (kind) => `${kind}-template-${++ordinal}`,
    });
    const section = templated.nodes.find(
      (node) => node.id === "node-template-1",
    )!;
    expect(section.type).toBe("section");
    expect(
      templated.nodes.filter((node) => node.parentId === section.id),
    ).toHaveLength(3);
    expect(shouldVirtualizeWhiteboard(299, 300)).toBe(false);
    expect(shouldVirtualizeWhiteboard(300, 300)).toBe(true);
    expect(shouldVirtualizeWhiteboard(49, 1)).toBe(false);
    expect(shouldVirtualizeWhiteboard(50, 1)).toBe(true);
  });
});

describe("P12.I3 whiteboard export depth", () => {
  it("scopes SVG to a frame and preserves shape, vote, route, label, and caps", () => {
    const input = board();
    input.edges[0] = {
      ...input.edges[0]!,
      route: "curve",
      startCap: "circle",
      endCap: "diamond",
    };
    const scope = whiteboardFrameNodeIds(input, "frame-1");
    expect([...scope]).toEqual(["frame-1", "shape-1", "note-1"]);
    const svg = buildWhiteboardSvg(input, "page-1", scope);
    expect(svg).toContain('data-spectra-node="frame-1"');
    expect(svg).toContain('data-spectra-shape="diamond"');
    expect(svg).toContain("3 votes");
    expect(svg).toContain("supports");
    expect(svg).toContain(" C ");
    expect(svg).toContain('marker-start="url(#cap-circle-start)"');
    expect(svg).toContain('marker-end="url(#cap-diamond-end)"');
    expect(svg).not.toContain("Outside frame");
  });

  it("writes a v2 portable package", () => {
    const packed = JSON.parse(buildWhiteboardPackage(board())) as {
      format: string;
      version: number;
      content: WhiteboardContent;
    };
    expect(packed.format).toBe("spectra-whiteboard");
    expect(packed.version).toBe(2);
    expect(packed.content.zOrder).toHaveLength(packed.content.nodes.length);
  });
});
