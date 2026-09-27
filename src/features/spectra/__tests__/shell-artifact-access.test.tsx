// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSpectraArtifactForDeepLink, type SpectraArtifact, type SpectraOverview } from "../data/api";
import { createShellArtifactAccess } from "../components/shell-artifact-access";
import { useShellArtifactContent } from "../components/use-shell-artifact-content";
import { mergeShellArtifactContent, releaseShellArtifactContent } from "../components/shell-artifact-content";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function artifact(id = "work"): SpectraArtifact {
  return { _id: id, blueprintKey: "document", title: id, content: "private body", tags: [], status: "active", accessLevel: "modify", createdAt: 1, updatedAt: 1 };
}
function deferred() {
  let resolve!: (value: { artifact: SpectraArtifact | null }) => void;
  const promise = new Promise<{ artifact: SpectraArtifact | null }>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("shell authoritative access reads", () => {
  it.each([
    null,
    { ...artifact(), accessLevel: null },
    { ...artifact(), status: "deleted" as const },
  ])("publishes canonical unavailability and never returns its body (%#)", async (detail) => {
    const access = createShellArtifactAccess(vi.fn().mockResolvedValue({ artifact: detail }));
    const revoked = vi.fn();
    access.subscribe(revoked);
    expect(await access.read("work")).toEqual({ artifact: null });
    expect(revoked).toHaveBeenCalledExactlyOnceWith("work");
  });

  it("forwards cancellation and distinguishes canonical absence/denial from transient failures", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    fetcher.mockResolvedValueOnce(new Response("", { status: 404 }));
    expect(await getSpectraArtifactForDeepLink("work", { signal })).toEqual({ artifact: null });
    expect(fetcher.mock.calls[0][1]).toEqual({ cache: "no-store", signal });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "AUTH_RESOURCE_FORBIDDEN" } }), { status: 403 }));
    expect(await getSpectraArtifactForDeepLink("work")).toEqual({ artifact: null });
    for (const status of [401, 403, 500]) {
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "OTHER", message: "retry later" } }), { status }));
      await expect(getSpectraArtifactForDeepLink("work")).rejects.toThrow("retry later");
    }
  });

  it("evicts an allowed open body on explicit fresh metadata denial, even at the same updatedAt", () => {
    const access = createShellArtifactAccess(vi.fn());
    const body = artifact();
    const source: SpectraOverview = { artifacts: [body], workspaces: [], runs: [], resultCards: [] };
    const { result } = renderHook(() => {
      const content = useShellArtifactContent(["work"]);
      useEffect(() => access.subscribe(content.revokeArtifact), [content.revokeArtifact]);
      return content;
    });
    act(() => {
      result.current.setOverview(source);
      result.current.setHydratedArtifacts({ work: body });
    });
    const denied = { ...releaseShellArtifactContent(body), accessLevel: null };
    // A cached row alone does not establish which permission decision is newer.
    expect(mergeShellArtifactContent(denied, body)).toBe(body);
    act(() => {
      const refresh = access.beginListRefresh();
      refresh.reconcile([denied]);
      refresh.finish();
    });
    expect(result.current.hydratedArtifacts).toEqual({});
    expect(result.current.overview?.artifacts[0]).toMatchObject({ accessLevel: null });
    expect(result.current.overview?.artifacts[0].content).toBeUndefined();
    expect(source.artifacts[0].content).toBe("private body");
  });

  it("ignores list omissions and never reports a transient read failure as revoked", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("offline"));
    const access = createShellArtifactAccess(read);
    const revoked = vi.fn();
    access.subscribe(revoked);
    const refresh = access.beginListRefresh();
    refresh.reconcile([]);
    refresh.finish();
    await expect(access.read("work")).rejects.toThrow("offline");
    expect(revoked).not.toHaveBeenCalled();
  });

  it("does not let an earlier forced list denial defeat a newer authorized detail", async () => {
    const fresh = artifact();
    const access = createShellArtifactAccess(vi.fn().mockResolvedValue({ artifact: fresh }));
    const revoked = vi.fn();
    access.subscribe(revoked);
    const refresh = access.beginListRefresh();
    await access.read("work");
    refresh.reconcile([{ ...releaseShellArtifactContent(fresh), accessLevel: null }]);
    refresh.finish();
    expect(revoked).not.toHaveBeenCalled();
  });

  it("fences an older allowed response behind a newer forced deletion", async () => {
    const old = deferred();
    const access = createShellArtifactAccess(vi.fn().mockReturnValue(old.promise));
    const revoked = vi.fn();
    access.subscribe(revoked);
    const opening = access.read("work");
    const refresh = access.beginListRefresh();
    refresh.reconcile([{ ...releaseShellArtifactContent(artifact()), status: "deleted" }]);
    refresh.finish();
    old.resolve({ artifact: artifact() });
    expect(await opening).toEqual({ artifact: null });
    expect(revoked).toHaveBeenCalledExactlyOnceWith("work");
  });

  it("hands an older open the newer detail instead of revoking a fresh grant or losing navigation", async () => {
    const old = deferred();
    const fresh = { ...artifact(), content: "freshly granted body" };
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ artifact: fresh });
    const access = createShellArtifactAccess(read);
    const revoked = vi.fn();
    access.subscribe(revoked);
    const opening = access.read("work");
    await access.read("work");
    old.resolve({ artifact: null });
    expect((await opening).artifact).toBe(fresh);
    expect(revoked).not.toHaveBeenCalled();
    // Settled results are not an authorization or body cache for a closed reopen.
    read.mockResolvedValueOnce({ artifact: null });
    expect(await access.read("work")).toEqual({ artifact: null });
    expect(read).toHaveBeenCalledTimes(3);
    expect(revoked).toHaveBeenCalledExactlyOnceWith("work");
  });

  it("does not publish revocation from an aborted read even if the reader resolves late", async () => {
    const old = deferred();
    const access = createShellArtifactAccess(vi.fn().mockReturnValue(old.promise));
    const revoked = vi.fn();
    access.subscribe(revoked);
    const controller = new AbortController();
    const reading = access.read("work", { signal: controller.signal });
    controller.abort();
    old.resolve({ artifact: null });
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(revoked).not.toHaveBeenCalled();
  });

  it("keeps a newer same-work handoff through unrelated reads and both delayed lists", async () => {
    const old = deferred();
    const fresh = { ...artifact(), content: "new authorized version" };
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ artifact: fresh });
    const access = createShellArtifactAccess(read);
    const revoked = vi.fn();
    access.subscribe(revoked);
    const firstList = access.beginListRefresh();
    const opening = access.read("work");
    const secondList = access.beginListRefresh();
    expect((await access.read("work")).artifact).toBe(fresh);
    read.mockResolvedValueOnce({ artifact: artifact("unrelated") });
    await access.read("unrelated");
    const staleDenial = { ...releaseShellArtifactContent(fresh), accessLevel: null };
    firstList.reconcile([staleDenial]);
    firstList.finish();
    old.resolve({ artifact: null });
    expect((await opening).artifact).toBe(fresh);
    // The handoff has settled, but the remaining list still needs its fence.
    secondList.reconcile([staleDenial]);
    secondList.finish();
    expect(revoked).not.toHaveBeenCalled();
    read.mockResolvedValueOnce({ artifact: null });
    expect(await access.read("work")).toEqual({ artifact: null });
    expect(revoked).toHaveBeenCalledExactlyOnceWith("work");
  });

  it("releases an aborted overlap without letting its late result affect a newer read", async () => {
    const old = deferred();
    const fresh = { ...artifact(), content: "fresh" };
    const controller = new AbortController();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ artifact: fresh });
    const access = createShellArtifactAccess(read);
    const firstList = access.beginListRefresh();
    const opening = access.read("work", { signal: controller.signal });
    const rejected = expect(opening).rejects.toMatchObject({ name: "AbortError" });
    expect((await access.read("work")).artifact).toBe(fresh);
    controller.abort();
    const revoked = vi.fn();
    access.subscribe(revoked);
    firstList.reconcile([{ ...releaseShellArtifactContent(fresh), accessLevel: null }]);
    firstList.finish();
    expect(revoked).not.toHaveBeenCalled();
    read.mockResolvedValueOnce({ artifact: null });
    expect(await access.read("work")).toEqual({ artifact: null });
    old.resolve({ artifact: artifact() });
    await rejected;
    expect(revoked).toHaveBeenCalledExactlyOnceWith("work");
  });

  it("does not start a detail read for an already aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const read = vi.fn();
    const access = createShellArtifactAccess(read);
    await expect(access.read("work", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(read).not.toHaveBeenCalled();
  });
});
