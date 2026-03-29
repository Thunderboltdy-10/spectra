import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("notes route compatibility", () => {
  it("lists documents through the compatibility query", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_notes" });
    const convexQuery = vi.fn().mockResolvedValue([{ _id: "artifact_1", title: "Biology notes" }]);

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));

    const route = await import("@/app/api/notes/route");
    const response = await route.GET(new NextRequest("http://localhost/api/notes?workstreamId=ws_1&limit=20"));
    const payload = (await response.json()) as { notes: Array<{ _id: string }> };

    expect(response.status).toBe(200);
    expect(payload.notes).toEqual([{ _id: "artifact_1", title: "Biology notes" }]);
    expect(convexQuery).toHaveBeenCalledWith("notes:list", {
      actorClerkId: "user_notes",
      workstreamId: "ws_1",
      search: undefined,
      limit: 20,
    });
  });

  it("creates a document artifact through notes compatibility with provenance fields", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_notes" });
    const convexMutation = vi.fn().mockResolvedValue({ noteId: "artifact_2" });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery: vi.fn(), convexMutation }));

    const route = await import("@/app/api/notes/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/notes", {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          title: "CAS reflection",
          content: { type: "doc", content: [] },
          contentPlaintext: "Reflection text",
          editorMode: "standard",
          sourceType: "managebac_sync",
          managebacItemId: "mb_1",
          sourceUpdatedAt: 123,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(convexMutation).toHaveBeenCalledWith("notes:create", {
      actorClerkId: "user_notes",
      title: "CAS reflection",
      content: { type: "doc", content: [] },
      contentPlaintext: "Reflection text",
      editorMode: "standard",
      sourceType: "managebac_sync",
      managebacItemId: "mb_1",
      sourceDeleted: undefined,
      sourceUpdatedAt: 123,
      syncConflictSummary: undefined,
      workstreamId: undefined,
      artifactId: undefined,
      lastAiEditId: undefined,
      pendingDiffs: undefined,
    });
  });

  it("returns the migrated document id when a legacy note update is proxied", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_notes" });
    const convexMutation = vi.fn().mockResolvedValue({
      success: true,
      noteId: "artifact_migrated_1",
      migratedFromLegacy: true,
    });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery: vi.fn(), convexMutation }));

    const route = await import("@/app/api/notes/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/notes", {
        method: "POST",
        body: JSON.stringify({
          action: "update",
          noteId: "legacy_note_1",
          title: "Migrated title",
        }),
      }),
    );

    const payload = (await response.json()) as { success: boolean; noteId: string; migratedFromLegacy: boolean };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      noteId: "artifact_migrated_1",
      migratedFromLegacy: true,
    });
    expect(convexMutation).toHaveBeenCalledWith("notes:update", {
      actorClerkId: "user_notes",
      noteId: "legacy_note_1",
      title: "Migrated title",
      content: undefined,
      contentPlaintext: undefined,
      editorMode: undefined,
      sourceType: undefined,
      managebacItemId: undefined,
      sourceDeleted: undefined,
      sourceUpdatedAt: undefined,
      syncConflictSummary: undefined,
      workstreamId: undefined,
      artifactId: undefined,
      lastAiEditId: undefined,
      pendingDiffs: undefined,
    });
  });
});
