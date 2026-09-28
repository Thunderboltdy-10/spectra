/// <reference types="vite/client" />
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { FunctionReturnType } from "convex/server";
import schema from "./schema";
import type { api } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { agentGovernance } from "./administration";
import { observeDatabase } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "governance-admin", email: "admin@governance.test", emailVerified: true };
const governanceHandler = Reflect.get(agentGovernance, "_handler") as (
  ctx: QueryCtx, args: Record<string, never>,
) => Promise<FunctionReturnType<typeof api.administration.agentGovernance>>;

it("reads the shared agents by id instead of every artifact body in the school", async () => {
  const t = convexTest(schema, modules);
  const f = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Governance", slug: "governance", verifiedDomains: [], status: "active",
      timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const otherSchoolId = await ctx.db.insert("schools", {
      name: "Other", slug: "other", verifiedDomains: [], status: "active",
      timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: identity.email, emailVerified: true, name: "Admin",
      status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId, schoolId, role: "school_admin", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    const artifact = (fields: { title: string; blueprintKey: string; status?: "active" | "archived"; body?: string }) =>
      ctx.db.insert("spectraArtifacts", {
        ownerAccountId: accountId, schoolId, title: fields.title, blueprintKey: fields.blueprintKey,
        content: { body: fields.body ?? "" }, tags: [], status: fields.status ?? "active", createdAt: now, updatedAt: now,
      });
    const share = (resourceId: string, principalType: "school" | "account", revokedAt?: number) =>
      ctx.db.insert("accessGrants", {
        schoolId, resourceType: "agent", resourceId, principalType,
        principalId: principalType === "school" ? schoolId : accountId, level: "read", capabilities: ["read", "use"],
        source: "direct", createdByAccountId: accountId, createdAt: now, updatedAt: now, revokedAt,
      });
    const tutor = await artifact({ title: "Tutor", blueprintKey: "agent" });
    const archived = await artifact({ title: "Archived", blueprintKey: "agent", status: "archived" });
    const privateAgent = await artifact({ title: "Private", blueprintKey: "agent" });
    const revoked = await artifact({ title: "Revoked", blueprintKey: "agent" });
    await share(tutor, "school");
    await share(archived, "school");
    await share(privateAgent, "account");
    await share(revoked, "school", now);
    // Usage recorded in another school stays out of this school's totals.
    for (const [agentId, school, invocations] of [[tutor, schoolId, 5], [tutor, otherSchoolId, 50], [archived, schoolId, 7]] as const) {
      const agentVersionId = await ctx.db.insert("spectraArtifactVersions", {
        artifactId: agentId, ownerAccountId: accountId, schoolId, source: "manual", createdAt: now,
      });
      await ctx.db.insert("agentUsageAggregates", {
        agentId, agentVersionId, schoolId: school, day: "2026-09-01", invocations, completed: invocations - 1,
        failed: 1, cancelled: 0, totalLatencyMs: 0, modelInputTokens: 0, modelOutputTokens: 0, updatedAt: now,
      });
    }
    for (let index = 0; index < 300; index += 1)
      await artifact({ title: `Essay ${index}`, blueprintKey: "document", body: "x".repeat(8_000) });
    return { schoolId, tutor };
  });

  const measured = await t.withIdentity(identity).run(async ctx => {
    const observer = observeDatabase(ctx.db);
    const result = await governanceHandler({ ...ctx, db: observer.db }, {});
    return { result, ...observer.snapshot() };
  });
  expect(measured.result.agents.map(row => [row.agentId, row.invocations])).toEqual([[f.tutor, 5]]);
  expect(measured.result.totals).toMatchObject({ sharedAgents: 1, invocations: 5 });
  // No range over the school's artifacts: 300 essays of 8 KB are never read.
  expect(measured.reads.filter(row => row.table === "spectraArtifacts")).toEqual([]);
  expect(measured.serializedDocumentBytes).toBeLessThan(20_000);
});
