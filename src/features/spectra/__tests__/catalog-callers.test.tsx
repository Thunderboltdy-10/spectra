// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentCatalog, useWorkspaceCatalog } from "../data/use-catalog-pages";
import { spectraAgentCatalog, spectraWorkspaceCatalog } from "../data/api";

const auth = vi.hoisted(() => ({ userId: "user", sessionId: "session", identity: { accountId: "account", schoolId: "school", membershipId: "membership" } }));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => auth }));
vi.mock("convex/react", () => ({ useConvexAuth: () => ({ isAuthenticated: true }), useQuery: (_query: unknown, args: unknown) => args === "skip" ? undefined : { catalog: auth.identity } }));
vi.mock("../data/use-authed-args", () => ({ useAuthedArgs: (args: unknown) => args }));
const row = (id: string) => ({ _id: id, title: id, status: "active", lastActivityAt: 1 });
const page = (items: unknown[], cursor: string | null) => Response.json({ items, isDone: cursor === null, continueCursor: cursor });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  auth.sessionId = "session";
  auth.identity = { accountId: "account", schoolId: "school", membershipId: "membership" };
  spectraWorkspaceCatalog.retainScope("reset/");
  spectraAgentCatalog.retainScope("reset/");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("registered catalogue client callers", () => {
  it("shares workspace progress, keeps selected metadata and reaches the next visible page", async () => {
    const pending = deferred<Response>();
    const fetch = vi.fn((url: string) => {
      const params = new URL(url, "https://spectra.test").searchParams;
      if (params.get("action") === "workspaceMetadata") return Promise.resolve(Response.json({ workspace: row("selected") }));
      if (!params.has("cursor")) return pending.promise;
      if (params.get("cursor") === "scan") return Promise.resolve(page([row("first")], "next"));
      return Promise.resolve(page([row("late")], null));
    });
    vi.stubGlobal("fetch", fetch);
    const first = renderHook(() => useWorkspaceCatalog("selected"));
    const second = renderHook(() => useWorkspaceCatalog());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await act(async () => pending.resolve(page([], "scan")));
    await waitFor(() => expect(first.result.current.items.map(item => item._id)).toEqual(["selected", "first"]));
    expect(second.result.current.items.map(item => item._id)).toEqual(["first"]);
    expect(first.result.current.isDone).toBe(false);
    await act(() => second.result.current.more());
    expect(first.result.current.items.map(item => item._id)).toEqual(["selected", "first", "late"]);
    expect(second.result.current.isDone).toBe(true);
    expect(fetch.mock.calls.every(([url]) => !url.includes("action=workspaces") && !url.includes("action=workspace&"))).toBe(true);
  });

  it("gates a stale prior-school response and aborts it on membership transition", async () => {
    const old = deferred<Response>();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([row("new-school")], null));
    vi.stubGlobal("fetch", fetch);
    const hook = renderHook(() => useWorkspaceCatalog());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    auth.identity = { accountId: "account", schoolId: "new-school", membershipId: "new-membership" };
    hook.rerender();
    await waitFor(() => expect(hook.result.current.items[0]?._id).toBe("new-school"));
    expect(signal.aborted).toBe(true);
    await act(async () => old.resolve(page([row("old-private")], null)));
    expect(hook.result.current.items.map(item => item._id)).toEqual(["new-school"]);
  });

  it("finishes every agent result page before reporting complete filter metadata", async () => {
    const tail = deferred<Response>();
    const fetch = vi.fn().mockResolvedValueOnce(page([row("first-agent")], "next"))
      .mockReturnValueOnce(tail.promise);
    vi.stubGlobal("fetch", fetch);
    const hook = renderHook(() => useAgentCatalog());
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    expect(hook.result.current.status).toBe("loading");
    const refresh = hook.result.current.refresh(true);
    await act(async () => { tail.resolve(page([row("last-agent")], null)); await refresh; });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(hook.result.current.items.map(item => item._id)).toEqual(["first-agent", "last-agent"]);
    expect(hook.result.current.isDone).toBe(true);
    expect(fetch.mock.calls.every(([url]) => url.includes("action=agentGraphPage"))).toBe(true);
  });
});
