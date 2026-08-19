import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function mockActor() {
  return {
    clerkId: "user_spectra",
    email: "student@spectra.test",
    name: "Spectra Student",
    role: "student",
    schoolId: "school_1",
    userId: "account_1",
    onboardingComplete: true,
  };
}

describe("Spectra API route", () => {
  it("loads overview data from new Spectra tables", async () => {
    const requireActor = vi.fn().mockResolvedValue(mockActor());
    const convexMutation = vi.fn();
    const convexQuery = vi
      .fn()
      .mockResolvedValueOnce([{ _id: "workspace_1", title: "Biology" }])
      .mockResolvedValueOnce([{ _id: "artifact_1", placementStatus: "inbox" }])
      .mockResolvedValueOnce([{ _id: "run_1", status: "completed" }])
      .mockResolvedValueOnce([{ _id: "card_1", status: "completed" }]);

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));

    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(new NextRequest("http://localhost/api/spectra?action=overview"));
    const payload = await response.json() as { selectedWorkspaceId?: string; artifacts: unknown[]; runs: unknown[]; resultCards: unknown[] };

    expect(response.status).toBe(200);
    expect(payload.selectedWorkspaceId).toBeUndefined();
    expect(payload.artifacts).toHaveLength(1);
    expect(payload.runs).toHaveLength(1);
    expect(payload.resultCards).toHaveLength(1);
    expect(convexQuery).toHaveBeenNthCalledWith(1, "spectraWorkspaces:list", {
      includeArchived: false,
      limit: 30,
    });
    expect(convexQuery).toHaveBeenNthCalledWith(2, "spectraArtifacts:list", {
      placement: "all",
      limit: 60,
    });
  });

  it("creates and archives workspaces through Spectra CRUD functions", async () => {
    const requireActor = vi.fn().mockResolvedValue(mockActor());
    const convexQuery = vi.fn();
    const convexMutation = vi
      .fn()
      .mockResolvedValueOnce("workspace_new")
      .mockResolvedValueOnce({ workspaceId: "workspace_new" });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));

    const route = await import("@/app/api/spectra/route");
    const createResponse = await route.POST(new NextRequest("http://localhost/api/spectra", {
      method: "POST",
      body: JSON.stringify({ action: "createWorkspace", title: "TOK Exhibition" }),
    }));
    const archiveResponse = await route.POST(new NextRequest("http://localhost/api/spectra", {
      method: "POST",
      body: JSON.stringify({ action: "archiveWorkspace", workspaceId: "workspace_new" }),
    }));

    expect(createResponse.status).toBe(200);
    expect(archiveResponse.status).toBe(200);
    expect(convexMutation).toHaveBeenNthCalledWith(1, "spectraWorkspaces:create", {
      title: "TOK Exhibition",
      description: undefined,
      icon: undefined,
      color: undefined,
    });
    expect(convexMutation).toHaveBeenNthCalledWith(2, "spectraWorkspaces:archive", {
      workspaceId: "workspace_new",
    });
  });

  it("rejects a wrong-table workspace id through the public normalization boundary", async () => {
    const requireActor = vi.fn().mockResolvedValue(mockActor());
    const convexMutation = vi.fn();
    const convexQuery = vi.fn().mockResolvedValue(null);
    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));

    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(new NextRequest("http://localhost/api/spectra?action=workspace&workspaceId=t57ax7akvh0w6j3zzqkr800kzd88vdrr"));
    expect(response.status).toBe(400);
    expect(convexQuery).toHaveBeenCalledWith("orgTree:listWorkspaceContentsPublic", {
      workspaceId: "t57ax7akvh0w6j3zzqkr800kzd88vdrr",
    });
  });

  it("creates and archives artifacts through Spectra CRUD functions", async () => {
    const requireActor = vi.fn().mockResolvedValue(mockActor());
    const convexQuery = vi.fn();
    const convexMutation = vi
      .fn()
      .mockResolvedValueOnce({ artifactId: "artifact_1" })
      .mockResolvedValueOnce({ artifactId: "artifact_1" });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));

    const route = await import("@/app/api/spectra/route");
    await route.POST(new NextRequest("http://localhost/api/spectra", {
      method: "POST",
      body: JSON.stringify({
        action: "createArtifact",
        blueprintKey: "document",
        title: "Essay plan",
      }),
    }));
    // Title/summary/content edits are collaborative (Yjs); HTTP CRUD archives only.
    await route.POST(new NextRequest("http://localhost/api/spectra", {
      method: "POST",
      body: JSON.stringify({
        action: "archiveArtifact",
        artifactId: "artifact_1",
      }),
    }));

    expect(convexMutation).toHaveBeenNthCalledWith(1, "spectraArtifacts:create", {
      blueprintKey: "document",
      title: "Essay plan",
      summary: undefined,
      content: undefined,
      tags: undefined,
      workspaceId: undefined,
      source: "manual",
    });
    expect(convexMutation).toHaveBeenNthCalledWith(2, "spectraArtifacts:archive", {
      artifactId: "artifact_1",
    });
  });

  it("files artifacts in workspaces and moves them back to General without deleting them", async () => {
    const requireActor = vi.fn().mockResolvedValue(mockActor());
    const convexQuery = vi.fn();
    const convexMutation = vi
      .fn()
      .mockResolvedValueOnce({ nodeId: "node_1", created: true })
      .mockResolvedValueOnce({ nodeId: "node_1", sourceId: "artifact_1", artifactStillExists: true });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));

    const route = await import("@/app/api/spectra/route");
    const addResponse = await route.POST(new NextRequest("http://localhost/api/spectra", {
      method: "POST",
      body: JSON.stringify({
        action: "addArtifactToWorkspace",
        artifactId: "artifact_1",
        workspaceId: "workspace_1",
      }),
    }));
    const hideResponse = await route.POST(new NextRequest("http://localhost/api/spectra", {
      method: "POST",
      body: JSON.stringify({
        action: "removeFromWorkspace",
        nodeId: "node_1",
      }),
    }));
    const hidePayload = await hideResponse.json() as { artifactStillExists: boolean };

    expect(addResponse.status).toBe(200);
    expect(hideResponse.status).toBe(200);
    expect(hidePayload.artifactStillExists).toBe(true);
    expect(convexMutation).toHaveBeenNthCalledWith(1, "orgTree:placeWork", {
      workspaceId: "workspace_1",
      artifactId: "artifact_1",
    });
    expect(convexMutation).toHaveBeenNthCalledWith(2, "orgTree:removeFromWorkspace", {
      nodeId: "node_1",
    });
  });

  it("routes permanent artifact and strongly confirmed workspace deletion", async () => {
    const requireActor = vi.fn().mockResolvedValue(mockActor());
    const convexQuery = vi.fn();
    const convexMutation = vi.fn()
      .mockResolvedValueOnce({ artifactId: "artifact_1" })
      .mockResolvedValueOnce({ workspaceId: "workspace_1" });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));

    const route = await import("@/app/api/spectra/route");
    await route.POST(new NextRequest("http://localhost/api/spectra", {
      method: "POST",
      body: JSON.stringify({ action: "deleteArtifact", artifactId: "artifact_1" }),
    }));
    await route.POST(new NextRequest("http://localhost/api/spectra", {
      method: "POST",
      body: JSON.stringify({ action: "deleteWorkspace", workspaceId: "workspace_1", confirmation: "Remove Biology permanently" }),
    }));

    expect(convexMutation).toHaveBeenNthCalledWith(1, "spectraArtifacts:permanentlyDelete", {
      artifactId: "artifact_1",
    });
    expect(convexMutation).toHaveBeenNthCalledWith(2, "spectraWorkspaces:permanentlyDelete", {
      workspaceId: "workspace_1",
      confirmation: "Remove Biology permanently",
    });
  });

  it("lists durable artifact versions", async () => {
    const requireActor = vi.fn().mockResolvedValue(mockActor());
    const convexQuery = vi.fn().mockResolvedValue([{ _id: "version_1", artifactId: "artifact_1", source: "ai" }]);
    const convexMutation = vi.fn();
    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));

    const route = await import("@/app/api/spectra/route");
    const versionsResponse = await route.GET(new NextRequest("http://localhost/api/spectra?action=artifactVersions&artifactId=artifact_1&limit=20"));

    expect(versionsResponse.status).toBe(200);
    expect(convexQuery).toHaveBeenCalledWith("spectraArtifacts:listVersions", { artifactId: "artifact_1", limit: 20 });
  });

  it("assigns a permanent chat thread only when a workspace is explicitly selected", async () => {
    const requireActor = vi.fn().mockResolvedValue(mockActor());
    const convexQuery = vi.fn();
    const convexMutation = vi.fn().mockResolvedValue({ threadId: "thread_1" });
    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));
    const route = await import("@/app/api/spectra/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra", { method: "POST", body: JSON.stringify({ action: "updateThread", threadId: "thread_1", workspaceId: "workspace_1" }) }));
    expect(response.status).toBe(200);
    expect(convexMutation).toHaveBeenCalledWith("spectraThreads:update", { threadId: "thread_1", title: undefined, pinned: undefined, workspaceId: "workspace_1", status: undefined });
  });
});


