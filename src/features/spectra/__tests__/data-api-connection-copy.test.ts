import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SPECTRA_REQUEST_UNREACHABLE,
  getSpectraAgentPage,
  postSpectra,
} from "../data/api";
import { getAdministration, mutateAdministration } from "../administration/api";
import { fetchCalendarOverview } from "../calendar/data/overview-client";
import { spectraFailureMessage } from "../data/request";

afterEach(() => vi.unstubAllGlobals());

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
