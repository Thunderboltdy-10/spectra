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
      path: "/v2p2/memberships?user_ids={student_id}",
      personalIdParameter: "student_id",
      pagination: "page",
      normalization: {
        recordsPath: "memberships",
        idPath: "id",
        classIdPath: "class_id",
        recordKeyTemplate: "class:{class_id}",
        requiredPaths: ["id", "class_id", "user_id"],
        fields: { title: "class_name", classId: "class_id", userId: "user_id" },
      },
    }),
    capability({
      category: "Classes",
      name: "Class details",
      recordType: "class",
      path: "/v2p2/classes/{class_id}",
      normalization: {
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
        fanOutParameter: "class_id",
        classIdFromRouteParameter: "class_id",
        recordsPath: "resources",
        idPath: "id",
        requiredPaths: ["id"],
        recordKeyTemplate: "resource:{id}",
        fields: { title: "title", description: "description", url: "url" },
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
  });

  it("uses the real route and local Convex boundary for identity, classes, tasks, timetable and resources", async () => {
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
    const mutation = (name: string, args: Record<string, unknown>) => {
      const functionName = name.split(":")[1] as keyof typeof api.managebac;
      return authenticated.mutation(api.managebac[functionName], args);
    };
    const query = (name: string, args: Record<string, unknown>) => {
      const functionName = name.split(":")[1] as keyof typeof api.managebac;
      return authenticated.query(api.managebac[functionName], args);
    };
    harness.mutation = mutation;
    harness.query = query;

    const identityResponse = await POST(
      new NextRequest("http://localhost/api/spectra/managebac", {
        method: "POST",
        body: JSON.stringify({ action: "resolveIdentity", bootstrap: false }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(identityResponse.status).toBe(200);
    expect((await identityResponse.json()).identity.result.status).toBe("verified");

    const syncResponse = await POST(
      new NextRequest("http://localhost/api/spectra/managebac", {
        method: "POST",
        body: JSON.stringify({ action: "sync" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(syncResponse.status).toBe(200);
    const syncBody = await syncResponse.json();
    expect(syncBody.summaries.some((item: { name: string }) => item.name === "Tasks for classes")).toBe(true);
    expect(syncBody.summaries.some((item: { name: string }) => item.name === "Timetable for classes")).toBe(true);
    expect(fixture.requests.some((request) => request.path === "/v2p2/students")).toBe(true);
    expect(fixture.requests.some((request) => request.path === "/v2p2/memberships")).toBe(true);
    expect(fixture.requests.some((request) => request.path.endsWith("/tasks"))).toBe(true);
    expect(fixture.requests.some((request) => request.path.endsWith("/timetable"))).toBe(true);
    expect(fixture.requests.some((request) => request.path.endsWith("/resources"))).toBe(true);

    const records = await t.withIdentity(identity).query(api.managebac.recordsForPurpose, {
      purpose: "timetable",
    });
    expect(records.records.length).toBeGreaterThan(0);
    fixture.setRevision(2);
    expect(fixture.revision).toBe(2);
    const requestCountBeforeChange = fixture.requests.length;
    const changedSyncResponse = await POST(
      new NextRequest("http://localhost/api/spectra/managebac", {
        method: "POST",
        body: JSON.stringify({ action: "sync" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(changedSyncResponse.status).toBe(200);
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
  });
});
