import { describe, expect, it, vi } from "vitest";
import { convexQuery } from "@/lib/convex-server";
import { readQuery } from "./io";

vi.mock("@/lib/convex-server", () => ({
  convexAction: vi.fn(),
  convexMutation: vi.fn(),
  convexQuery: vi.fn(),
}));

describe("readQuery", () => {
  it("preserves a permissioned read value", async () => {
    vi.mocked(convexQuery).mockResolvedValueOnce([{ _id: "artifact-1" }]);

    await expect(
      readQuery(
        "spectraArtifacts:list",
        { actorClerkId: "actor-1" },
        "your Spectra library",
      ),
    ).resolves.toEqual({
      ok: true,
      value: [{ _id: "artifact-1" }],
    });
  });

  it("returns a bounded retryable result instead of pretending the read was empty", async () => {
    vi.mocked(convexQuery).mockRejectedValueOnce(
      new Error("backend unavailable"),
    );

    await expect(
      readQuery(
        "spectraArtifacts:get",
        { actorClerkId: "actor-1" },
        "that Spectra artifact",
      ),
    ).resolves.toEqual({
      ok: false,
      code: "context_read_unavailable",
      message:
        "Spectra could not read that Spectra artifact right now. Use the existing context or try one bounded read again.",
      retryable: true,
    });
  });
});
