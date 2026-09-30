// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({
  authenticated: true,
  identity: undefined as
    | undefined
    | null
    | { accountId: string; schoolId: string; membershipId: string },
  queries: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: session.authenticated }),
  useQuery: (query: unknown, args: unknown) => {
    session.queries(query, args);
    return args === "skip" ? undefined : session.identity;
  },
}));
import { api } from "../../../../convex/_generated/api";
import { useAuthedArgs } from "../data/use-authed-args";
import { useLiveOrgIdentities } from "../organization/tree-client";
beforeEach(() => {
  session.authenticated = true;
  session.identity = undefined;
  session.queries.mockClear();
});
afterEach(cleanup);
describe("school-scoped reactive reads", () => {
  it.each([undefined, null])(
    "skips persisted open-object reads while membership is %s",
    (identity) => {
      session.identity = identity;
      renderHook(() =>
        useLiveOrgIdentities([
          { kind: "workspace", sourceId: "saved-other-deployment-workspace" },
        ]),
      );
      expect(session.queries).toHaveBeenCalledWith(
        api.orgTree.liveIdentities,
        "skip",
      );
    },
  );
  it("subscribes to membership and resumes then stops a read as it changes", () => {
    const args = { artifactId: "saved-artifact" };
    const hook = renderHook(() => useAuthedArgs(args));
    expect(hook.result.current).toBe("skip");
    expect(session.queries).toHaveBeenCalledWith(api.catalogGraph.identity, {});
    session.identity = {
      accountId: "account",
      schoolId: "school",
      membershipId: "member",
    };
    hook.rerender();
    expect(hook.result.current).toBe(args);
    session.identity = null;
    hook.rerender();
    expect(hook.result.current).toBe("skip");
  });
  it("skips all subscriptions after sign-out even with a previous identity", () => {
    session.authenticated = false;
    session.identity = {
      accountId: "account",
      schoolId: "school",
      membershipId: "member",
    };
    expect(renderHook(() => useAuthedArgs({})).result.current).toBe("skip");
    expect(session.queries).toHaveBeenCalledWith(
      api.catalogGraph.identity,
      "skip",
    );
  });
  it("does not subscribe to membership when the caller explicitly skips", () => {
    expect(renderHook(() => useAuthedArgs("skip")).result.current).toBe("skip");
    expect(session.queries).toHaveBeenCalledWith(
      api.catalogGraph.identity,
      "skip",
    );
  });
});

it("keeps the catalog identity bootstrap independent of membership", () => {
  const args = {};
  expect(renderHook(() => useAuthedArgs(args, "account")).result.current).toBe(
    args,
  );
  expect(session.queries).toHaveBeenCalledWith(
    api.catalogGraph.identity,
    "skip",
  );
  session.authenticated = false;
  expect(renderHook(() => useAuthedArgs(args, "account")).result.current).toBe(
    "skip",
  );
});
