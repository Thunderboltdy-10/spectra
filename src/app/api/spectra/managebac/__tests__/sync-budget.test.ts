import { createHash, createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const bridgeKey = "b".repeat(48);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

function workerRequest(body: Record<string, unknown>) {
  const rawBody = JSON.stringify(body);
  const timestamp = Date.now();
  const workerKey = createHmac("sha256", bridgeKey)
    .update("spectra-managebac-worker-http:v1")
    .digest("base64url");
  const signature = createHmac("sha256", workerKey)
    .update(`${timestamp}.${createHash("sha256").update(rawBody).digest("base64url")}`)
    .digest("base64url");
  return new NextRequest("http://localhost/api/spectra/managebac", {
    method: "POST",
    body: rawBody,
    headers: {
      "x-spectra-worker-timestamp": String(timestamp),
      "x-spectra-worker-signature": signature,
    },
  });
}

/** A scheduled school sync against a route that always has another page. */
async function scheduledSyncWithEndlessPages() {
  vi.stubEnv("SPECTRA_CONNECTOR_BRIDGE_KEY", bridgeKey);
  vi.stubEnv("SPECTRA_MANAGEBAC_TEST_FIXTURE_ORIGIN", "http://127.0.0.1:4010");
  const actor = {
    clerkId: "admin", accountId: "account-admin", email: "admin@school.test", name: "Admin",
    schoolId: "school-1", schoolRole: "school_admin", membershipId: "membership-admin",
  };
  const context = {
    integration: {
      _id: "integration-1", schoolId: "school-1", baseUrl: "http://127.0.0.1:4010",
      authHeaderName: "auth-token", authScheme: "raw", requestBudgetPerMinute: 180,
      bootstrapVersion: 1, status: "connected",
    },
    capabilities: [{
      _id: "capability-classes", category: "classes", name: "Classes", recordType: "class",
      path: "/v2/classes", purpose: "Classes", scope: "school", minimumRole: "school_admin",
      pagination: "page", changeStrategy: "full_reconciliation", contractVersion: "v2",
      normalization: {
        recordsPath: "classes", idPath: "id", nextCursorPath: "meta.next_page", cursorParameter: "page",
        pageParameter: "page", recordKeyTemplate: "class:{id}", classification: "school", audienceScope: "school",
        fields: { name: "name" },
      },
    }],
    mapping: { status: "verified" },
    selection: { revision: 0, selectedClassIds: [] },
    actor: { accountId: actor.accountId, email: actor.email, schoolRole: actor.schoolRole },
  };
  const commits: Array<{ name: string; args: Record<string, unknown> }> = [];
  const convexPublicMutation = vi.fn(async (name: string, args: Record<string, unknown>) => {
    commits.push({ name, args });
    if (name === "managebac:claimScheduledSync")
      return {
        integrationId: "integration-1", syncRunId: "sync-1", schoolId: "school-1",
        serviceSubject: actor.clerkId, leaseToken: "lease-1", selectionRevision: 0, actor,
      };
    if (name === "managebac:connectorContext") return context;
    return {};
  });
  vi.doMock("@/lib/convex-server", () => ({
    convexPublicMutation,
    convexMutation: vi.fn(async (name: string) => { throw new Error(`Unexpected mutation ${name}`); }),
    convexQuery: vi.fn(async (name: string) => { throw new Error(`Unexpected query ${name}`); }),
  }));
  vi.doMock("@/lib/server-secrets", () => ({
    loadSchoolSecretForConnector: vi.fn(async () => ({ value: "school-token-1234567890" })),
    revokeSchoolSecret: vi.fn(),
    storeSchoolSecret: vi.fn(),
  }));
  vi.doMock("@/lib/auth-server", () => ({ requireActor: vi.fn() }));
  // Every provider page takes a minute of wall time and names a next page.
  let clock = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  let page = 0;
  const provider = vi.fn(async () => {
    clock += 60_000;
    page += 1;
    return Response.json({ classes: [{ id: page, name: `Class ${page}` }], meta: { next_page: page + 1 } });
  });
  vi.stubGlobal("fetch", provider);
  return { commits, provider };
}

it("pauses a scheduled sync at its time budget so the next request continues it", async () => {
  const { commits, provider } = await scheduledSyncWithEndlessPages();
  const route = await import("@/app/api/spectra/managebac/route");
  expect(route.maxDuration).toBe(300);

  const response = await route.POST(workerRequest({ action: "internal_scheduled_work", workerId: "convex:integration-1:1" }));

  // A minute per page inside a four-minute budget: the fifth page is never
  // requested, instead of paging on until the platform kills the request.
  expect(provider).toHaveBeenCalledTimes(4);
  const pages = commits.filter(commit => commit.name === "managebac:commitNormalizedPage");
  expect(pages).toHaveLength(4);
  // Each page saves where the pass stands, so a later request resumes there.
  expect(pages.map(commit => commit.args.progress)).toEqual([1, 2, 3, 4].map(page => ({
    binding: "", page, ...(page > 1 ? { cursor: String(page) } : {}), bindingDone: false,
    capabilityDone: false, classIds: [], yearGroupIds: [],
  })));
  // Running out of time pauses the pass rather than failing it.
  const suspended = commits.find(commit => commit.name === "managebac:suspendSync");
  expect(suspended?.args).toMatchObject({
    syncRunId: "sync-1", leaseToken: "lease-1", errorCode: "INTEGRATION_SYNC_TIME_BUDGET",
  });
  expect(commits.some(commit => commit.name === "managebac:failSync")).toBe(false);
  expect(commits.some(commit => commit.name === "managebac:commitQuarantine")).toBe(false);
  expect(commits.some(commit => commit.name === "managebac:completeSync")).toBe(false);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ worked: true, suspended: true });
});

it("works through due student jobs, each reading only its kind and its targeted classes", async () => {
  vi.stubEnv("SPECTRA_CONNECTOR_BRIDGE_KEY", bridgeKey);
  vi.stubEnv("SPECTRA_MANAGEBAC_TEST_FIXTURE_ORIGIN", "http://127.0.0.1:4010");
  const student = {
    clerkId: "student", accountId: "account-student", email: "student@school.test", name: "Student",
    schoolId: "school-1", schoolRole: "student", membershipId: "membership-student",
  };
  const route = (id: string, name: string, recordType: string, path: string, syncKind: string) => ({
    _id: id, category: "school", name, recordType, path, purpose: name, scope: "personal",
    minimumRole: "student", pagination: "none", changeStrategy: "full_reconciliation", contractVersion: "v2p2",
    normalization: {
      syncKind, fanOutParameter: "class_id", classIdFromRouteParameter: "class_id",
      recordsPath: "items", idPath: "id", classification: "personal", audienceScope: "mapped_user", fields: { title: "title" },
    },
  });
  const context = {
    integration: {
      _id: "integration-1", schoolId: "school-1", baseUrl: "http://127.0.0.1:4010",
      authHeaderName: "auth-token", authScheme: "raw", requestBudgetPerMinute: 180,
      bootstrapVersion: 1, status: "connected",
    },
    capabilities: [
      route("capability-tasks", "Tasks", "assignment", "/v2p2/classes/{class_id}/tasks", "current_tasks"),
      route("capability-resources", "Resources", "class_resource", "/v2p2/classes/{class_id}/resources", "task_resources"),
    ],
    mapping: { status: "verified", providerUserId: "9001" },
    // The student follows 101 and 202, but the job's mode admits only 101.
    selection: { revision: 1, selectedClassIds: ["101", "202"] },
    actor: { accountId: student.accountId, email: student.email, schoolRole: student.schoolRole },
  };
  const claims = [
    {
      integrationId: "integration-1", syncRunId: "job-resources", schoolId: "school-1",
      serviceSubject: student.clerkId, leaseToken: "lease-resources", selectionRevision: 1, actor: student,
      pass: { requests: 1, completedCapabilityIds: [], syncKind: "task_resources", targeted: true, classIds: ["101"], yearGroupIds: [], tasks: [] },
    },
    {
      integrationId: "integration-1", syncRunId: "job-tasks", schoolId: "school-1",
      serviceSubject: student.clerkId, leaseToken: "lease-tasks", selectionRevision: 1, actor: student,
      pass: { requests: 1, completedCapabilityIds: [], syncKind: "current_tasks", targeted: true, classIds: ["202"], yearGroupIds: [], tasks: [] },
    },
  ];
  const commits: Array<{ name: string; args: Record<string, unknown> }> = [];
  vi.doMock("@/lib/convex-server", () => ({
    convexPublicMutation: vi.fn(async (name: string, args: Record<string, unknown>) => {
      commits.push({ name, args });
      if (name === "managebac:claimScheduledSync") return claims.shift() ?? null;
      if (name === "managebac:connectorContext") return context;
      return {};
    }),
    convexMutation: vi.fn(async (name: string) => { throw new Error(`Unexpected mutation ${name}`); }),
    convexQuery: vi.fn(async (name: string) => { throw new Error(`Unexpected query ${name}`); }),
  }));
  vi.doMock("@/lib/server-secrets", () => ({
    loadSchoolSecretForConnector: vi.fn(async () => ({ value: "school-token-1234567890" })),
    revokeSchoolSecret: vi.fn(),
    storeSchoolSecret: vi.fn(),
  }));
  vi.doMock("@/lib/auth-server", () => ({ requireActor: vi.fn() }));
  const requested: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    requested.push(new URL(String(input)).pathname);
    return Response.json({ items: [{ id: requested.length, title: "Row" }] });
  }));
  const routeModule = await import("@/app/api/spectra/managebac/route");

  const response = await routeModule.POST(workerRequest({ action: "internal_scheduled_work", workerId: "convex:integration-1:2" }));

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.jobs.map((job: { syncRunId: string; syncKind: string }) => [job.syncRunId, job.syncKind])).toEqual([
    ["job-resources", "task_resources"],
    ["job-tasks", "current_tasks"],
  ]);
  expect(requested).toEqual(["/v2p2/classes/101/resources", "/v2p2/classes/202/tasks"]);
  expect(commits.filter((commit) => commit.name === "managebac:completeSync").map((commit) => commit.args.syncRunId))
    .toEqual(["job-resources", "job-tasks"]);
  // Two jobs claimed, then nothing more was due.
  expect(commits.filter((commit) => commit.name === "managebac:claimScheduledSync")).toHaveLength(3);
});
