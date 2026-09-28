/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { buildLifecycleExport, requestLifecycleJob } from "./administration";
import { observeDatabase } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "platform-fixture", email: "platform-fixture@example.test", emailVerified: true };
const requestHandler = Reflect.get(requestLifecycleJob, "_handler") as (
  ctx: MutationCtx,
  args: { schoolId: Id<"schools">; type: "suspend"; reason: string },
) => Promise<unknown>;

const exportHandler = Reflect.get(buildLifecycleExport, "_handler") as (
  ctx: MutationCtx,
  args: { jobId: Id<"schoolLifecycleJobs"> },
) => Promise<unknown>;

afterEach(() => vi.unstubAllEnvs());

/** A small school beside other tenants whose artifacts carry real content. */
async function tenantsFixture() {
  vi.stubEnv("SUPER_ADMIN_EMAILS", identity.email);
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const operatorId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: identity.email, emailVerified: true,
      name: "Operator fixture", status: "active", createdAt: now, updatedAt: now,
    });
    const school = (slug: string) => ctx.db.insert("schools", {
      name: slug, slug, verifiedDomains: [], status: "active", timezone: "Europe/Madrid",
      policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const artifact = (schoolId: Id<"schools">, status: "active" | "archived", body: string) =>
      ctx.db.insert("spectraArtifacts", {
        ownerAccountId: operatorId, schoolId, blueprintKey: "document", title: "Essay", content: { body },
        textIndex: "", tags: [], status, createdAt: now, updatedAt: now,
      });
    const integration = (schoolId: Id<"schools">) => ctx.db.insert("schoolIntegrations", {
      schoolId, provider: "managebac", baseUrl: "https://provider.example.test", authHeaderName: "X-API-Key",
      authScheme: "raw", status: "connected", tokenMode: "read_only", secretPurpose: "fixture", manifestVersion: 1,
      capabilityCoverage: { discovered: 1, verifiedReadable: 1, unverified: 0, failed: 0, quarantined: 0 },
      syncPolicy: { frequencyMinutes: 60, autoCreateClasses: false, autoImportTasks: true, autoApplySafeUpdates: true, conflictMode: "review" },
      freshnessSlaMinutes: 60, requestBudgetPerMinute: 30, bootstrapVersion: 1,
      createdByAccountId: operatorId, updatedByAccountId: operatorId, createdAt: now, updatedAt: now,
    });
    const target = await school("target-school");
    await artifact(target, "active", "short");
    await artifact(target, "archived", "short");
    await integration(target);
    for (let index = 0; index < 4; index += 1) {
      const other = await school(`other-school-${index}`);
      const integrationId = await integration(other);
      for (let row = 0; row < 60; row += 1) {
        await artifact(other, "active", "x".repeat(8_000));
        await ctx.db.insert("externalRecords", {
          integrationId, schoolId: other, providerRecordId: `record-${row}`, providerRecordKey: `task:${row}`,
          recordType: "task", classification: "class", audienceScope: "class_members",
          normalized: { description: "x".repeat(4_000) }, payloadVersion: "fixture-v1", sourceHash: "v1",
          tombstone: false, fetchedAt: now, createdAt: now, updatedAt: now,
        });
      }
    }
    const exportJobId = await ctx.db.insert("schoolLifecycleJobs", {
      schoolId: target, type: "export", status: "running", requestedByAccountId: operatorId,
      approvedByAccountIds: [operatorId], reason: "Legal export before purge",
      impact: { activeMembers: 0, artifacts: 2, workspaces: 0, integrations: 1 }, createdAt: now, updatedAt: now,
    });
    return { target, exportJobId };
  });
  return { t, ...ids };
}

const scanned = (reads: { table: string; operation: string; documentsReturned: number }[], table: string) =>
  reads.filter(row => row.table === table && row.operation !== "get").reduce((sum, row) => sum + row.documentsReturned, 0);

describe("school lifecycle impact", () => {
  it("counts one school's artifacts and integrations without scanning other tenants", async () => {
    const f = await tenantsFixture();
    const measured = await f.t.run(async ctx => {
      const observer = observeDatabase(ctx.db);
      const auth = { getUserIdentity: async () => ({ ...identity, tokenIdentifier: `fixture|${identity.subject}`, issuer: "fixture" }) };
      await requestHandler({ ...ctx, db: observer.db, auth }, {
        schoolId: f.target, type: "suspend", reason: "Safeguarding incident under review",
      });
      const job = await ctx.db.query("schoolLifecycleJobs").withIndex("by_school_created", q => q.eq("schoolId", f.target)).first();
      return { impact: job?.impact, ...observer.snapshot() };
    });
    expect(measured.impact).toEqual({ activeMembers: 0, artifacts: 2, workspaces: 0, integrations: 1 });
    expect(scanned(measured.reads, "spectraArtifacts")).toBe(2);
    expect(scanned(measured.reads, "schoolIntegrations")).toBe(1);
  });

  it("exports one school without scanning other tenants' provider records", async () => {
    const f = await tenantsFixture();
    const measured = await f.t.run(async ctx => {
      const observer = observeDatabase(ctx.db);
      await exportHandler({ ...ctx, db: observer.db }, { jobId: f.exportJobId });
      return observer.snapshot();
    });
    // Post-filter reads only report matches, so assert the scan itself is
    // bounded by a school index rather than the whole table.
    const schoolTables = ["feedbackReports", "schoolRequests", "memoryClaims", "schoolIntegrations", "integrationCapabilities", "externalRecords"];
    const unindexed = measured.reads.filter(row => schoolTables.includes(row.table) && !row.index).map(row => row.table);
    expect(unindexed).toEqual([]);
    expect(scanned(measured.reads, "schoolIntegrations")).toBe(1);
  });
});
