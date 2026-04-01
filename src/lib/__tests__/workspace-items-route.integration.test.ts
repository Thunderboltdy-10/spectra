import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("workspace items route integration", () => {
  it("lists workspace items scoped to a workstream", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_workspace" });
    const convexQuery = vi.fn().mockResolvedValue([{ _id: "item_1", title: "Essay draft" }]);

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));

    const route = await import("@/app/api/workspace-items/route");
    const response = await route.GET(
      new NextRequest("http://localhost/api/workspace-items?workstreamId=ws_1&limit=12"),
    );
    const payload = (await response.json()) as { items: Array<{ _id: string; title: string }> };

    expect(response.status).toBe(200);
    expect(payload.items).toEqual([{ _id: "item_1", title: "Essay draft" }]);
    expect(convexQuery).toHaveBeenCalledWith("workspaceItems:list", {
      actorClerkId: "user_workspace",
      workstreamId: "ws_1",
      limit: 12,
    });
  });

  it("creates workspace items through the route", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_workspace" });
    const convexMutation = vi.fn().mockResolvedValue({ itemId: "item_2" });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery: vi.fn(), convexMutation }));

    const route = await import("@/app/api/workspace-items/route");
    await route.POST(
      new NextRequest("http://localhost/api/workspace-items", {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          workstreamId: "ws_1",
          type: "document",
          renderMode: "document",
          sourceArtifactId: "artifact_1",
          title: "Essay draft",
          contentSummary: "Open the next revision.",
          x: 120,
          y: 240,
          width: 280,
          height: 160,
          pinned: true,
        }),
      }),
    );

    expect(convexMutation).toHaveBeenCalledWith("workspaceItems:create", {
      actorClerkId: "user_workspace",
      workstreamId: "ws_1",
      type: "document",
      renderMode: "document",
      sourceChatId: undefined,
      sourceArtifactId: "artifact_1",
      sourcePlannerItemId: undefined,
      title: "Essay draft",
      contentSummary: "Open the next revision.",
      x: 120,
      y: 240,
      width: 280,
      height: 160,
      pinned: true,
    });
  });

  it("lists workspace merge candidates through the route", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_workspace" });
    const convexQuery = vi.fn().mockResolvedValue({
      candidates: [{ sourceKind: "artifact", sourceId: "artifact_1", title: "Essay draft" }],
    });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));

    const route = await import("@/app/api/workspace-items/route");
    const response = await route.GET(
      new NextRequest("http://localhost/api/workspace-items?action=listMergeCandidates&workstreamId=ws_1&topic=essay&limit=5"),
    );
    const payload = (await response.json()) as {
      candidates: Array<{ sourceKind: string; sourceId: string; title: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.candidates).toEqual([
      { sourceKind: "artifact", sourceId: "artifact_1", title: "Essay draft" },
    ]);
    expect(convexQuery).toHaveBeenCalledWith("workspaceItems:listMergeCandidates", {
      actorClerkId: "user_workspace",
      workstreamId: "ws_1",
      topic: "essay",
      limit: 5,
    });
  });

  it("creates workspace widgets through the route", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_workspace" });
    const convexMutation = vi.fn().mockResolvedValue({ itemId: "item_3", mutationId: "mut_1" });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery: vi.fn(), convexMutation }));

    const route = await import("@/app/api/workspace-items/route");
    await route.POST(
      new NextRequest("http://localhost/api/workspace-items", {
        method: "POST",
        body: JSON.stringify({
          action: "createWidget",
          workstreamId: "ws_1",
          type: "custom",
          itemType: "custom",
          category: "custom",
          title: "Prompt scratchpad",
          contentSummary: "Temporary capture area",
          x: 96,
          y: 208,
          width: 320,
          height: 200,
          hidden: false,
          collapsed: false,
          pinned: false,
          provenanceSource: "ai",
          provenanceAction: "created",
          mutationSummary: "Created scratchpad widget",
        }),
      }),
    );

    expect(convexMutation).toHaveBeenCalledWith("workspaceItems:createWidget", {
      actorClerkId: "user_workspace",
      workstreamId: "ws_1",
      type: "custom",
      itemType: "custom",
      renderMode: undefined,
      sourceChatId: undefined,
      sourceArtifactId: undefined,
      sourcePlannerItemId: undefined,
      title: "Prompt scratchpad",
      contentSummary: "Temporary capture area",
      x: 96,
      y: 208,
      width: 320,
      height: 200,
      zIndex: undefined,
      category: "custom",
      pinned: false,
      collapsed: false,
      hidden: false,
      visualGroup: undefined,
      renderProps: undefined,
      provenanceSource: "ai",
      provenanceAction: "created",
      mutationSummary: "Created scratchpad widget",
    });
  });
});
