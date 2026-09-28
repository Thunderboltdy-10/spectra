import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SPECTRA_REQUEST_UNREACHABLE,
  getSpectraAgentPage,
  postSpectra,
} from "../data/api";
import { getAdministration, mutateAdministration } from "../administration/api";
import { fetchCalendarOverview } from "../calendar/data/overview-client";

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
