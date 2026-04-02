import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("workspace orchestration route integration", () => {
  it("suggests whether a topic should become a workspace", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_workspace" });
    const convexQuery = vi.fn().mockResolvedValue({
      topic: "college essay",
      score: 18,
      shouldSuggest: true,
      mergeCandidates: [],
    });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));

    const route = await import("@/app/api/workspace-orchestration/route");
    const response = await route.GET(
      new NextRequest("http://localhost/api/workspace-orchestration?action=suggestWorkspaceFromTopic&topic=college%20essay&limit=7"),
    );
    const payload = (await response.json()) as {
      topic: string;
      score: number;
      shouldSuggest: boolean;
      mergeCandidates: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload.topic).toBe("college essay");
    expect(payload.shouldSuggest).toBe(true);
    expect(convexQuery).toHaveBeenCalledWith("workspaceOrchestration:suggestWorkspaceFromTopic", {
      actorClerkId: "user_workspace",
      topic: "college essay",
      limit: 7,
    });
  });

  it("creates a workspace through the orchestration route", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_workspace" });
    const convexMutation = vi.fn().mockResolvedValue({ workstreamId: "ws_1", mutationId: "mut_1" });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery: vi.fn(), convexMutation }));

    const route = await import("@/app/api/workspace-orchestration/route");
    await route.POST(
      new NextRequest("http://localhost/api/workspace-orchestration", {
        method: "POST",
        body: JSON.stringify({
          action: "createWorkstream",
          title: "College Essay",
          description: "Application strategy and drafts",
          emoji: "✍️",
          color: "#D97706",
          type: "project",
          provenanceSource: "ai",
          mutationSummary: "Created essay workspace",
        }),
      }),
    );

    expect(convexMutation).toHaveBeenCalledWith("workspaceOrchestration:createWorkstream", {
      actorClerkId: "user_workspace",
      title: "College Essay",
      description: "Application strategy and drafts",
      emoji: "✍️",
      color: "#D97706",
      type: "project",
      provenanceSource: "ai",
      mutationSummary: "Created essay workspace",
    });
  });
});
