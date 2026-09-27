import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SPECTRA_REQUEST_UNREACHABLE,
  getSpectraAgentPage,
  postSpectra,
} from "../data/api";

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
});
