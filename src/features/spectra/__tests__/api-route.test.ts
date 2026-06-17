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
    orgId: "org_1",
    userId: "user_1",
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
      .mockResolvedValueOnce({ workspace: { _id: "workspace_1" }, items: [] })
      .mockResolvedValueOnce([{ _id: "artifact_1", placementStatus: "inbox" }])
      .mockResolvedValueOnce([{ _id: "run_1", status: "completed" }])
      .mockResolvedValueOnce([{ _id: "card_1", status: "completed" }]);

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));

    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(new NextRequest("http://localhost/api/spectra?action=overview"));
    const payload = await response.json() as { selectedWorkspaceId?: string; artifacts: unknown[]; runs: unknown[]; resultCards: unknown[] };

    expect(response.status).toBe(200);
    expect(payload.selectedWorkspaceId).toBe("workspace_1");
    expect(payload.artifacts).toHaveLength(1);
    expect(payload.runs).toHaveLength(1);
    expect(payload.resultCards).toHaveLength(1);
    expect(convexQuery).toHaveBeenNthCalledWith(1, "spectraWorkspaces:list", {
      actorClerkId: "user_spectra",
      includeArchived: false,
      limit: 30,
    });
    expect(convexQuery).toHaveBeenNthCalledWith(2, "spectraWorkspaceItems:listForWorkspace", {
      actorClerkId: "user_spectra",
      workspaceId: "workspace_1",
    });
    expect(convexQuery).toHaveBeenNthCalledWith(5, "spectraRuns:listResultCards", {
      actorClerkId: "user_spectra",
      workspaceId: "workspace_1",
      limit: 8,
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
      actorClerkId: "user_spectra",
      title: "TOK Exhibition",
      description: undefined,
    });
    expect(convexMutation).toHaveBeenNthCalledWith(2, "spectraWorkspaces:archive", {
      actorClerkId: "user_spectra",
      workspaceId: "workspace_new",
    });
  });

  it("creates, updates, and archives artifacts through Spectra CRUD functions", async () => {
    const requireActor = vi.fn().mockResolvedValue(mockActor());
    const convexQuery = vi.fn();
    const convexMutation = vi
      .fn()
      .mockResolvedValueOnce({ artifactId: "artifact_1" })
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
    await route.POST(new NextRequest("http://localhost/api/spectra", {
      method: "POST",
      body: JSON.stringify({
        action: "updateArtifact",
        artifactId: "artifact_1",
        title: "Essay plan revised",
      }),
    }));
    await route.POST(new NextRequest("http://localhost/api/spectra", {
      method: "POST",
      body: JSON.stringify({
        action: "archiveArtifact",
        artifactId: "artifact_1",
      }),
    }));

    expect(convexMutation).toHaveBeenNthCalledWith(1, "spectraArtifacts:create", {
      actorClerkId: "user_spectra",
      blueprintKey: "document",
      title: "Essay plan",
      summary: undefined,
      workspaceId: undefined,
      source: "manual",
    });
    expect(convexMutation).toHaveBeenNthCalledWith(2, "spectraArtifacts:update", {
      actorClerkId: "user_spectra",
      artifactId: "artifact_1",
      title: "Essay plan revised",
      summary: undefined,
      tags: undefined,
    });
    expect(convexMutation).toHaveBeenNthCalledWith(3, "spectraArtifacts:archive", {
      actorClerkId: "user_spectra",
      artifactId: "artifact_1",
    });
  });

  it("adds artifacts to workspaces and hides projections without deleting artifacts", async () => {
    const requireActor = vi.fn().mockResolvedValue(mockActor());
    const convexQuery = vi.fn();
    const convexMutation = vi
      .fn()
      .mockResolvedValueOnce({ workspaceItemId: "item_1", created: true })
      .mockResolvedValueOnce({ workspaceItemId: "item_1", sourceId: "artifact_1", artifactStillExists: true });

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
        action: "hideWorkspaceItem",
        workspaceItemId: "item_1",
      }),
    }));
    const hidePayload = await hideResponse.json() as { artifactStillExists: boolean };

    expect(addResponse.status).toBe(200);
    expect(hideResponse.status).toBe(200);
    expect(hidePayload.artifactStillExists).toBe(true);
    expect(convexMutation).toHaveBeenNthCalledWith(1, "spectraWorkspaceItems:addArtifact", {
      actorClerkId: "user_spectra",
      workspaceId: "workspace_1",
      artifactId: "artifact_1",
    });
    expect(convexMutation).toHaveBeenNthCalledWith(2, "spectraWorkspaceItems:hide", {
      actorClerkId: "user_spectra",
      workspaceItemId: "item_1",
    });
  });
});
