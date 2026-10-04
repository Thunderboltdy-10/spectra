/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import aggregateTest from "@convex-dev/aggregate/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../../../../convex/schema";
import { api } from "../../../../../../convex/_generated/api";
import * as fixtureModule from "../../../../../../scripts/local/managebac-provider-fixture.mjs";

const modules = import.meta.glob("../../../../../../convex/**/*.ts");
const bridgeKey = "managebac-route-fixture-bridge-key-0123456789";
const identity = {
  subject: "managebac-route-fixture-student",
  email: "fixture.student@example.test",
  name: "Fixture Student",
  emailVerified: true as const,
};
const actor = {
  clerkId: identity.subject,
  email: identity.email,
  name: "Fixture Student",
  schoolId: "fixture-school" as string,
  schoolRole: "student" as const,
  accountId: "fixture-account" as string,
  membershipId: "fixture-membership" as string,
};

const harness = vi.hoisted(() => ({
  mutation: undefined as
    | ((name: string, args: Record<string, unknown>) => Promise<unknown>)
    | undefined,
  query: undefined as
    | ((name: string, args: Record<string, unknown>) => Promise<unknown>)
    | undefined,
}));

vi.mock("@/lib/auth-server", () => ({
  requireActor: vi.fn(async () => actor),
}));
vi.mock("@/lib/server-secrets", () => ({
  loadSchoolSecretForConnector: vi.fn(async () => ({
    value: "spectra-managebac-fixture-token",
  })),
  revokeSchoolSecret: vi.fn(),
  storeSchoolSecret: vi.fn(),
}));
vi.mock("@/lib/convex-server", () => ({
  convexMutation: vi.fn((name: string, args: Record<string, unknown>) => {
    if (!harness.mutation) throw new Error("fixture mutation bridge not ready");
    return harness.mutation(name, args);
  }),
  convexQuery: vi.fn((name: string, args: Record<string, unknown>) => {
    if (!harness.query) throw new Error("fixture query bridge not ready");
    return harness.query(name, args);
  }),
  convexPublicMutation: vi.fn((name: string, args: Record<string, unknown>) => {
    if (!harness.mutation) throw new Error("fixture mutation bridge not ready");
    return harness.mutation(name, args);
  }),
}));

const { POST } = await import("../route");

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}

function capability(input: {
  category: string;
  name: string;
  recordType: string;
  path: string;
  normalization: Record<string, unknown>;
  pagination?: "none" | "page";
  personalIdParameter?: string;
}) {
  return {
    category: input.category,
    name: input.name,
    recordType: input.recordType,
    method: "GET" as const,
    path: input.path,
    purpose: input.name,
    scope: "personal" as const,
    minimumRole: "student" as const,
    pagination: input.pagination ?? "none",
    changeStrategy: "full_reconciliation" as const,
    freshnessSlaMinutes: 60,
    contractVersion: "fixture-v1",
    permissionState: "read_only" as const,
    verificationStatus: "verified" as const,
    routeSource: "manual_verified" as const,
    personalIdParameter: input.personalIdParameter,
    normalization: input.normalization,
  };
}

async function seed(t: ReturnType<typeof convexTest>, origin: string) {
  const now = Date.now();
  const capabilities = [
    capability({
      category: "People",
      name: "Resolve signed-in student",
      recordType: "person",
      path: "/v2p2/students",
      normalization: {
        identityOnly: true,
        recordsPath: "students",
        idPath: "id",
        emailPath: "email",
        emailQueryParameter: "q",
        fields: { email: "email", firstName: "first_name", lastName: "last_name" },
      },
    }),
    capability({
      category: "Classes",
      name: "My class memberships",
      recordType: "class",
      path: "/v2p2/students/{student_id}/memberships?archived=true",
      personalIdParameter: "student_id",
      pagination: "page",
      normalization: {
        syncKind: "classes",
        recordsPath: ["memberships.classes", "memberships", "classes"],
        idPath: "id",
        classIdPath: ["class_id", "class.id", "id"],
        ownerIdPath: ["user_id", "student_id"],
        recordKeyTemplate: "class:{$classId}",
        requiredPaths: ["id"],
        fields: { title: "class_name", classId: "class_id", archived: "archived" },
      },
    }),
    capability({
      category: "Classes",
      name: "Class details",
      recordType: "class",
      path: "/v2p2/classes/{class_id}",
      normalization: {
        syncKind: "classes",
        fanOutParameter: "class_id",
        classIdFromRouteParameter: "class_id",
        recordsPath: ["class", "$"],
        idPath: "id",
        requiredPaths: ["id"],
        recordKeyTemplate: "class:{id}",
        fields: { title: "name", description: "description", classId: "uniq_class_id" },
      },
    }),
    capability({
      category: "Tasks",
      name: "Tasks for classes",
      recordType: "assignment",
      path: "/v2p2/classes/{class_id}/tasks",
      pagination: "page",
      normalization: {
        fanOutParameter: "class_id",
        classIdFromRouteParameter: "class_id",
        recordsPath: "tasks",
        idPath: "id",
        requiredPaths: ["id"],
        recordKeyTemplate: "task:{id}",
        fields: { title: "title", description: "description", dueAt: "due_at" },
      },
    }),
    capability({
      category: "Timetable",
      name: "Timetable for classes",
      recordType: "timetable",
      path: "/v2p2/classes/{class_id}/timetable",
      normalization: {
        syncKind: "classes",
        fanOutParameter: "class_id",
        classIdFromRouteParameter: "class_id",
        transform: "managebac_timetable",
        recordsPath: "timetable.academic_years",
        idPath: "id",
        fields: { title: "title", startAt: "start_at", endAt: "end_at", location: "location" },
      },
    }),
    capability({
      category: "Resources",
      name: "Resources for classes",
      recordType: "class_resource",
      path: "/v2p2/classes/{class_id}/resources",
      pagination: "page",
      normalization: {
        syncKind: "task_resources",
        fanOutParameter: "class_id",
        classIdFromRouteParameter: "class_id",
        recordsPath: "resources",
        idPath: "id",
        requiredPaths: ["id"],
        recordKeyTemplate: "resource:{id}",
        fields: { title: "title", description: "description", url: "url" },
      },
    }),
    capability({
      category: "Grades",
      name: "My result for a task",
      recordType: "task_result",
      path: "/v2p2/classes/{class_id}/tasks/{task_id}/students?student_ids={student_id}",
      personalIdParameter: "student_id",
      normalization: {
        syncKind: "grades",
        fanOutSource: "task",
        classIdFromRouteParameter: "class_id",
        taskIdFromRouteParameter: "task_id",
        recordsPath: ["students"],
        idPath: "id",
        idFromRouteParameter: "task_id",
        ownerIdPath: ["id", "student_id"],
        singleRecord: true,
        recordKeyTemplate: "task_result:{$route.task_id}",
        fields: { grade: "grade", score: "score", maxScore: "max_score", feedback: "comments" },
      },
    }),
    capability({
      category: "Dropbox",
      name: "My submission for a task",
      recordType: "submission",
      path: "/v2p2/classes/{class_id}/tasks/{task_id}/submissions/{student_id}",
      personalIdParameter: "student_id",
      normalization: {
        syncKind: "dropbox_files",
        fanOutSource: "task",
        classIdFromRouteParameter: "class_id",
        taskIdFromRouteParameter: "task_id",
        notFoundIsEmpty: true,
        recordsPath: ["submission", "$"],
        idPath: "id",
        idFromRouteParameter: "task_id",
        ownerIdPath: ["student_id"],
        singleRecord: true,
        recordKeyTemplate: "submission:{$route.task_id}",
        fields: { status: "status", submittedAt: "submitted_at", files: "files" },
      },
    }),
    capability({
      category: "CAS",
      name: "My CAS experiences",
      recordType: "cas_experience",
      path: "/v2p2/year-groups/{year_group_id}/projects/cas/experiences/students?student_ids={student_id}",
      personalIdParameter: "student_id",
      pagination: "page",
      normalization: {
        syncKind: "cas",
        fanOutParameter: "year_group_id",
        fanOutSource: "year_group",
        flatten: { parentPath: "students", itemsPaths: ["experiences"], ownerIdPath: ["id"] },
        recordsPath: ["experiences"],
        idPath: "id",
        requiredPaths: ["id"],
        recordKeyTemplate: "cas_experience:{id}",
        fields: { title: "name", status: "status", service: "service" },
      },
    }),
  ];
  return t.run(async (ctx) => {
    const schoolId = await ctx.db.insert("schools", {
      name: "ManageBac route fixture school",
      slug: `managebac-route-fixture-${crypto.randomUUID()}`,
      verifiedDomains: ["example.test"],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject,
      email: identity.email,
      emailVerified: true,
      name: identity.name,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const membershipId = await ctx.db.insert("schoolMemberships", {
      accountId,
      schoolId,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const integrationId = await ctx.db.insert("schoolIntegrations", {
      schoolId,
      provider: "managebac",
      baseUrl: origin,
      authHeaderName: "X-API-Key",
      authScheme: "raw",
      status: "connected",
      tokenMode: "read_only",
      secretPurpose: "managebac-api-token",
      manifestVersion: 1,
      capabilityCoverage: {
        discovered: capabilities.length,
        verifiedReadable: capabilities.length,
        unverified: 0,
        failed: 0,
        quarantined: 0,
      },
      syncPolicy: {
        frequencyMinutes: 60,
        autoCreateClasses: false,
        autoImportTasks: true,
        autoApplySafeUpdates: true,
        conflictMode: "review",
      },
      freshnessSlaMinutes: 60,
      requestBudgetPerMinute: 180,
      bootstrapVersion: 1,
      createdByAccountId: accountId,
      updatedByAccountId: accountId,
      createdAt: now,
      updatedAt: now,
    });
    const capabilityIds = [];
    for (const item of capabilities) {
      capabilityIds.push(
        await ctx.db.insert("integrationCapabilities", {
          integrationId,
          schoolId,
          ...item,
          lastVerifiedAt: now,
          lastSuccessAt: now,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    await ctx.db.insert("externalIdentityMappings", {
      integrationId,
      schoolId,
      accountId,
      providerUserId: "9001",
      providerUserIdHash: hash("9001"),
      verifiedEmailHash: hash(identity.email),
      status: "pending",
      matchCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { schoolId, accountId, membershipId, integrationId, capabilityIds };
  });
}

describe("ManageBac route provider fixture", () => {
  let fixture: ReturnType<typeof fixtureModule.createManageBacProviderFixture>;
  let stop: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stop?.();
    stop = undefined;
    delete process.env.SPECTRA_CONNECTOR_BRIDGE_KEY;
    delete process.env.SPECTRA_MANAGEBAC_TEST_FIXTURE_ORIGIN;
    harness.mutation = undefined;
    harness.query = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("syncs one job per kind through the real route: classes, tasks, grades, submissions and files", async () => {
    // The provider fixture's deadlines are September 18–20, 2026. Keep the
    // actual upcoming-deadline query inside that term as the wall clock advances.
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-15T12:00:00Z"));
    fixture = fixtureModule.createManageBacProviderFixture();
    const origin = await fixture.start();
    stop = fixture.stop;
    process.env.SPECTRA_CONNECTOR_BRIDGE_KEY = bridgeKey;
    process.env.SPECTRA_MANAGEBAC_TEST_FIXTURE_ORIGIN = origin;
    const t = convexTest(schema, modules);
    const seeded = await seed(t, origin);
    actor.schoolId = seeded.schoolId;
    actor.accountId = seeded.accountId;
    actor.membershipId = seeded.membershipId;
    aggregateTest.register(t, "orgNodeCountByType");
    aggregateTest.register(t, "orgNodeCountByWorkspace");
    aggregateTest.register(t, "orgNodeCountByParent");
    const authenticated = t.withIdentity(identity) as unknown as {
      mutation(fn: unknown, args: unknown): Promise<unknown>;
      query(fn: unknown, args: unknown): Promise<unknown>;
    };
    const functionFor = (name: string) => {
      const [module, functionName] = name.split(":") as [string, string];
      const functions = (module === "school" ? api.school : api.managebac) as Record<string, unknown>;
      return functions[functionName];
    };
    const mutation = (name: string, args: Record<string, unknown>) =>
      authenticated.mutation(functionFor(name), args);
    const query = (name: string, args: Record<string, unknown>) =>
      authenticated.query(functionFor(name), args);
    harness.mutation = mutation;
    harness.query = query;
    // Convex storage uploads land in the test deployment's storage.
    const providerFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://some-deployment.convex.cloud/api/storage/upload")) {
        const blob = new Blob([init?.body as BlobPart]);
        const storageId = await t.run((ctx) => ctx.storage.store(blob));
        return Response.json({ storageId });
      }
      return providerFetch(input, init);
    });
    const post = (body: Record<string, unknown>) =>
      POST(
        new NextRequest("http://localhost/api/spectra/managebac", {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
      );

    const identityResponse = await post({ action: "resolveIdentity" });
    expect(identityResponse.status).toBe(200);
    expect((await identityResponse.json()).identity.result.status).toBe("verified");

    // "Sync now" runs one job per kind that isn't Off. With no class chosen
    // yet, only the class list is read.
    const syncResponse = await post({ action: "sync" });
    expect(syncResponse.status).toBe(200);
    const syncBody = (await syncResponse.json()) as {
      jobs: Array<{ kind: string; summaries?: Array<{ name: string; skipped?: string }>; errorCode?: string }>;
      queued: string[];
    };
    expect(syncBody.jobs.map((job) => job.kind)).toEqual([
      "classes", "current_tasks", "task_resources", "grades", "past_tasks", "dropbox_files", "cas",
    ]);
    expect(syncBody.jobs.filter((job) => job.errorCode)).toEqual([]);
    const classesJob = syncBody.jobs.find((job) => job.kind === "classes")!;
    expect(classesJob.summaries?.map((item) => item.name)).toEqual(
      expect.arrayContaining(["My class memberships", "Class details", "Timetable for classes"]),
    );
    expect(classesJob.summaries?.some((item) => item.name === "Tasks for classes")).toBe(false);
    expect(fixture.requests.some((request) => request.path === "/v2p2/students")).toBe(true);
    expect(fixture.requests.some((request) => request.path === "/v2p2/students/9001/memberships")).toBe(true);
    expect(fixture.requests.some((request) => request.path.endsWith("/tasks"))).toBe(false);
    // CAS is read through the year group the identity lookup reported; only
    // this student's experiences are kept.
    expect(fixture.requests.some((request) => request.path === "/v2p2/year-groups/12/projects/cas/experiences/students")).toBe(true);
    const cas = await t.withIdentity(identity).query(api.school.cas, {});
    expect(cas.experiences.map((item) => item.title)).toEqual(["Beach clean-up"]);
    const catalogue = (await query("managebac:listMyClassCandidates", {})) as {
      classes: Array<{ providerClassId?: string; recordId: string }>;
      selectionRevision: number;
    };
    // Another student's membership row was dropped.
    expect(catalogue.classes.map((item) => item.providerClassId).sort()).toEqual(["101", "202"]);
    const selectedClass = catalogue.classes.find(
      (item: { providerClassId?: string }) => item.providerClassId === "101",
    );
    expect(selectedClass).toBeDefined();
    const selectionResponse = await post({
      action: "selectClasses",
      recordIds: [selectedClass!.recordId],
      expectedRevision: catalogue.selectionRevision,
      retention: "keep_in_spectra",
    });
    expect(selectionResponse.status).toBe(200);
    const selectionBody = await selectionResponse.json();
    expect(selectionBody.outcome).toBe("selection_saved");
    expect(selectionBody.retention).toBe("keep_in_spectra");
    expect(selectionBody.materialization.requested).toBe(1);
    expect(
      fixture.requests.some((request) => /\/tasks|\/timetable|\/resources/.test(request.path)),
    ).toBe(false);

    const staleSelectionResponse = await post({
      action: "selectClasses",
      recordIds: [],
      expectedRevision: catalogue.selectionRevision,
    });
    expect(staleSelectionResponse.status).toBe(409);
    expect((await staleSelectionResponse.json()).error.message).toContain(
      "Reload the class list",
    );

    const selectedSyncResponse = await post({ action: "sync" });
    expect(selectedSyncResponse.status).toBe(200);
    expect(fixture.requests.some((request) => request.path === "/v2p2/classes/101/tasks")).toBe(true);
    expect(fixture.requests.some((request) => request.path === "/v2p2/classes/101/timetable")).toBe(true);
    expect(fixture.requests.some((request) => request.path === "/v2p2/classes/101/resources")).toBe(true);
    expect(fixture.requests.some((request) => request.path === "/v2p2/classes/202/tasks")).toBe(false);
    expect(fixture.requests.some((request) => request.path === "/v2p2/classes/202/timetable")).toBe(false);
    expect(fixture.requests.some((request) => request.path === "/v2p2/classes/202/resources")).toBe(false);
    // Grades are read only for work already due; a submission for any task.
    expect(fixture.requests.some((request) => request.path === "/v2p2/classes/101/tasks/3003/students")).toBe(true);
    expect(fixture.requests.some((request) => request.path === "/v2p2/classes/101/tasks/3001/students")).toBe(false);
    expect(fixture.requests.some((request) => request.path === "/v2p2/classes/101/tasks/3001/submissions/9001")).toBe(true);
    expect(fixture.requests.some((request) => request.path === "/v2p2/classes/101/tasks/3003/submissions/9001")).toBe(true);

    const records = await t.withIdentity(identity).query(api.managebac.recordsForPurpose, {
      purpose: "timetable",
    });
    expect(records.records.length).toBeGreaterThan(0);

    // The task carries the student's own grade and handed-in files.
    const current = await t.withIdentity(identity).query(api.school.tasks, { view: "current" });
    const essay = current.tasks.find((task) => task.title === "Sequences essay");
    expect(essay).toBeDefined();
    const detail = await t.withIdentity(identity).query(api.school.task, { recordId: essay!.recordId as never });
    expect(detail?.grade).toMatchObject({ score: 18, maxScore: 24, label: "6", feedback: "Clear argument; cite the sources." });
    expect(detail?.submission?.files).toEqual([
      expect.objectContaining({ providerFileId: "8801", filename: "sequences-essay.txt", state: "listed" }),
    ]);
    const unsubmitted = current.tasks.find((task) => task.title === "Functions problem set");
    const unsubmittedDetail = await t.withIdentity(identity).query(api.school.task, { recordId: unsubmitted!.recordId as never });
    expect(unsubmittedDetail?.submission).toBeNull();
    expect(unsubmittedDetail?.grade).toBeNull();

    // Opening the file downloads it once into the student's storage. The
    // redirect to file storage never carries the school's API key.
    const fetchFile = () =>
      post({
        action: "fetchSchoolFile",
        submissionRecordId: detail!.submission!.recordId,
        providerFileId: "8801",
      });
    const fetched = await fetchFile();
    expect(fetched.status).toBe(200);
    const fetchedBody = await fetched.json();
    expect(fetchedBody.status).toBe("fetched");
    const storageRequest = fixture.requests.find((request) => request.path === "/signed/8801");
    expect(storageRequest?.authenticated).toBe(false);
    const files = await t.withIdentity(identity).query(api.school.files, {});
    expect(files.files).toEqual([
      expect.objectContaining({ filename: "sequences-essay.txt", state: "cached", origin: "dropbox" }),
    ]);
    const kept = await t.run((ctx) => ctx.db.get(fetchedBody.schoolFileId));
    expect((kept as { extractedText?: string } | null)?.extractedText).toContain("arithmetic sequence");
    const downloads = fixture.requests.filter((request) => request.path === "/v2p2/files/8801/download").length;
    const again = await (await fetchFile()).json();
    expect(again).toMatchObject({ status: "cached", schoolFileId: fetchedBody.schoolFileId });
    expect(fixture.requests.filter((request) => request.path === "/v2p2/files/8801/download")).toHaveLength(downloads);

    fixture.setRevision(2);
    expect(fixture.revision).toBe(2);
    const requestCountBeforeChange = fixture.requests.length;
    const changedSyncResponse = await post({ action: "sync", kind: "current_tasks" });
    expect(changedSyncResponse.status).toBe(200);
    expect((await changedSyncResponse.json()).jobs.map((job: { kind: string }) => job.kind)).toEqual(["current_tasks"]);
    expect(fixture.requests.length).toBeGreaterThan(requestCountBeforeChange);
    const changedTasks = await t.withIdentity(identity).query(
      api.managebac.recordsForPurpose,
      { purpose: "upcoming_deadlines" },
    );
    expect(
      changedTasks.records.some((record) =>
        String(record.normalized.title).includes("updated"),
      ),
    ).toBe(true);

    // Turning dropbox files Off removes the submissions and the kept file.
    await authenticated.mutation(api.school.setMode, { kind: "dropbox_files", mode: "off" });
    expect((await t.withIdentity(identity).query(api.school.files, {})).files).toEqual([]);
    const afterOff = await t.withIdentity(identity).query(api.school.task, { recordId: essay!.recordId as never });
    expect(afterOff?.submission).toBeNull();
    expect(afterOff?.grade).not.toBeNull();

    const archiveResponse = await post({
      action: "selectClasses",
      recordIds: [],
      expectedRevision: selectionBody.selectionRevision,
      retention: "archive_projection",
    });
    expect(archiveResponse.status).toBe(200);
    const archiveBody = await archiveResponse.json();
    expect(archiveBody.release.removed).toBe(1);
    expect(archiveBody.retention).toBe("archive_projection");
    const archived = await t.run(async (ctx) => ({
      source: (await ctx.db.get(selectedClass!.recordId as never)) as {
        tombstone?: boolean;
      } | null,
      workspaces: await ctx.db
        .query("spectraWorkspaces")
        .withIndex("by_account_starter", (q) =>
          q.eq("ownerAccountId", seeded.accountId).eq("starterKey", "managebac-class"),
        )
        .collect(),
    }));
    expect(archived.source?.tombstone).toBe(false);
    expect(archived.workspaces.some((workspace) => workspace.status === "archived")).toBe(true);
  });
});
