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

  it("resolves a quiz quick command to artifact creation with source chat context", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_workspace" });
    const convexMutation = vi.fn().mockResolvedValue({ artifactId: "artifact_quiz_1" });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery: vi.fn(), convexMutation }));

    const route = await import("@/app/api/workspace-orchestration/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/workspace-orchestration", {
        method: "POST",
        body: JSON.stringify({
          action: "resolveCommand",
          workstreamId: "ws_quiz",
          sourceChatId: "chat_42",
          query: "Create quiz: Stoichiometry basics",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(convexMutation).toHaveBeenCalledWith("artifacts:create", expect.objectContaining({
      actorClerkId: "user_workspace",
      workstreamId: "ws_quiz",
      sourceChatId: "chat_42",
      type: "quiz",
      title: "Stoichiometry basics",
      editorMode: "ai_enhanced",
      sourceType: "ai_generated",
    }));
    expect(payload).toMatchObject({
      outcome: "artifact",
      resolvedAction: "create_quiz",
      artifactId: "artifact_quiz_1",
      artifactType: "quiz",
      title: "Stoichiometry basics",
    });
  });

  it("creates a visual workspace item through the workspace items route with AI provenance", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_workspace" });
    const convexMutation = vi.fn().mockResolvedValue({ itemId: "widget_1", mutationId: "mut_widget_1" });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery: vi.fn(), convexMutation }));

    const route = await import("@/app/api/workspace-items/route");
    await route.POST(
      new NextRequest("http://localhost/api/workspace-items", {
        method: "POST",
        body: JSON.stringify({
          action: "createWidget",
          workstreamId: "ws_visual",
          type: "visualization",
          itemType: "artifact",
          renderMode: "visualization",
          title: "Cell division map",
          contentSummary: "AI-created SVG timeline of mitosis stages.",
          x: 240,
          y: 180,
          category: "visualizations",
          provenanceSource: "ai",
          provenanceAction: "created",
          mutationSummary: "AI created visual artifact",
        }),
      }),
    );

    expect(convexMutation).toHaveBeenCalledWith("workspaceItems:createWidget", expect.objectContaining({
      actorClerkId: "user_workspace",
      workstreamId: "ws_visual",
      type: "visualization",
      itemType: "artifact",
      renderMode: "visualization",
      title: "Cell division map",
      category: "visualizations",
      provenanceSource: "ai",
    }));
  });

  it("returns authoritative batched workspace content payload", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_workspace" });
    const convexQuery = vi.fn().mockResolvedValue({
      workstreamId: "ws_1",
      workspaceItems: [],
      chats: [],
      plannerItems: [],
      artifacts: [],
      topicClusters: [],
    });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));

    const route = await import("@/app/api/workspace-items/route");
    const response = await route.GET(
      new NextRequest("http://localhost/api/workspace-items?action=getWorkspaceContent&workstreamId=ws_1"),
    );

    expect(response.status).toBe(200);
    expect(convexQuery).toHaveBeenCalledWith("workspaceItems:getWorkspaceContent", {
      actorClerkId: "user_workspace",
      workstreamId: "ws_1",
    });
  });
});

  it("persists dual-render visual artifacts from chat responses", async () => {
    const createArtifact = vi.fn().mockResolvedValue("artifact_visual_1");
    const updateBySourceArtifact = vi.fn().mockResolvedValue({ success: true, mutationId: "mut_visual_1", itemId: "item_visual_1" });

    vi.doMock("@/lib/auth-server", () => ({
      requireActor: vi.fn().mockResolvedValue({ clerkId: "user_workspace" }),
    }));
    vi.doMock("@/lib/convex-server", () => ({
      convexQuery: vi.fn(),
      convexMutation: vi.fn((name: string) => {
        if (name === "artifacts:create") return createArtifact();
        if (name === "workspaceItems:updateBySourceArtifact") return updateBySourceArtifact();
        return Promise.resolve({});
      }),
    }));

    const { extractVisualArtifactFromResponse } = await import("@/lib/orchestrator/pipeline");
    const visual = await Promise.resolve(extractVisualArtifactFromResponse({
      response: '<svg viewBox="0 0 1200 400"><title>Mitosis timeline</title><rect width="1200" height="400" fill="#fff" /></svg>\n\nA calm timeline of mitosis stages.',
      effectiveMode: "explain",
      routePlan: { modeContract: { outputFormat: "explanation_with_visual" } } as never,
      runtimeSkills: [{ id: "spectra-visual-skill" }] as never,
    }));

    expect(visual).toMatchObject({
      title: "Mitosis timeline",
      renderMode: "visualization",
      type: "visualization",
    });
    expect(visual?.renderProps).toMatchObject({
      visualKind: "svg",
    });
  });

