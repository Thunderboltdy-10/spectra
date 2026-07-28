// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  cellCoordinates,
  classifyTravel,
  orderPathsByRoute,
  planJoinLateArrival,
  PresentationLane,
  semanticPathDistance,
} from "../collaboration/presentation-lane";
import {
  __resetRunLedger,
  markOperationSeen,
  recordRunEvent,
} from "../collaboration/run-ledger";
import type {
  InteractionState,
  SemanticTarget,
} from "../collaboration/interaction-model";

function target(path: string, scope?: SemanticTarget["scope"]): SemanticTarget {
  return {
    artifactId: "art-1",
    path,
    primitive: "text",
    ...(scope ? { scope } : {}),
  };
}

function state(
  path: string,
  scope?: SemanticTarget["scope"],
): InteractionState {
  return {
    v: 2,
    actor: { clientId: "ai-1", kind: "ai", name: "Pablo's AI" },
    act: { kind: "focus" },
    lifecycle: "active",
    target: target(path, scope),
    at: Date.now(),
  };
}

describe("cellCoordinates", () => {
  it("parses A1 references", () => {
    expect(cellCoordinates("A1")).toEqual({ column: 1, row: 1 });
    expect(cellCoordinates("B12")).toEqual({ column: 2, row: 12 });
    expect(cellCoordinates("AA3")).toEqual({ column: 27, row: 3 });
    expect(cellCoordinates("nope")).toBeNull();
  });
});

describe("semanticPathDistance", () => {
  it("measures index steps within an ordered collection", () => {
    expect(
      semanticPathDistance("/questions/1/prompt", "/questions/4/prompt"),
    ).toBe(3);
  });

  it("measures grid distance for sheet cells", () => {
    expect(
      semanticPathDistance("/sheets/s1/cells/A1", "/sheets/s1/cells/C4"),
    ).toBe(5);
  });

  it("counts differing segments for unrelated paths", () => {
    expect(semanticPathDistance("/title", "/settings/shuffle")).toBeGreaterThan(
      0,
    );
  });
});

describe("classifyTravel", () => {
  it("stays on the same target", () => {
    expect(classifyTravel(target("/a"), target("/a")).kind).toBe("stay");
  });

  it("fades across scope boundaries", () => {
    const travel = classifyTravel(
      target("/slides/0/title", { kind: "slide", id: "0" }),
      target("/slides/3/title", { kind: "slide", id: "3" }),
    );
    expect(travel.kind).toBe("fade");
    expect(travel.crossesScope).toBe(true);
  });

  it("hops between neighbours and journeys across far targets", () => {
    expect(
      classifyTravel(
        target("/questions/0/prompt"),
        target("/questions/1/prompt"),
      ).kind,
    ).toBe("hop");
    expect(
      classifyTravel(
        target("/questions/0/prompt"),
        target("/questions/9/prompt"),
      ).kind,
    ).toBe("journey");
  });
});

describe("PresentationLane", () => {
  it("keeps exactly one current frame per actor", () => {
    const lane = new PresentationLane("ai-1");
    lane.push(state("/questions/0/prompt"));
    lane.push(state("/questions/1/prompt"));
    expect(lane.current()?.state.target?.path).toBe("/questions/1/prompt");
  });

  it("annotates travel between consecutive frames", () => {
    const lane = new PresentationLane("ai-1");
    lane.push(state("/questions/0/prompt"));
    const next = lane.push(state("/questions/2/prompt"));
    expect(next.travel.kind).toBe("journey");
    expect(next.travel.semanticDistance).toBe(2);
  });

  it("arrives without inventing a journey for the first frame", () => {
    const lane = new PresentationLane("ai-1");
    const first = lane.push(state("/title"));
    expect(first.travel.kind).toBe("stay");
  });
});

describe("orderPathsByRoute", () => {
  it("orders collection indices top-to-bottom", () => {
    expect(
      orderPathsByRoute([
        "/questions/9/prompt",
        "/questions/0/prompt",
        "/questions/4/options/1",
      ]),
    ).toEqual([
      "/questions/0/prompt",
      "/questions/4/options/1",
      "/questions/9/prompt",
    ]);
  });

  it("orders sheet cells row-major", () => {
    expect(
      orderPathsByRoute([
        "/sheets/s1/cells/B1",
        "/sheets/s1/cells/A3",
        "/sheets/s1/cells/A1",
      ]),
    ).toEqual([
      "/sheets/s1/cells/A1",
      "/sheets/s1/cells/B1",
      "/sheets/s1/cells/A3",
    ]);
  });

  it("sweeps canvas objects nearest-next when positions exist", () => {
    const positions = new Map([
      ["/nodes/a", { x: 0, y: 0 }],
      ["/nodes/b", { x: 400, y: 300 }],
      ["/nodes/c", { x: 60, y: 40 }],
    ]);
    const ordered = orderPathsByRoute(
      ["/nodes/b", "/nodes/c", "/nodes/a"],
      (path) => positions.get(path) ?? null,
    );
    expect(ordered[0]).toBe("/nodes/a");
    expect(ordered[1]).toBe("/nodes/c");
    expect(ordered[2]).toBe("/nodes/b");
  });
});

describe("planJoinLateArrival", () => {
  const changedPaths = [
    "/questions/4/prompt",
    "/questions/0/prompt",
    "/questions/2/prompt",
  ];

  beforeEach(() => {
    __resetRunLedger();
  });

  it("walks unseen work in route order rather than arrival order", () => {
    recordRunEvent({ type: "run_created", runId: "run-1" });
    expect(planJoinLateArrival("run-1", changedPaths)).toEqual([
      "/questions/0/prompt",
      "/questions/2/prompt",
      "/questions/4/prompt",
    ]);
  });

  it("never replays after the run is terminal", () => {
    recordRunEvent({ type: "run_created", runId: "run-1" });
    recordRunEvent({ type: "final", runId: "run-1" });
    expect(planJoinLateArrival("run-1", changedPaths)).toEqual([]);
  });

  it("still catches up during an invisible continuation", () => {
    recordRunEvent({ type: "run_created", runId: "run-1" });
    recordRunEvent({
      type: "status",
      runId: "run-1",
      message: "Taking another careful pass",
    });
    expect(planJoinLateArrival("run-1", changedPaths)).not.toEqual([]);
  });

  it("skips work this client already watched", () => {
    recordRunEvent({ type: "run_created", runId: "run-1" });
    markOperationSeen("run-1", "join:/questions/0/prompt");
    expect(planJoinLateArrival("run-1", changedPaths)).toEqual([
      "/questions/2/prompt",
      "/questions/4/prompt",
    ]);
  });

  it("plays nothing for a run it has no record of, such as after a reload", () => {
    expect(planJoinLateArrival("run-1", changedPaths)).toEqual([]);
  });

  it("bounds a long arrival so joining never becomes a highlight reel", () => {
    recordRunEvent({ type: "run_created", runId: "run-1" });
    const many = Array.from(
      { length: 30 },
      (_, index) => `/questions/${index}/prompt`,
    );
    const route = planJoinLateArrival("run-1", many);
    expect(route.length).toBeLessThanOrEqual(6);
    expect(route[0]).toBe("/questions/0/prompt");
  });

  it("sweeps spatial artifacts nearest-next when positions are known", () => {
    recordRunEvent({ type: "run_created", runId: "run-1" });
    const positions = new Map([
      ["/nodes/far", { x: 900, y: 700 }],
      ["/nodes/origin", { x: 0, y: 0 }],
      ["/nodes/near", { x: 40, y: 30 }],
    ]);
    expect(
      planJoinLateArrival(
        "run-1",
        ["/nodes/far", "/nodes/near", "/nodes/origin"],
        (path) => positions.get(path) ?? null,
      ),
    ).toEqual(["/nodes/origin", "/nodes/near", "/nodes/far"]);
  });
});
