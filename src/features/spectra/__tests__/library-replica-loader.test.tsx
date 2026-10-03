// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const convex = vi.hoisted(() => ({
  answers: [] as unknown[],
  args: [] as unknown[],
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (_query: unknown, args: unknown) => {
    convex.args.push(args);
    if (args === "skip") return undefined;
    return convex.answers.length > 1 ? convex.answers.shift() : convex.answers[0];
  },
}));

import {
  ReplicaPresentationLoader,
  replicaRowsInFlight,
} from "../organization/library-organizer";

const locked = [
  {
    workId: "deck",
    replicas: [
      { kind: "cloud" as const, state: "current" as const },
      { kind: "local" as const, state: "pending" as const, errorCode: "office-locked" },
    ],
    openConflictCount: 0,
    pendingCount: 1,
  },
];
const settled = [
  {
    workId: "deck",
    replicas: [
      { kind: "cloud" as const, state: "current" as const },
      { kind: "local" as const, state: "current" as const },
    ],
    openConflictCount: 0,
    pendingCount: 0,
  },
];

afterEach(() => {
  cleanup();
  convex.answers = [];
  convex.args = [];
});

describe("Library replica presentation loader (LV-046)", () => {
  it("knows a queued or Office-held write is still in flight", () => {
    expect(replicaRowsInFlight(locked)).toBe(true);
    expect(replicaRowsInFlight(settled)).toBe(false);
    expect(replicaRowsInFlight([])).toBe(false);
  });

  it("stays subscribed while Office holds the file, and parks once the write lands", () => {
    const onRows = vi.fn();
    convex.answers = [locked];
    const view = render(<ReplicaPresentationLoader onRows={onRows} />);
    view.rerender(<ReplicaPresentationLoader onRows={onRows} />);
    expect(onRows).toHaveBeenLastCalledWith(locked);
    // Still live: the next render asks Convex again instead of skipping.
    expect(convex.args.at(-1)).toEqual({});

    convex.answers = [settled];
    view.rerender(<ReplicaPresentationLoader onRows={onRows} />);
    expect(onRows).toHaveBeenLastCalledWith(settled);
    view.rerender(<ReplicaPresentationLoader onRows={onRows} />);
    expect(convex.args.at(-1)).toBe("skip");
  });
});
