import { describe, expect, it } from "vitest";
import {
  applyOverrides,
  computeCanonicalLayout,
  getLifecycleVisuals,
  RADIAL_DISTANCE,
  WORKSTREAM_MIN_DISTANCE,
} from "@/lib/workspace/auto-layout";
import type { Workstream } from "@/hooks/use-workspace-data";

function makeWorkstream(overrides: Partial<Workstream> & Pick<Workstream, "_id" | "type" | "title" | "status">): Workstream {
  const now = Date.now();
  return {
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("workspace auto layout", () => {
  it("keeps active, quiet, completed, and archived workstreams in distinct radial bands", () => {
    const now = Date.now();
    const layout = computeCanonicalLayout([
      makeWorkstream({ _id: "active", type: "subject", title: "Active", status: "active", lastActivityAt: now }),
      makeWorkstream({ _id: "quiet", type: "subject", title: "Quiet", status: "active", lastActivityAt: now - 15 * 24 * 60 * 60 * 1000 }),
      makeWorkstream({ _id: "done", type: "project", title: "Done", status: "completed", lastActivityAt: now - 2 * 24 * 60 * 60 * 1000 }),
      makeWorkstream({ _id: "archived", type: "general", title: "Archived", status: "archived", lastActivityAt: now - 30 * 24 * 60 * 60 * 1000 }),
    ]);

    const radiusOf = (id: string) => {
      const pos = layout.positions.get(id);
      expect(pos).toBeDefined();
      return Math.round(Math.hypot(pos!.x, pos!.y));
    };

    expect(radiusOf("active")).toBeGreaterThanOrEqual(RADIAL_DISTANCE.active - 50);
    expect(radiusOf("active")).toBeLessThan(RADIAL_DISTANCE.quiet);
    expect(radiusOf("quiet")).toBeGreaterThanOrEqual(RADIAL_DISTANCE.quiet - 50);
    expect(radiusOf("done")).toBeGreaterThanOrEqual(RADIAL_DISTANCE.completed - 50);
    expect(radiusOf("archived")).toBeGreaterThanOrEqual(RADIAL_DISTANCE.archived - 50);
  });

  it("maintains minimum spacing between neighboring territories", () => {
    const workstreams = Array.from({ length: 6 }, (_, index) =>
      makeWorkstream({
        _id: `ws-${index}`,
        type: index < 3 ? "subject" : "project",
        title: `Workspace ${index}`,
        status: "active",
        lastActivityAt: Date.now() - index * 60_000,
      }),
    );

    const layout = computeCanonicalLayout(workstreams);
    const positions = Array.from(layout.positions.values());

    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const a = positions[i]!;
        const b = positions[j]!;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        expect(distance).toBeGreaterThanOrEqual(WORKSTREAM_MIN_DISTANCE - 5);
      }
    }
  });

  it("prefers persisted and local overrides over canonical layout", () => {
    const workstream = makeWorkstream({
      _id: "ws-1",
      type: "subject",
      title: "Pinned",
      status: "active",
      canvasX: 111,
      canvasY: 222,
    });
    const canonical = computeCanonicalLayout([workstream]);

    const withPersisted = applyOverrides(canonical, [workstream]);
    expect(withPersisted.get("ws-1")).toEqual({ x: 111, y: 222 });

    const local = new Map([["ws-1", { x: 333, y: 444 }]]);
    const withLocal = applyOverrides(canonical, [workstream], local);
    expect(withLocal.get("ws-1")).toEqual({ x: 333, y: 444 });
  });

  it("marks completed workspaces as visually diminished", () => {
    expect(getLifecycleVisuals(makeWorkstream({
      _id: "done",
      type: "subject",
      title: "Done",
      status: "completed",
    }))).toEqual({ opacity: 0.35, scale: 0.85, dashed: true });
  });
});
