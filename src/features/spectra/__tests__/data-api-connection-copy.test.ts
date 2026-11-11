import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SPECTRA_REQUEST_UNREACHABLE,
  getSpectraAgentPage,
  getSpectraOverview,
  invalidateSpectraCache,
  postSpectra,
  resolveSpectraManageBacIdentity,
} from "../data/api";
import { getAdministration, mutateAdministration } from "../administration/api";
import { fetchCalendarOverview } from "../calendar/data/overview-client";
import { readConvexError } from "../../../../shared/convex-error.mjs";
import { spectraFailureMessage } from "../data/request";

afterEach(() => vi.unstubAllGlobals());

it("keeps context-only and full overview caches and in-flight reads separate", async () => {
  invalidateSpectraCache();
  const fetcher = vi.fn(async (url: string) => Response.json({
    workspaces: url.includes("includeCatalog=false") ? [] : [{ _id: "workspace_1" }],
    artifacts: url.includes("includeCatalog=false") ? [] : [{ _id: "artifact_1" }], workspace: null,
    runs: url.includes("includeRuns=false") ? [] : [{ _id: "run_1" }],
    resultCards: url.includes("includeRuns=false") ? [] : [{ _id: "card_1" }],
  }));
  vi.stubGlobal("fetch", fetcher);
  try {
    const [catalog, joined, full] = await Promise.all([
      getSpectraOverview(undefined, false, false),
      getSpectraOverview(undefined, false, false),
      getSpectraOverview(),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toContain("includeCatalog=false");
    expect(joined).toBe(catalog);
    expect(catalog.runs).toEqual([]);
    expect(catalog.resultCards).toEqual([]);
    expect(full.runs).toEqual([{ _id: "run_1" }]);
    expect(full.resultCards).toEqual([{ _id: "card_1" }]);
    expect(full.artifacts).toBe(catalog.artifacts);
    expect(full.workspaces).toBe(catalog.workspaces);
    expect(await getSpectraOverview()).toBe(full);
    expect(await getSpectraOverview(undefined, false, false)).toBe(catalog);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await getSpectraOverview(undefined, true, false);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect((await getSpectraOverview()).runs).toEqual([{ _id: "run_1" }]);
  } finally { invalidateSpectraCache(); }
});

it("reuses full catalogs in Home and retains their original expiry when loading runs later", async () => {
  invalidateSpectraCache();
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
  const fetcher = vi.fn(async (_url: string) => Response.json({ workspaces: [], artifacts: [], workspace: null, runs: [], resultCards: [] }));
  vi.stubGlobal("fetch", fetcher);
  try {
    await getSpectraOverview(undefined, false, false);
    clock.mockReturnValue(100_000);
    const full = await getSpectraOverview();
    expect(fetcher.mock.calls[1]?.[0]).toContain("includeCatalog=false");
    clock.mockReturnValue(300_999);
    expect(await getSpectraOverview()).toBe(full);
    clock.mockReturnValue(301_001);
    const refreshed = await getSpectraOverview();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(await getSpectraOverview(undefined, false, false)).toBe(refreshed);
    expect(fetcher).toHaveBeenCalledTimes(3);
  } finally { clock.mockRestore(); invalidateSpectraCache(); }
});

it.each([false, true])("shares a full read and refreshes the opposite mode after force (includeRuns=%s)", async includeRuns => {
  invalidateSpectraCache();
  const fetcher = vi.fn(async (url: string) => Response.json({
    workspaces: [], workspace: null, runs: [], resultCards: [],
    artifacts: url.includes("includeCatalog=false") ? [] : [{ _id: `artifact_${fetcher.mock.calls.length}` }],
  }));
  vi.stubGlobal("fetch", fetcher);
  try {
    const [full, catalog] = await Promise.all([getSpectraOverview(), getSpectraOverview(undefined, false, false)]);
    expect(catalog).toBe(full);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const fresh = await getSpectraOverview(undefined, true, includeRuns);
    expect(fresh.artifacts).toEqual([{ _id: "artifact_2" }]);
    expect((await getSpectraOverview(undefined, false, !includeRuns)).artifacts).toEqual(fresh.artifacts);
    expect(fetcher).toHaveBeenCalledTimes(includeRuns ? 2 : 3);
  } finally { invalidateSpectraCache(); }
});

describe("data API failure wording", () => {
  it("turns the browser's offline error into a sentence a student can act on", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(postSpectra({ action: "addComment" })).rejects.toThrow(
      SPECTRA_REQUEST_UNREACHABLE,
    );
  });

  it("keeps aborts distinguishable so cancelled reads stay silent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "AbortError")),
    );
    await expect(getSpectraAgentPage()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("never prints an HTTP status when a gateway answers without a message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 })),
    );
    const failure = await postSpectra({ action: "addComment" }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toMatch(/\d{3}|request failed/i);
    expect((failure as Error).message).toMatch(/Try again/);
  });

  it("rewords offline failures in the Calendar and school administration clients", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchCalendarOverview(0, 1)).rejects.toThrow(SPECTRA_REQUEST_UNREACHABLE);
    await expect(getAdministration("people")).rejects.toThrow(SPECTRA_REQUEST_UNREACHABLE);
    await expect(mutateAdministration("inviteMember")).rejects.toThrow(SPECTRA_REQUEST_UNREACHABLE);
  });

  it("never shows a JSON parse error or a vague admin failure behind a gateway page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response("<html>Bad gateway</html>", { status: 502 })),
    );
    const calendar = await fetchCalendarOverview(0, 1).catch((error: Error) => error);
    expect((calendar as Error).message).toBe("Could not load Calendar.");
    const admin = await getAdministration("people").catch((error: Error) => error);
    expect((admin as Error).message).toMatch(/Try again/);
  });
});

describe("run control failure wording", () => {
  const copy = { fallback: "This run can no longer be stopped safely.", signedOut: "Sign in again to stop this run." };

  it("tells a signed-out caller to sign in instead of blaming the run", async () => {
    const response = new Response("AUTH_NOT_SIGNED_IN: Sign in to continue.", { status: 401 });
    await expect(spectraFailureMessage(response, copy)).resolves.toBe("Sign in again to stop this run.");
  });

  it("shows a short plain sentence from the route as written", async () => {
    const response = new Response("Undo is available after Spectra finishes this run.", { status: 409 });
    await expect(spectraFailureMessage(response, copy)).resolves.toBe("Undo is available after Spectra finishes this run.");
  });

  it.each([
    ["a platform error page", new Response("<html>Bad gateway</html>", { status: 502 })],
    ["a server failure body", new Response("TypeError: fetch failed at runtime.ts:3636", { status: 500 })],
    ["an HTML 4xx page", new Response("<!doctype html><p>Forbidden</p>", { status: 403, headers: { "content-type": "text/plain" } })],
    ["a JSON envelope", Response.json({ ok: false, error: { code: "AUTH_NO_ACCESS" } }, { status: 403 })],
    ["an empty body", new Response(null, { status: 404 })],
  ])("uses the caller's copy for %s", async (_label, response) => {
    await expect(spectraFailureMessage(response, copy)).resolves.toBe(copy.fallback);
  });
});

it("preserves a ManageBac action error code alongside its user-readable message", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: {
    code: "INTEGRATION_NOT_READY", message: "ManageBac must be connected with verified readable capabilities.",
  } }, { status: 409 })));
  const failure = await resolveSpectraManageBacIdentity().catch(error => error);
  expect(readConvexError(failure)).toEqual({
    code: "INTEGRATION_NOT_READY", message: "ManageBac must be connected with verified readable capabilities.",
  });
});
