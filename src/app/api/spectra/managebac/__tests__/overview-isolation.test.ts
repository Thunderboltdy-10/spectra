/// <reference types="vite/client" />
import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../../../../convex/schema";
import { api } from "../../../../../../convex/_generated/api";

const modules = import.meta.glob("../../../../../../convex/**/*.ts");
const harness = vi.hoisted(() => ({
  role: "school_admin",
  query: vi.fn<(name: string, args: Record<string, unknown>) => Promise<unknown>>(),
}));
vi.mock("@/lib/auth-server", () => ({ requireActor: async () => ({ schoolRole: harness.role }) }));
vi.mock("@/lib/convex-server", () => ({ convexQuery: harness.query }));
const { GET } = await import("../route");
afterEach(() => { harness.query.mockReset(); harness.role = "school_admin"; });

async function setup() {
  const t = convexTest(schema, modules);
  const identity = { subject: "overview-admin", email: "admin@overview.test", emailVerified: true };
  await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Fixture", slug: "overview-fixture", verifiedDomains: ["overview.test"], status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    const account = async (subject: string) => ctx.db.insert("accounts", { clerkId: subject, email: subject === identity.subject ? identity.email : "other@overview.test", emailVerified: true, name: subject, status: "active", createdAt: now, updatedAt: now });
    const adminId = await account(identity.subject);
    const otherId = await account("other-member");
    for(const [accountId, role] of [[adminId, "school_admin"], [otherId, "student"]] as const)
      await ctx.db.insert("schoolMemberships", { accountId, schoolId, role, status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const integrationId = await ctx.db.insert("schoolIntegrations", {
      schoolId, provider: "managebac", baseUrl: "https://provider.example.test", authHeaderName: "auth-token", authScheme: "raw", status: "connected", tokenMode: "read_only", secretPurpose: "test", manifestVersion: 1,
      capabilityCoverage: { discovered: 0, verifiedReadable: 0, unverified: 0, failed: 0, quarantined: 0 },
      syncPolicy: { frequencyMinutes: 60, autoCreateClasses: false, autoImportTasks: true, autoApplySafeUpdates: true, conflictMode: "review" },
      freshnessSlaMinutes: 60, requestBudgetPerMinute: 180, bootstrapVersion: 1,
      createdByAccountId: adminId, updatedByAccountId: adminId, createdAt: now, updatedAt: now,
    });
    for(const [key, recordType, mappedAccountId] of [["own-task", "assignment", adminId], ["own-calendar", "timetable", adminId], ["private-other", "assignment", otherId], ["shared-task", "assignment", undefined]] as const)
      await ctx.db.insert("externalRecords", {
        integrationId, schoolId, providerRecordId: key, providerRecordKey: key, recordType,
        ...(mappedAccountId ? { mappedAccountId } : {}), classification: mappedAccountId ? "personal" : "school", audienceScope: mappedAccountId ? "mapped_user" : "school",
        normalized: { title: key }, payloadVersion: "v2", sourceHash: key, sourceState: "available", tombstone: false, fetchedAt: now, createdAt: now, updatedAt: now,
      });
  });
  const client = t.withIdentity(identity);
  harness.query.mockImplementation((name) => {
    if (name === "managebac:adminOverview") return client.query(api.managebac.adminOverview, {});
    if (name === "managebac:myOverview") return client.query(api.managebac.myOverview, {});
    throw new Error("Unexpected overview reader");
  });
  return client;
}

it("shows the admin's own tasks/calendar alongside shared previews without other members' records", async () => {
  const client = await setup();
  const response = await GET(new NextRequest("http://localhost/api/spectra/managebac"));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.admin).toBe(true);
  expect(result.data.records.map((r: { normalized: { title: string } }) => r.normalized.title).sort()).toEqual(["own-calendar", "own-task", "shared-task"]);
  // Operational previews retain their school-only boundary.
  expect((await client.query(api.managebac.adminOverview, {})).previews?.map(r => r.normalized)).toEqual([{ title: "shared-task" }]);
  expect(result.data.previews.map((r: { normalized: { title: string } }) => r.normalized.title)).toEqual(["shared-task"]);
});

it("keeps ordinary overview reads on the account-scoped reader", async () => {
  await setup();
  harness.role = "student";
  const response = await GET(new NextRequest("http://localhost/api/spectra/managebac"));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.admin).toBe(false);
  expect(result.data.records.map((r: { normalized: { title: string } }) => r.normalized.title).sort()).toEqual(["own-calendar", "own-task"]);
  expect(harness.query.mock.calls.map(([name]) => name)).toEqual(["managebac:myOverview"]);
});
