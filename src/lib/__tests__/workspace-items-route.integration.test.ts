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


  it("lists ghost suggestions through the route", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_workspace" });
    const convexQuery = vi.fn().mockResolvedValue({
      sessionKey: "ws_1:123",
      ghosts: [
        { _id: "ghost_1", title: "Quiz me on mitosis", confidenceTier: "medium" },
      ],
    });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));

    const route = await import("@/app/api/workspace-items/route");
    const response = await route.GET(
      new NextRequest("http://localhost/api/workspace-items?action=listGhosts&workstreamId=ws_1&sessionKey=ws_1:123"),
    );
    const payload = (await response.json()) as {
      sessionKey: string;
      ghosts: Array<{ _id: string; title: string; confidenceTier: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.ghosts).toHaveLength(1);
    expect(convexQuery).toHaveBeenCalledWith("ghosts:listVisible", {
      actorClerkId: "user_workspace",
      workstreamId: "ws_1",
      sessionKey: "ws_1:123",
      editingActive: false,
    });
  });

  it("accepts ghost actions through the route", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_workspace" });
    const convexMutation = vi.fn().mockResolvedValue({ success: true, workspaceItemId: "item_ghost_1" });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery: vi.fn(), convexMutation }));

    const route = await import("@/app/api/workspace-items/route");
    await route.POST(
      new NextRequest("http://localhost/api/workspace-items", {
        method: "POST",
        body: JSON.stringify({
          action: "acceptGhost",
          ghostId: "ghost_1",
        }),
      }),
    );

    expect(convexMutation).toHaveBeenCalledWith("ghosts:accept", {
      actorClerkId: "user_workspace",
      ghostId: "ghost_1",
    });
  });

  it("passes editingActive to ghost listing so editing suppresses ghosts", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_workspace" });
    const convexQuery = vi.fn().mockResolvedValue({
      sessionKey: "ws_1:123",
      ghosts: [],
    });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));

    const route = await import("@/app/api/workspace-items/route");
    const response = await route.GET(
      new NextRequest("http://localhost/api/workspace-items?action=listGhosts&workstreamId=ws_1&sessionKey=ws_1:123&editingActive=true"),
    );

    expect(response.status).toBe(200);
    expect(convexQuery).toHaveBeenCalledWith("ghosts:listVisible", {
      actorClerkId: "user_workspace",
      workstreamId: "ws_1",
      sessionKey: "ws_1:123",
      editingActive: true,
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

  it("archives workspace items through the route with provenance", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_workspace" });
    const convexMutation = vi.fn().mockResolvedValue({ success: true, mutationId: "mut_9" });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery: vi.fn(), convexMutation }));

    const route = await import("@/app/api/workspace-items/route");
    await route.POST(
      new NextRequest("http://localhost/api/workspace-items", {
        method: "POST",
        body: JSON.stringify({
          action: "archive",
          itemId: "item_9",
        }),
      }),
    );

    expect(convexMutation).toHaveBeenCalledWith("workspaceItems:update", {
      actorClerkId: "user_workspace",
      itemId: "item_9",
      status: "archived",
      provenanceSource: "user",
      provenanceAction: "archived",
    });
  });

  it("returns 400 when archive is requested without a valid workspace item", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_workspace" });
    const convexMutation = vi.fn().mockRejectedValue(new Error("Workspace item not found"));

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery: vi.fn(), convexMutation }));

    const route = await import("@/app/api/workspace-items/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/workspace-items", {
        method: "POST",
        body: JSON.stringify({
          action: "archive",
          itemId: "missing_item",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "itemId is required" });
  });
});
