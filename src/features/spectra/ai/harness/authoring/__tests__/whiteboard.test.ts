import { describe, expect, it } from "vitest";
import { resolveArtifactWriteInput } from "../../../../operations/artifact-write-content";
import { whiteboardNodeText } from "../../../../whiteboard/model";
import {
  applyWhiteboardEdits,
  whiteboardFromSpec,
  whiteboardOutline,
  whiteboardProblems,
  whiteboardReadback,
} from "../whiteboard";
import { AuthoringError, sequentialIdFactory } from "../shared";

const waterCycle = {
  nodes: [
    { key: "evaporation", text: "Evaporation: the sun heats water into vapour", color: "cyan" as const },
    { key: "condensation", text: "Condensation: vapour cools into clouds" },
    { key: "precipitation", text: "Precipitation: rain, snow, hail" },
    { key: "collection", text: "Collection: rivers, lakes, oceans and groundwater" },
  ],
  edges: [
    { from: "evaporation", to: "condensation", label: "rises" },
    { from: "condensation", to: "precipitation" },
    { from: "precipitation", to: "collection" },
    { from: "collection", to: "evaporation" },
  ],
};

describe("whiteboard authoring", () => {
  it("lays a cycle out as a ring with no overlaps", () => {
    const board = whiteboardFromSpec(waterCycle, sequentialIdFactory());
    expect(board.nodes.map((node) => node.id)).toEqual(["evaporation", "condensation", "precipitation", "collection"]);
    expect(board.edges).toHaveLength(4);
    expect(board.edges[0]).toMatchObject({ from: "evaporation", to: "condensation", label: "rises" });
    expect(whiteboardProblems(board)).toEqual([]);
    const xs = board.nodes.map((node) => node.x);
    const ys = board.nodes.map((node) => node.y);
    expect(new Set(xs).size + new Set(ys).size).toBeGreaterThan(4);
    expect(() => resolveArtifactWriteInput("whiteboard", null, { content: board }, "")).not.toThrow();
  });

  it("places a hub and its spokes as a mind map without overlaps", () => {
    const spokes = ["Roots", "Stem", "Leaves", "Flowers", "Seeds", "Fruit"];
    const board = whiteboardFromSpec(
      {
        nodes: [{ key: "plant", text: "Parts of a plant", type: "text" }, ...spokes.map((text) => ({ text, type: "note" as const }))],
        edges: spokes.map((text) => ({ from: "plant", to: text })),
      },
      sequentialIdFactory(),
    );
    expect(whiteboardProblems(board)).toEqual([]);
    expect(board.nodes).toHaveLength(7);
  });

  it("edits by key or text and keeps hand placement for new nodes", () => {
    const board = whiteboardFromSpec(waterCycle, sequentialIdFactory());
    const next = applyWhiteboardEdits(
      board,
      [
        { op: "update_node", node: "Precipitation: rain, snow, hail", text: "Precipitation: rain, snow, sleet, hail" },
        { op: "add_nodes", nodes: [{ key: "runoff", text: "Runoff" }] },
        { op: "connect", from: "precipitation", to: "runoff" },
      ],
      sequentialIdFactory(),
    );
    const evaporation = next.nodes.find((node) => node.id === "evaporation")!;
    expect(evaporation.x).toBe(board.nodes.find((node) => node.id === "evaporation")!.x);
    expect(whiteboardNodeText(next.nodes.find((node) => node.id === "precipitation")!)).toMatch(/sleet/);
    expect(next.edges.at(-1)).toMatchObject({ from: "precipitation", to: "runoff" });
    expect(whiteboardReadback(next, board)).toMatch(/Changed or new: precipitation: .*; runoff: Runoff/);
    expect(whiteboardOutline(next)).toMatch(/precipitation → runoff/);
  });

  it("is atomic and names the failing operation", () => {
    const board = whiteboardFromSpec(waterCycle, sequentialIdFactory());
    const before = JSON.stringify(board);
    expect(() =>
      applyWhiteboardEdits(board, [
        { op: "delete_nodes", nodes: ["runoff-missing"] },
      ]),
    ).toThrow(/Edit 1 \(delete_nodes\): node "runoff-missing" matches no node/);
    expect(() =>
      applyWhiteboardEdits(board, [
        { op: "update_node", node: "evaporation", text: "Changed" },
        { op: "add_nodes", nodes: [{ key: "evaporation", text: "Duplicate" }] },
      ]),
    ).toThrow(AuthoringError);
    expect(JSON.stringify(board)).toBe(before);
  });

  it("flags placeholder nodes", () => {
    const board = whiteboardFromSpec({ nodes: [{ text: "Add a thought", type: "note" }, { text: "Real idea" }] });
    expect(whiteboardProblems(board).join(" ")).toMatch(/empty or placeholder/);
  });
});
