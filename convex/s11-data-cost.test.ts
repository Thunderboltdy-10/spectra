/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { FunctionReturnType } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { personalOverview } from "./analytics";
import { observeDatabase, serializedBytes } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "s11-data-reader", email: "s11-data@example.test", emailVerified: true };
const handler = Reflect.get(personalOverview, "_handler") as (
  ctx: QueryCtx, args: { from: number; to: number },
) => Promise<FunctionReturnType<typeof api.analytics.personalOverview>>;

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "S11 data fixture", slug: "s11-data", verifiedDomains: [], status: "active",
      timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: identity.email, emailVerified: true, name: "Reader",
      status: "active", createdAt: now, updatedAt: now,
    });
    const otherAccountId = await ctx.db.insert("accounts", {
      clerkId: "s11-data-other", email: "other@example.test", emailVerified: true, name: "Other",
      status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    return { now, schoolId, accountId, otherAccountId };
  });
  const range = { from: ids.now, to: ids.now + 10_000 };
  const workspace = (fields: Partial<Doc<"spectraWorkspaces">> = {}) => ({
    ownerAccountId: ids.accountId, schoolId: ids.schoolId, title: "Synthetic workspace",
    status: "active" as const, defaultView: "cards" as const,
    createdAt: ids.now, updatedAt: ids.now, lastActivityAt: ids.now + 5_000,
    ...fields,
  });
  const measure = () => t.withIdentity(identity).run(async ctx => {
    const observer = observeDatabase(ctx.db);
    const result = await handler({ ...ctx, db: observer.db }, range);
    return { metric: result.metrics.activeWorkspaces, responseBytes: serializedBytes(result), ...observer.snapshot() };
  });
  return { t, ids, workspace, measure };
}

describe("S11 active workspace analytics cost and correctness", () => {
  it("finds active workspaces beyond retained archived history without reading that history", async () => {
    const { t, ids, workspace, measure } = await fixture();
    await t.run(async ctx => {
      for (let index = 0; index < 12; index++) {
        await ctx.db.insert("spectraWorkspaces", workspace({ title: `Active ${index}` }));
      }
    });
    const sparse = await measure();
    const archived = await t.run(async ctx => {
      const retainedIds: Id<"spectraWorkspaces">[] = [];
      for (let index = 0; index < 2_010; index++) {
        // Earlier activity places retained history before every active row in
        // the former account/date query. This is not an artificial array mock.
        retainedIds.push(await ctx.db.insert("spectraWorkspaces", workspace({
          title: `Archived ${index}`, status: "archived", lastActivityAt: ids.now + index,
          description: "Retained private description ".repeat(40),
        })));
      }
      return retainedIds;
    });
    const archiveHeavy = await measure();
    const evidenceLabel = process.env.SPECTRA_S11_DATA_EVIDENCE;
    if (evidenceLabel === "before" || evidenceLabel === "after") {
      const directory = ".spectra-local/launch-s11/data";
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${directory}/analytics-workspaces-${evidenceLabel}.json`, JSON.stringify({
        evidence: "Real handler and indexed reads in convex-test. UTF-8 JSON bytes of returned rows, not physical engine bytes, scans, network traffic, or billing.",
        sourceSha256: createHash("sha256").update(readFileSync("convex/analytics.ts")).digest("hex"),
        archivedCount: archived.length, activeCount: 12, sparse, archiveHeavy,
      }, null, 2));
    }
    // Assert the user-visible result before accepting a cost improvement.
    expect(archiveHeavy.metric).toMatchObject({ value: 12, state: { kind: "available" } });
    expect(archiveHeavy.serializedDocumentBytes).toBe(sparse.serializedDocumentBytes);
    expect(archiveHeavy.documentsReturned).toBe(sparse.documentsReturned);
    expect(archiveHeavy.calls).toBe(sparse.calls);
    expect(archiveHeavy.writes).toBe(0);

    // Retained content can grow or change without adding reads to this active
    // range. None of these fixtures may be deleted to make the query cheap.
    await t.run(async ctx => {
      for (const id of archived.slice(0, 10)) await ctx.db.patch(id, {
        description: "Retained private description ".repeat(4_000),
      });
      for (let index = 0; index < 120; index++) {
        await ctx.db.insert("spectraWorkspaces", workspace({ ownerAccountId: ids.otherAccountId }));
        await ctx.db.insert("spectraWorkspaces", workspace({ lastActivityAt: ids.now - 1 }));
      }
      expect((await ctx.db.get(archived[0]!))?.description?.length).toBeGreaterThan(100_000);
      expect(await ctx.db.query("spectraWorkspaces")
        .withIndex("by_account_status", q => q.eq("ownerAccountId", ids.accountId).eq("status", "archived"))
        .collect()).toHaveLength(2_010);
    });
    const grown = await measure();
    expect(grown.metric).toMatchObject({ value: 12, state: { kind: "available" } });
    expect(grown.serializedDocumentBytes).toBe(sparse.serializedDocumentBytes);
    expect(grown.documentsReturned).toBe(sparse.documentsReturned);
  });

  it("reflects archive, restore, date and ownership changes, then rejects a deactivated reader", async () => {
    const { t, ids, workspace, measure } = await fixture();
    const workspaceId = await t.run(ctx => ctx.db.insert("spectraWorkspaces", workspace()));
    const expectCount = async (value: number) => {
      expect((await measure()).metric).toMatchObject({ value, state: { kind: "available" } });
    };
    await expectCount(1);
    await t.run(ctx => ctx.db.patch(workspaceId, { status: "archived" }));
    await expectCount(0);
    await t.run(ctx => ctx.db.patch(workspaceId, { status: "active" }));
    await expectCount(1);
    await t.run(ctx => ctx.db.patch(workspaceId, { lastActivityAt: ids.now - 1 }));
    await expectCount(0);
    await t.run(ctx => ctx.db.patch(workspaceId, { lastActivityAt: ids.now }));
    await expectCount(1);
    await t.run(ctx => ctx.db.patch(workspaceId, { lastActivityAt: ids.now + 10_000 }));
    await expectCount(1);
    await t.run(ctx => ctx.db.patch(workspaceId, { lastActivityAt: ids.now + 10_001 }));
    await expectCount(0);
    await t.run(ctx => ctx.db.patch(workspaceId, { lastActivityAt: ids.now, ownerAccountId: ids.otherAccountId }));
    await expectCount(0);
    await t.run(ctx => ctx.db.patch(workspaceId, { ownerAccountId: ids.accountId }));
    await expectCount(1);
    await t.run(ctx => ctx.db.patch(ids.accountId, { status: "deactivated" }));
    await expect(measure()).rejects.toThrow("AUTH_REQUIRED");
  });

  it("still marks more than 2,000 eligible active workspaces as partial", async () => {
    const { t, workspace, measure } = await fixture();
    await t.run(async ctx => {
      for (let index = 0; index < 2_001; index++) await ctx.db.insert("spectraWorkspaces", workspace());
    });
    const result = await measure();
    expect(result.metric).toMatchObject({ value: 2_000, state: { kind: "partial" } });
    expect(result.writes).toBe(0);
  });
});
