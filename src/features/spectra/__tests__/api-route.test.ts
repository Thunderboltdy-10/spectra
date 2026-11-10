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

function mockAuth(
  requireActor = vi.fn().mockResolvedValue(mockActor()),
) {
  return {
    requireActor,
    isAuthNoSchool: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return message.startsWith("AUTH_NO_SCHOOL");
    },
  };
}

describe("Spectra API route", () => {
  it("forwards the explicit owned picker scope without changing the default school contract", async () => {
    const page = { scope: "owned", items: [{ _id: "owned-item" }], continueCursor: null, isDone: true };
    const convexQuery = vi.fn().mockResolvedValue(page);
    vi.doMock("@/lib/auth-server", () => mockAuth());
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));
    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(new NextRequest("http://localhost/api/spectra?action=artifactPage&scope=owned&limit=24"));
    expect(await response.json()).toEqual(page);
    expect(convexQuery).toHaveBeenCalledWith("spectraArtifacts:listPage", expect.objectContaining({ scope: "owned", limit: 24 }));
  });

  it("preserves an empty nonfinal catalog page and forwards its scoped filters", async () => {
    const page = { items: [], continueCursor: "encrypted-next", isDone: false };
    const convexQuery = vi.fn().mockResolvedValue(page);
    vi.doMock("@/lib/auth-server", () => mockAuth());
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));
    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(new NextRequest("http://localhost/api/spectra?action=artifactPage&placement=shared&blueprintKey=document&status=active&search=essay&cursor=encrypted-current&limit=12"));
    expect(await response.json()).toEqual(page);
    expect(convexQuery).toHaveBeenCalledWith("spectraArtifacts:listPage", { scope: "school", placement: "shared", blueprintKey: "document", status: "active", search: "essay", cursor: "encrypted-current", limit: 12 });
  });

  it("reads the agent bench with every release a draft can be compared with, without their ids", async () => {
    const convexQuery = vi.fn(async (name: string) => {
      if (name === "spectraArtifacts:listAgentReleases")
        return [
          { releaseId: "release_2", versionId: "version_2", releaseNumber: 2, status: "published", rollout: "internal_test", publishedAt: 20, releaseNotes: "n" },
          { releaseId: "release_1", versionId: "version_1", releaseNumber: 1, status: "suspended", publishedAt: 10 },
        ];
      if (name === "spectraArtifacts:agentBenchRelease") return { releaseNumber: 2, title: "Coach", content: {} };
      return [];
    });
    vi.doMock("@/lib/auth-server", () => mockAuth());
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));
    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(new NextRequest("http://localhost/api/spectra?action=agentBench&agentId=agent_1"));
    expect(await response.json()).toEqual({
      cases: [],
      runs: [],
      release: { releaseNumber: 2, title: "Coach", content: {} },
      releases: [
        { releaseNumber: 2, status: "published", rollout: "internal_test", publishedAt: 20 },
        { releaseNumber: 1, status: "suspended", publishedAt: 10 },
      ],
    });
  });

  it("rejects invalid catalog page sizes before a database query", async () => {
    const convexQuery = vi.fn();
    vi.doMock("@/lib/auth-server", () => mockAuth());
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));
    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(new NextRequest("http://localhost/api/spectra?action=workspacePage&limit=NaN"));
    expect(response.status).toBe(400);
    expect(convexQuery).not.toHaveBeenCalled();
  });

  it("bootstraps identity without querying catalog dependencies", async () => {
    const convexQuery = vi.fn().mockRejectedValue(new Error("catalog unavailable"));
    vi.doMock("@/lib/auth-server", () => mockAuth());
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));
    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(new NextRequest("http://localhost/api/spectra?action=bootstrap"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ actor: mockActor(), needsSchool: false });
    expect(convexQuery).not.toHaveBeenCalled();
  });

  it("reports missing school during bootstrap without an empty catalog success", async () => {
    const convexQuery = vi.fn();
    vi.doMock("@/lib/auth-server", () => mockAuth(vi.fn().mockRejectedValue(new Error("AUTH_NO_SCHOOL: no school"))));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));
    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(new NextRequest("http://localhost/api/spectra?action=bootstrap"));
    expect(await response.json()).toMatchObject({ actor: null, needsSchool: true });
    expect(convexQuery).not.toHaveBeenCalled();
  });

  it("omits unused run catalogs from a context-only overview", async () => {
    const workspaces = [{ _id: "workspace_1", title: "Biology" }];
    const artifacts = [{ _id: "artifact_1", placementStatus: "inbox" }];
    const convexQuery = vi.fn(async (name: string) => {
      if (name === "spectraWorkspaces:list") return workspaces;
      if (name === "spectraArtifacts:list") return artifacts;
      throw new Error("Unused run catalog was read");
    });
    vi.doMock("@/lib/auth-server", () => mockAuth());
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));
    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(new NextRequest("http://localhost/api/spectra?action=overview&includeRuns=false"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ workspaces, artifacts, runs: [], resultCards: [] });
    expect(convexQuery.mock.calls.map(([name]) => name)).toEqual(["spectraWorkspaces:list", "spectraArtifacts:list"]);
  });

  it("can load deferred runs without reading an already-cached unscoped catalog", async () => {
    const runs = [{ _id: "run_1" }], resultCards = [{ _id: "card_1" }];
    const convexQuery = vi.fn(async (name: string) => {
      if (name === "spectraRuns:listRecent") return runs;
      if (name === "spectraRuns:listResultCards") return resultCards;
      throw new Error("Catalog was unnecessarily reread");
    });
    vi.doMock("@/lib/auth-server", () => mockAuth());
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));
    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(new NextRequest("http://localhost/api/spectra?action=overview&includeCatalog=false"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ workspaces: [], artifacts: [], runs, resultCards });
    expect(convexQuery.mock.calls.map(([name]) => name)).toEqual(["spectraRuns:listRecent", "spectraRuns:listResultCards"]);
  });

  it.each([true, false])("preserves workspace validation and card scope when includeCatalog=%s", async (includeCatalog) => {
    const workspace = { workspace: { _id: "workspace_1" }, items: [] };
    const convexQuery = vi.fn(async (name: string) => name === "orgTree:listWorkspaceContentsPublic" ? workspace : []);
    vi.doMock("@/lib/auth-server", () => mockAuth());
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));
    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(new NextRequest(`http://localhost/api/spectra?action=overview&workspaceId=workspace_1&includeCatalog=${includeCatalog}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ selectedWorkspaceId: "workspace_1", workspace });
    expect(convexQuery).toHaveBeenCalledWith("orgTree:listWorkspaceContentsPublic", { workspaceId: "workspace_1", includeDetails: false });
    expect(convexQuery).toHaveBeenCalledWith("spectraRuns:listResultCards", { workspaceId: "workspace_1", includeHidden: false, limit: 20 });
  });

  it("loads overview data from new Spectra tables", async () => {
    const convexMutation = vi.fn();
    const convexQuery = vi
      .fn()
      .mockResolvedValueOnce([{ _id: "workspace_1", title: "Biology" }])
      .mockResolvedValueOnce([{ _id: "artifact_1", placementStatus: "inbox" }])
      .mockResolvedValueOnce([{ _id: "run_1", status: "completed" }])
      .mockResolvedValueOnce([{ _id: "card_1", status: "completed" }]);

    vi.doMock("@/lib/auth-server", () => mockAuth());
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

  it("resolves an AI edit conflict only as apply, keep_current or cancel", async () => {
    const convexQuery = vi.fn().mockResolvedValue({ executionId: "exec_1", currentStateVectorHash: "current-state-vector-hash" });
    const convexMutation = vi.fn().mockResolvedValue({ runId: "run_1", operationId: "operation_1", queued: true });
    vi.doMock("@/lib/auth-server", () => mockAuth());
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));
    const route = await import("@/app/api/spectra/route");
    const post = (body: Record<string, unknown>) => route.POST(new NextRequest("http://localhost/api/spectra", { method: "POST", body: JSON.stringify(body) }));

    // The merge editor is retired: a merged proposal is refused before any read or write.
    const merged = await post({ action: "resolveAiArtifactConflict", operationId: "operation_1", resolution: "merge", mergedInput: { artifactId: "a" } });
    expect(merged.status).toBeGreaterThanOrEqual(400);
    expect(convexQuery).not.toHaveBeenCalled();
    expect(convexMutation).not.toHaveBeenCalled();

    expect((await post({ action: "resolveAiArtifactConflict", operationId: "operation_1", resolution: "apply" })).status).toBe(200);
    expect(convexMutation).toHaveBeenLastCalledWith("spectraOperations:resumeAfterRegionConflict", {
      operationId: "operation_1", executionId: "exec_1", resolution: "apply", newBaseStateVectorHash: "current-state-vector-hash",
    });
    expect((await post({ action: "resolveAiArtifactConflict", operationId: "operation_1", resolution: "keep_current" })).status).toBe(200);
    expect(convexMutation).toHaveBeenLastCalledWith("spectraOperations:resumeAfterRegionConflict", {
      operationId: "operation_1", executionId: "exec_1", resolution: "keep_current", newBaseStateVectorHash: undefined,
    });
  });

  it("creates and archives workspaces through Spectra CRUD functions", async () => {
    const convexQuery = vi.fn();
    const convexMutation = vi
      .fn()
      .mockResolvedValueOnce("workspace_new")
      .mockResolvedValueOnce({ workspaceId: "workspace_new" });

    vi.doMock("@/lib/auth-server", () => mockAuth());
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
    const convexMutation = vi.fn();
    const convexQuery = vi.fn().mockResolvedValue(null);
    vi.doMock("@/lib/auth-server", () => mockAuth());
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));

    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(new NextRequest("http://localhost/api/spectra?action=workspace&workspaceId=t57ax7akvh0w6j3zzqkr800kzd88vdrr"));
    expect(response.status).toBe(400);
    expect(convexQuery).toHaveBeenCalledWith("orgTree:listWorkspaceContentsPublic", {
      workspaceId: "t57ax7akvh0w6j3zzqkr800kzd88vdrr",
      includeDetails: false,
    });
  });

  it("creates and archives artifacts through Spectra CRUD functions", async () => {
    const convexQuery = vi.fn();
    const convexMutation = vi
      .fn()
      .mockResolvedValueOnce({ artifactId: "artifact_1" })
      .mockResolvedValueOnce({ artifactId: "artifact_1" });

    vi.doMock("@/lib/auth-server", () => mockAuth());
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
    const convexQuery = vi.fn();
    const convexMutation = vi
      .fn()
      .mockResolvedValueOnce({ nodeId: "node_1", created: true })
      .mockResolvedValueOnce({ nodeId: "node_1", sourceId: "artifact_1", artifactStillExists: true });

    vi.doMock("@/lib/auth-server", () => mockAuth());
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
    const convexQuery = vi.fn();
    const convexMutation = vi.fn()
      .mockResolvedValueOnce({ artifactId: "artifact_1" })
      .mockResolvedValueOnce({ workspaceId: "workspace_1" });

    vi.doMock("@/lib/auth-server", () => mockAuth());
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

  it("forwards a metadata history page and its continuation cursor", async () => {
    const page = { versions: [{ _id: "version_1", artifactId: "artifact_1", source: "ai" }], continueCursor: "next-page", isDone: false };
    const convexQuery = vi.fn().mockResolvedValue(page);
    const convexMutation = vi.fn();
    vi.doMock("@/lib/auth-server", () => mockAuth());
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));

    const route = await import("@/app/api/spectra/route");
    const versionsResponse = await route.GET(new NextRequest("http://localhost/api/spectra?action=artifactVersions&artifactId=artifact_1&limit=20&cursor=current-page"));

    expect(versionsResponse.status).toBe(200);
    expect(await versionsResponse.json()).toEqual(page);
    expect(convexQuery).toHaveBeenCalledWith("spectraArtifacts:listVersions", { artifactId: "artifact_1", limit: 20, cursor: "current-page" });
  });

  it("loads one selected version and rejects invalid history page sizes before querying", async () => {
    const version = { _id: "version_1", artifactId: "artifact_1", snapshotState: "ready", after: { content: {} } };
    const convexQuery = vi.fn().mockResolvedValue(version);
    vi.doMock("@/lib/auth-server", () => mockAuth());
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));
    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(new NextRequest("http://localhost/api/spectra?action=artifactVersion&artifactId=artifact_1&versionId=version_1"));
    expect(await response.json()).toEqual({ version });
    expect(convexQuery).toHaveBeenCalledWith("spectraArtifacts:getVersion", { artifactId: "artifact_1", versionId: "version_1" });
    convexQuery.mockClear();
    for (const limit of ["NaN", "-1", "0", "1.5", "Infinity"]) {
      const invalid = await route.GET(new NextRequest(`http://localhost/api/spectra?action=artifactVersions&artifactId=artifact_1&limit=${limit}`));
      expect(invalid.status).toBe(400);
    }
    expect(convexQuery).not.toHaveBeenCalled();
  });

  it("assigns a permanent chat thread only when a workspace is explicitly selected", async () => {
    const convexQuery = vi.fn();
    const convexMutation = vi.fn().mockResolvedValue({ threadId: "thread_1" });
    vi.doMock("@/lib/auth-server", () => mockAuth());
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));
    const route = await import("@/app/api/spectra/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra", { method: "POST", body: JSON.stringify({ action: "updateThread", threadId: "thread_1", workspaceId: "workspace_1" }) }));
    expect(response.status).toBe(200);
    expect(convexMutation).toHaveBeenCalledWith("spectraThreads:update", { threadId: "thread_1", title: undefined, pinned: undefined, workspaceId: "workspace_1", status: undefined });
  });

  it("loads the notification center in one authenticated request", async () => {
    const convexMutation = vi.fn();
    const convexQuery = vi.fn().mockImplementation(async (name: string) => {
      if (name === "notificationCenter:listMine")
        return {
          comments: [{ _id: "comment_1" }],
          planner: [{ _id: "planner_1" }],
          timetable: [{ _id: "timetable_1" }],
          invitations: [{ invitationId: "invite_1" }],
        };
      throw new Error(`unexpected query ${name}`);
    });
    vi.doMock("@/lib/auth-server", () => mockAuth());
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));

    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(
      new NextRequest("http://localhost/api/spectra?action=notificationCenter&limit=30"),
    );
    const payload = (await response.json()) as {
      comments: Array<{ _id: string }>;
      planner: Array<{ _id: string }>;
      timetable: Array<{ _id: string }>;
      invitations: Array<{ invitationId: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.comments).toEqual([{ _id: "comment_1" }]);
    expect(payload.planner).toEqual([{ _id: "planner_1" }]);
    expect(payload.timetable).toEqual([{ _id: "timetable_1" }]);
    expect(payload.invitations).toEqual([{ invitationId: "invite_1" }]);
    expect(convexQuery).toHaveBeenCalledTimes(1);
    expect(convexQuery).toHaveBeenCalledWith("notificationCenter:listMine", {
      unreadOnly: false,
      limit: 30,
    });
  });

  it("returns an empty overview for a signed-in account without a school", async () => {
    const requireActor = vi.fn().mockRejectedValue(
      new Error("AUTH_NO_SCHOOL: This account does not have an active school membership."),
    );
    const convexQuery = vi.fn();
    const convexMutation = vi.fn();
    vi.doMock("@/lib/auth-server", () => mockAuth(requireActor));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));

    const route = await import("@/app/api/spectra/route");
    const response = await route.GET(
      new NextRequest("http://localhost/api/spectra?action=overview"),
    );
    const payload = (await response.json()) as {
      needsSchool?: boolean;
      workspaces: unknown[];
      artifacts: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload.needsSchool).toBe(true);
    expect(payload.workspaces).toEqual([]);
    expect(payload.artifacts).toEqual([]);
    expect(convexQuery).not.toHaveBeenCalled();
  });
});




it.each(["", "&surface=workspace"])("returns empty run tabs before school membership (%s)", async (scope) => {
  const convexQuery = vi.fn();
  vi.doMock("@/lib/auth-server", () => mockAuth(vi.fn().mockRejectedValue(new Error("AUTH_NO_SCHOOL: no school"))));
  vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));
  const route = await import("@/app/api/spectra/route");
  const response = await route.GET(new NextRequest("http://localhost/api/spectra?action=runTabs&limit=120" + scope));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ runTabs: [] });
  expect(convexQuery).not.toHaveBeenCalled();
});


it.each([
  ["AUTH_NOT_SIGNED_IN: Sign in to continue.", 401],
  ["AUTH_EMAIL_UNVERIFIED: Verify your email.", 403],
])("keeps run-tab authorization failures visible (%s)", async (message, status) => {
  const convexQuery = vi.fn();
  vi.doMock("@/lib/auth-server", () => mockAuth(vi.fn().mockRejectedValue(new Error(String(message)))));
  vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));
  const route = await import("@/app/api/spectra/route");
  const response = await route.GET(new NextRequest("http://localhost/api/spectra?action=runTabs"));
  expect(response.status).toBe(status);
  expect(convexQuery).not.toHaveBeenCalled();
});
