import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("artifacts route integration", () => {
  it("falls back to legacy note migration when fetching a document by old note id", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_artifacts" });
    const convexQuery = vi
      .fn()
      .mockRejectedValueOnce(new Error("Artifact not found"))
      .mockResolvedValueOnce({ _id: "artifact_legacy_1", title: "Migrated artifact" });
    const convexMutation = vi
      .fn()
      .mockResolvedValueOnce({ artifactId: "artifact_legacy_1" });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));

    const route = await import("@/app/api/artifacts/route");
    const response = await route.GET(
      new NextRequest("http://localhost/api/artifacts?action=get&id=legacy_note_1"),
    );
    const payload = (await response.json()) as { artifact: { _id: string; title: string } };

    expect(response.status).toBe(200);
    expect(payload.artifact).toEqual({
      _id: "artifact_legacy_1",
      title: "Migrated artifact",
    });
    expect(convexMutation).toHaveBeenCalledWith("artifacts:getOrMigrateFromNote", {
      actorClerkId: "user_artifacts",
      noteId: "legacy_note_1",
    });
    expect(convexQuery).toHaveBeenNthCalledWith(2, "artifacts:get", {
      actorClerkId: "user_artifacts",
      artifactId: "artifact_legacy_1",
    });
  });

  it("does not trigger legacy migration on unexpected artifact lookup failures", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_artifacts" });
    const convexQuery = vi.fn().mockRejectedValueOnce(new Error("database offline"));
    const convexMutation = vi.fn();

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));

    const route = await import("@/app/api/artifacts/route");
    const response = await route.GET(
      new NextRequest("http://localhost/api/artifacts?action=get&id=artifact_1"),
    );
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; status?: number };
    };

    expect(response.status).toBe(500);
    expect(convexMutation).not.toHaveBeenCalledWith("artifacts:getOrMigrateFromNote", expect.anything());
    expect(payload.error).toEqual(expect.objectContaining({
      code: "INTERNAL_ERROR",
      message: "Unexpected server error",
      status: 500,
    }));
  });
});
