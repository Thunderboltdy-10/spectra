/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requestLifecycleJob } from "./administration";
import { observeDatabase } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "platform-fixture", email: "platform-fixture@example.test", emailVerified: true };
const requestHandler = Reflect.get(requestLifecycleJob, "_handler") as (
  ctx: MutationCtx,
  args: { schoolId: Id<"schools">; type: "suspend"; reason: string },
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
      await integration(other);
      for (let row = 0; row < 60; row += 1) await artifact(other, "active", "x".repeat(8_000));
    }
    return { target };
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
});
