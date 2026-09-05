import { describe, expect, it } from "vitest";
import { orgNodeCountIdentity } from "../../../../convex/orgNodeAggregates";

function node(patch: Record<string, unknown>) {
  return {
    _id: "node-1",
    accountId: "acct-1",
    kind: "work",
    typeKey: "document",
    parentId: "parent-1",
    workspaceContextId: "ws-1",
    activityAt: 100,
    updatedAt: 100,
    ...patch,
  } as never;
}

describe("orgNodeCountIdentity", () => {
  it("ignores activity timestamps so a stamp does not rewrite type or parent counts", () => {
    const before = node({ updatedAt: 1, activityAt: 1 });
    const after = node({ updatedAt: 2, activityAt: 2 });
    expect(orgNodeCountIdentity("type", before)).toBe(
      orgNodeCountIdentity("type", after),
    );
    expect(orgNodeCountIdentity("parent", before)).toBe(
      orgNodeCountIdentity("parent", after),
    );
    expect(orgNodeCountIdentity("workspace", before)).toBe(
      orgNodeCountIdentity("workspace", after),
    );
  });

  it("changes when the live parent or workspace context changes", () => {
    const before = node({});
    expect(orgNodeCountIdentity("parent", before)).not.toBe(
      orgNodeCountIdentity("parent", node({ parentId: "parent-2" })),
    );
    expect(orgNodeCountIdentity("workspace", before)).not.toBe(
      orgNodeCountIdentity("workspace", node({ workspaceContextId: "ws-2" })),
    );
  });
});
