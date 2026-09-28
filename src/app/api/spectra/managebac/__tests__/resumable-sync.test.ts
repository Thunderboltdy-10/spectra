/// <reference types="vite/client" />
import { NextRequest } from "next/server";
import aggregateTest from "@convex-dev/aggregate/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../../../../convex/schema";
import { api } from "../../../../../../convex/_generated/api";

/*
 * A school whose ManageBac catalogue takes longer to read than one request
 * may run. The real route pages the provider and commits into the real
 * Convex functions; each provider page costs a minute of wall time, so a
 * request reads four pages before its four-minute budget ends.
 */

const modules = import.meta.glob("../../../../../../convex/**/*.ts");
const bridgeKey = "managebac-resumable-sync-bridge-key-0123456789";
const origin = "http://127.0.0.1:4010";
const identity = {
  subject: "managebac-resume-admin",
  email: "admin@resume.example.test",
  name: "Resume Admin",
  emailVerified: true as const,
};
const actor = {
  clerkId: identity.subject,
  email: identity.email,
  name: identity.name,
  schoolId: "" as string,
  schoolRole: "school_admin" as const,
  accountId: "" as string,
  membershipId: "" as string,
};
const harness = vi.hoisted(() => ({
  mutation: undefined as
    | ((name: string, args: Record<string, unknown>) => Promise<unknown>)
    | undefined,
  query: undefined as
    | ((name: string, args: Record<string, unknown>) => Promise<unknown>)
    | undefined,
}));

vi.mock("@/lib/auth-server", () => ({ requireActor: vi.fn(async () => actor) }));
vi.mock("@/lib/server-secrets", () => ({
  loadSchoolSecretForConnector: vi.fn(async () => ({ value: "school-token-1234567890" })),
  revokeSchoolSecret: vi.fn(),
  storeSchoolSecret: vi.fn(),
}));
vi.mock("@/lib/convex-server", () => ({
  convexMutation: vi.fn((name: string, args: Record<string, unknown>) => harness.mutation!(name, args)),
  convexQuery: vi.fn((name: string, args: Record<string, unknown>) => harness.query!(name, args)),
  convexPublicMutation: vi.fn((name: string, args: Record<string, unknown>) => harness.mutation!(name, args)),
}));

const { POST } = await import("../route");

const PAGE_SIZE = 3;
const PAGES = 10;

async function setup() {
  process.env.SPECTRA_CONNECTOR_BRIDGE_KEY = bridgeKey;
  process.env.SPECTRA_MANAGEBAC_TEST_FIXTURE_ORIGIN = origin;
  let clock = Date.parse("2026-09-15T08:00:00Z");
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const advance = (ms: number) => { clock += ms; };
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  const seeded = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Large school", slug: `large-school-${crypto.randomUUID()}`, verifiedDomains: ["resume.example.test"],
      status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: identity.email, emailVerified: true, name: identity.name,
      status: "active", createdAt: now, updatedAt: now,
    });
    const membershipId = await ctx.db.insert("schoolMemberships", {
      accountId, schoolId, role: "school_admin", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    const integrationId = await ctx.db.insert("schoolIntegrations", {
      schoolId, provider: "managebac", baseUrl: origin, authHeaderName: "auth-token", authScheme: "raw",
      status: "connected", tokenMode: "read_only", secretPurpose: "managebac-api-token", manifestVersion: 1,
      credentialFingerprint: "token-a",
      capabilityCoverage: { discovered: 1, verifiedReadable: 1, unverified: 0, failed: 0, quarantined: 0 },
      syncPolicy: { frequencyMinutes: 60, autoCreateClasses: false, autoImportTasks: true, autoApplySafeUpdates: true, conflictMode: "review" },
      freshnessSlaMinutes: 60, requestBudgetPerMinute: 180, bootstrapVersion: 1,
      createdByAccountId: accountId, updatedByAccountId: accountId, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("integrationCapabilities", {
      integrationId, schoolId, category: "classes", name: "Classes", recordType: "class", method: "GET",
      path: "/v2/classes", purpose: "School classes", scope: "school", minimumRole: "school_admin",
      pagination: "page", changeStrategy: "full_reconciliation", freshnessSlaMinutes: 60, contractVersion: "v2",
      permissionState: "read_only", verificationStatus: "verified", routeSource: "manual_verified",
      normalization: {
        recordsPath: "classes", idPath: "id", nextCursorPath: "meta.next_page", cursorParameter: "page",
        pageParameter: "page", recordKeyTemplate: "class:{id}", classification: "school", audienceScope: "school",
        fields: { name: "name" },
      },
      lastVerifiedAt: now, lastSuccessAt: now, createdAt: now, updatedAt: now,
    });
    // A class an earlier sync imported that ManageBac no longer lists.
    const staleId = await ctx.db.insert("externalRecords", {
      integrationId, schoolId, providerRecordId: "stale", providerRecordKey: "class:stale", recordType: "class",
      classification: "school", audienceScope: "school", normalized: { name: "Closed class" }, payloadVersion: "v2",
      sourceHash: "stale", sourceState: "available", sourceStateAt: now - 86_400_000, tombstone: false,
      fetchedAt: now - 86_400_000, createdAt: now - 86_400_000, updatedAt: now - 86_400_000,
    });
    return { schoolId, accountId, membershipId, integrationId, staleId };
  });
  actor.schoolId = seeded.schoolId;
  actor.accountId = seeded.accountId;
  actor.membershipId = seeded.membershipId;
  const admin = t.withIdentity(identity) as unknown as {
    mutation(fn: unknown, args: unknown): Promise<unknown>;
    query(fn: unknown, args: unknown): Promise<unknown>;
  };
  harness.mutation = (name, args) =>
    admin.mutation(api.managebac[name.split(":")[1] as keyof typeof api.managebac], args);
  harness.query = (name, args) =>
    admin.query(api.managebac[name.split(":")[1] as keyof typeof api.managebac], args);
  // Ten pages of three classes; every page takes a minute to answer.
  const requestedPages: number[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const page = Number(new URL(String(input)).searchParams.get("page") ?? "1");
    requestedPages.push(page);
    advance(60_000);
    return Response.json({
      classes: Array.from({ length: PAGE_SIZE }, (_, index) => {
        const id = (page - 1) * PAGE_SIZE + index + 1;
        return { id, name: `Class ${id}` };
      }),
      meta: { next_page: page < PAGES ? page + 1 : null },
    });
  }));
  const sync = async () => {
    const response = await POST(new NextRequest("http://localhost/api/spectra/managebac", {
      method: "POST",
      body: JSON.stringify({ action: "sync", kind: "reconciliation" }),
      headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(200);
    return (await response.json()) as { syncRunId: string; suspended?: boolean; completion?: { status: string } };
  };
  const state = () => t.run(async (ctx) => {
    const records = await ctx.db.query("externalRecords")
      .withIndex("by_integration_type", (q) => q.eq("integrationId", seeded.integrationId).eq("recordType", "class"))
      .collect();
    return {
      records,
      live: records.filter((row) => !row.tombstone).map((row) => row.providerRecordKey),
      stale: records.find((row) => row._id === seeded.staleId)!,
      runs: await ctx.db.query("externalSyncRuns").collect(),
      seenKeys: await ctx.db.query("externalSyncSeenKeys").collect(),
    };
  });
  return { t, seeded, sync, state, requestedPages, advance };
}

/** A class another sync imported after this pass began; ManageBac does not list it. */
function insertLateRecord(t: Awaited<ReturnType<typeof setup>>["t"], seeded: Awaited<ReturnType<typeof setup>>["seeded"]) {
  return t.run((ctx) => {
    const now = Date.now();
    return ctx.db.insert("externalRecords", {
      integrationId: seeded.integrationId, schoolId: seeded.schoolId, providerRecordId: "late",
      providerRecordKey: "class:late", recordType: "class", classification: "school", audienceScope: "school",
      normalized: { name: "New class" }, payloadVersion: "v2", sourceHash: "late", sourceState: "available",
      sourceStateAt: now, tombstone: false, fetchedAt: now, createdAt: now, updatedAt: now,
    });
  });
}

describe("resumable ManageBac sync", () => {
  afterEach(() => {
    delete process.env.SPECTRA_CONNECTOR_BRIDGE_KEY;
    delete process.env.SPECTRA_MANAGEBAC_TEST_FIXTURE_ORIGIN;
    harness.mutation = undefined;
    harness.query = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("finishes a large school across several requests and removes only after the whole pass", async () => {
    const { t, seeded, sync, state, requestedPages, advance } = await setup();

    const first = await sync();
    expect(first).toMatchObject({ suspended: true, errorCode: "INTEGRATION_SYNC_TIME_BUDGET" });
    let now = await state();
    expect(now.runs).toHaveLength(1);
    expect(now.runs[0]).toMatchObject({ status: "partial", stage: "suspended" });
    // A partial pass never removes what it has not reached yet.
    expect(now.stale.tombstone).toBe(false);
    expect(now.live).toHaveLength(1 + 4 * PAGE_SIZE);

    advance(30_000);
    await insertLateRecord(t, seeded);

    const second = await sync();
    expect(second).toMatchObject({ syncRunId: first.syncRunId, suspended: true });
    now = await state();
    expect(now.runs).toHaveLength(1);
    expect(now.stale.tombstone).toBe(false);

    const third = await sync();
    expect(third.syncRunId).toBe(first.syncRunId);
    expect(third.suspended).toBeUndefined();
    expect(third.completion?.status).toBe("completed");
    // Each request continued from the page the previous one committed last.
    expect(requestedPages).toEqual([1, 2, 3, 4, 4, 5, 6, 7, 7, 8, 9, 10]);
    now = await state();
    expect(now.runs).toHaveLength(1);
    expect(now.runs[0]).toMatchObject({ status: "completed", stage: "complete" });
    expect(now.runs[0]!.cursorState).toBeUndefined();
    // The finished pass removes the class ManageBac dropped, and keeps the
    // one that appeared while it was paused.
    expect(now.stale.tombstone).toBe(true);
    expect(now.live).toHaveLength(PAGES * PAGE_SIZE + 1);
    expect(now.live).toContain("class:late");
    // The pass's seen keys are deleted once it closes.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await t.finishInProgressScheduledFunctions();
    expect((await state()).seenKeys).toHaveLength(0);
  });

  it("starts a fresh pass when the connection changed while the last one was paused", async () => {
    const { t, seeded, sync, state, requestedPages } = await setup();
    const first = await sync();
    expect(first.suspended).toBe(true);
    await t.run((ctx) => ctx.db.patch(seeded.integrationId, { credentialFingerprint: "token-b" }));

    const second = await sync();
    expect(second.syncRunId).not.toBe(first.syncRunId);
    expect(second.suspended).toBe(true);
    expect(requestedPages).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
    const now = await state();
    expect(now.runs.find((run) => run._id === first.syncRunId)).toMatchObject({
      status: "cancelled", stage: "restarted", errorCode: "INTEGRATION_SYNC_RESTARTED",
    });
    // Neither the dropped pass nor the new partial one removed anything.
    expect(now.stale.tombstone).toBe(false);
  });

  it("stops a paused pass when ManageBac is disconnected, removing nothing", async () => {
    const { t, sync, state } = await setup();
    const first = await sync();
    expect(first.suspended).toBe(true);
    await t.withIdentity(identity).mutation(api.managebac.disconnect, {});

    const now = await state();
    expect(now.runs.find((run) => run._id === first.syncRunId)).toMatchObject({
      status: "cancelled", stage: "integration_disconnected",
    });
    expect(now.stale.tombstone).toBe(false);
    const retry = await POST(new NextRequest("http://localhost/api/spectra/managebac", {
      method: "POST",
      body: JSON.stringify({ action: "sync", kind: "reconciliation" }),
      headers: { "content-type": "application/json" },
    }));
    expect(retry.status).not.toBe(200);
    expect((await state()).stale.tombstone).toBe(false);
  });
});
