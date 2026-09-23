import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-server", () => ({
  requireActor: vi.fn(async () => ({ accountId: "account-content-test" })),
}));
vi.mock("@/lib/convex-server", () => ({
  storeArtifactContent: vi.fn(async (_artifactId: string, _content: unknown) => ({
    spectraContentRef: { version: 1, payloadRef: "durable-body" },
  })),
}));

describe("durable content route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("accepts a valid body larger than Next's default 10 MiB proxy cap", async () => {
    const { POST } = await import("../content/route");
    const { storeArtifactContent } = await import("@/lib/convex-server");
    const text = "x".repeat(10 * 1024 * 1024 + 128);
    const response = await POST(new Request(
      "http://localhost/api/spectra/content?artifactId=large-content-test",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      },
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      spectraContentRef: { version: 1, payloadRef: "durable-body" },
    });
    expect(vi.mocked(storeArtifactContent)).toHaveBeenCalledWith(
      "large-content-test",
      { text },
    );
  });
});
