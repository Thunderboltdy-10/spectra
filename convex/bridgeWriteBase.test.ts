/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { dropWriteRequestBase, insertWriteRequest, writeRequestBase } from "./bridgeWriteBase";

const modules = import.meta.glob("./**/*.ts");
const make = () => convexTest(schema, modules);
type T = ReturnType<typeof make>;
const body = { blocks: Array.from({ length: 400 }, (_, index) => ({ id: `p${index}`, text: "A long essay paragraph. ".repeat(10) })) };

async function seed(t: T) {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Bases", slug: `bases-${crypto.randomUUID()}`, verifiedDomains: [],
      status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: "clerk_bases", email: "bases@example.test", emailVerified: true,
      name: "Bases", status: "active", createdAt: now, updatedAt: now });
    const workId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "resource",
      resourceClass: "resource", nativeFormat: "docx", title: "Essay", content: body, contentHash: "a", tags: [], status: "active",
      createdAt: now, updatedAt: now });
    const deviceId = await ctx.db.insert("bridgeDevices", { accountId, name: "Laptop", platform: "windows", credentialHash: "x",
      protocolVersion: "1", appVersion: "1", pairedAt: now, lastSeenAt: now, state: "active" });
    const mountId = await ctx.db.insert("bridgeMounts", { accountId, deviceId, rootLabel: "School", grantId: "grant_beef", state: "active",
      fileCount: 1, doubleSyncRisk: false, createdAt: now, updatedAt: now });
    const replicaId = await ctx.db.insert("workReplicas", { accountId, workId, kind: "local", deviceId, mountId, localResourceId: "lr_1",
      relativePath: "Essay.docx", nativeFormat: "docx", revision: "r1", state: "pending", updatedAt: now });
    return { accountId, workId, replicaId, deviceId, mountId, now };
  });
  const request = (state: "pending" | "verified") => ({
    accountId: ids.accountId, workId: ids.workId, replicaId: ids.replicaId, deviceId: ids.deviceId, mountId: ids.mountId,
    localResourceId: "lr_1", relativePath: "Essay.docx", payloadRef: "p",
    baseRevision: "r1", targetRevision: "r2", contentHash: "r2", idempotencyKey: crypto.randomUUID(), regionIds: [], partNames: [],
    projectionBaseContent: body, projectionBaseTextIndex: "A long essay", projectionBaseFidelityMap: { entries: [] },
    projectionBaseContentHash: "h", state, createdAt: ids.now, updatedAt: ids.now,
  });
  return { request };
}

describe("a Bridge write's base document lives beside the request", () => {
  it("keeps the request row small and reads the base back whole", async () => {
    const t = make();
    const { request } = await seed(t);
    const read = await t.run(async (ctx) => {
      const requestId = await insertWriteRequest(ctx.db, request("pending"));
      const row = (await ctx.db.get(requestId))!;
      return { size: JSON.stringify(row).length, base: await writeRequestBase(ctx.db, row), row };
    });
    expect(read.size).toBeLessThan(2_000);
    expect(read.row.projectionBaseContentHash).toBe("h");
    expect(read.base.projectionBaseContent).toEqual(body);
    expect(read.base.projectionBaseTextIndex).toBe("A long essay");
    const dropped = await t.run(async (ctx) => {
      const row = (await ctx.db.get(read.row._id))!;
      await dropWriteRequestBase(ctx.db, row);
      return writeRequestBase(ctx.db, row);
    });
    expect(dropped.projectionBaseContent).toBeUndefined();
  });

  it("older rows move out once; finished ones just drop their copy; the sweep frees finished sidecars", async () => {
    vi.useFakeTimers();
    try {
      const t = make();
      const { request } = await seed(t);
      const ids = await t.run(async (ctx) => ({
        pending: await ctx.db.insert("bridgeWriteRequests", request("pending")),
        verified: await ctx.db.insert("bridgeWriteRequests", request("verified")),
      }));
      expect(await t.mutation(internal.bridgeWriteBase.moveInlineBasesMigration, {})).toMatchObject({ state: "complete", moved: 2 });
      const after = await t.run(async (ctx) => {
        const pending = (await ctx.db.get(ids.pending))!;
        const verified = (await ctx.db.get(ids.verified))!;
        return { pending, verified, pendingBase: await writeRequestBase(ctx.db, pending), verifiedBase: await writeRequestBase(ctx.db, verified) };
      });
      expect(after.pending.projectionBaseContent).toBeUndefined();
      expect(after.pendingBase.projectionBaseContent).toEqual(body);
      expect(after.verifiedBase.projectionBaseContent).toBeUndefined();

      await t.run((ctx) => ctx.db.patch(ids.pending, { state: "verified" }));
      vi.setSystemTime(Date.now() + 2 * 60 * 60_000);
      expect(await t.mutation(internal.bridgeWriteBase.sweepFinishedBases, {})).toEqual({ freed: 1 });
      expect(await t.run((ctx) => ctx.db.query("bridgeWriteBases").collect())).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
