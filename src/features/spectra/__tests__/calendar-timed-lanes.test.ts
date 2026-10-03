import { describe, expect, it } from "vitest";
import { layoutTimedLanes } from "../calendar/domain/timed-lanes";

const H = 60 * 60_000;

describe("layoutTimedLanes", () => {
  it("gives a lone block the whole column", () => {
    expect(layoutTimedLanes([{ id: "a", start: 0, end: H }]).get("a")).toEqual({ lane: 0, lanes: 1 });
  });

  it("puts blocks at the same time side by side", () => {
    const lanes = layoutTimedLanes([
      { id: "official", start: 16 * H, end: 16.5 * H },
      { id: "scheduled", start: 16 * H, end: 16.5 * H },
    ]);
    expect(lanes.get("official")!.lanes).toBe(2);
    expect(lanes.get("scheduled")!.lanes).toBe(2);
    expect(new Set([lanes.get("official")!.lane, lanes.get("scheduled")!.lane])).toEqual(new Set([0, 1]));
  });

  it("shares a lane count across a chain of overlaps and reuses freed lanes", () => {
    const lanes = layoutTimedLanes([
      { id: "a", start: 9 * H, end: 11 * H },
      { id: "b", start: 9.5 * H, end: 10 * H },
      { id: "c", start: 10 * H, end: 10.5 * H },
      { id: "d", start: 12 * H, end: 13 * H },
    ]);
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("c")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("d")).toEqual({ lane: 0, lanes: 1 });
  });

  it("does not treat touching blocks as overlapping", () => {
    const lanes = layoutTimedLanes([
      { id: "a", start: 0, end: H },
      { id: "b", start: H, end: 2 * H },
    ]);
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 1 });
    expect(lanes.get("b")).toEqual({ lane: 0, lanes: 1 });
  });
});
