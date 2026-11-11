/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const owner = { subject: "device-chain-owner", email: "owner@device-chain.test", emailVerified: true };

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Device Chain School",
      slug: `device-chain-${crypto.randomUUID()}`,
      verifiedDomains: ["device-chain.test"],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: owner.subject,
      email: owner.email,
      emailVerified: true,
      name: "Owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId,
      schoolId,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const work = (title: string, storeId: string) =>
      ctx.db.insert("spectraArtifacts", {
        ownerAccountId: accountId,
        schoolId,
        blueprintKey: "document",
        title,
        content: { blocks: [] },
        schemaVersion: 4,
        tags: [],
        status: "active",
        storageHome: "device",
        storageStoreId: storeId,
        storageSeeded: true,
        createdAt: now,
        updatedAt: now,
      });
    const brought = await work("Brought", "store-A");
    const notBrought = await work("Written after the backup", "store-A");
    const third = await work("On a third computer", "store-C");
    return { accountId, brought, notBrought, third };
  });
}

async function backup(t: ReturnType<typeof convexTest>, accountId: Id<"accounts">, storeId: string, createdAt: number, full: boolean, extra: { computerName?: string; handOverTo?: string[] } = {}) {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([storeId]));
    return ctx.db.insert("deviceBackups", { accountId, storeId, storageId, bytes: 1, works: 1, full, createdAt, ...extra });
  });
}

describe("work kept on computers", () => {
  it("keeps each computer's backups in its own chain", async () => {
    const t = convexTest(schema, modules);
    const { accountId } = await seed(t);
    const now = Date.now();
    await backup(t, accountId, "store-A", now - 5_000, true, { computerName: "Laptop" });
    await backup(t, accountId, "store-A", now - 4_000, false);
    // B's full backup must not hide A's chain, nor count as A's.
    await backup(t, accountId, "store-B", now - 3_000, true, { computerName: "Desktop" });
    const me = t.withIdentity(owner);
    const chains = await me.query(api.deviceWorks.backupsToRestore, { storeId: "store-new" });
    const laptop = chains.find((chain) => chain.storeId === "store-A")!;
    expect(laptop.computerName).toBe("Laptop");
    expect(laptop.backups).toHaveLength(2);
    expect(laptop.backups[0]!.at).toBeLessThan(laptop.backups[1]!.at);
    expect(chains.find((chain) => chain.storeId === "store-B")?.backups).toHaveLength(1);
    const settings = await me.query(api.deviceWorks.settings, { storeId: "store-A" });
    expect(settings.lastBackupAt).toBe(now - 4_000);
    expect(settings.lastFullBackupAt).toBe(now - 5_000);
    const other = await me.query(api.deviceWorks.settings, { storeId: "store-C" });
    expect(other.lastBackupAt).toBeNull();
  });

  it("prunes within one computer's chain and never another's only full backup", async () => {
    const t = convexTest(schema, modules);
    const { accountId } = await seed(t);
    const now = Date.now();
    await backup(t, accountId, "store-B", now - 100_000, true);
    for (let index = 0; index < 10; index += 1) await backup(t, accountId, "store-A", now - 50_000 + index, index === 0 || index === 5);
    await t.mutation(internal.deviceWorks.pruneBackups, { accountId, storeId: "store-A" });
    const left = await t.run((ctx) => ctx.db.query("deviceBackups").collect());
    expect(left.filter((row) => row.storeId === "store-B")).toHaveLength(1);
    const chainA = left.filter((row) => row.storeId === "store-A");
    expect(chainA.some((row) => row.full)).toBe(true);
    expect(chainA).toHaveLength(7);
  });

  it("re-homes only the works a restore brought", async () => {
    const t = convexTest(schema, modules);
    const { brought, notBrought, third } = await seed(t);
    const me = t.withIdentity(owner);
    const { adopted } = await me.mutation(api.deviceWorks.adoptRestored, { storeId: "store-new", artifactIds: [brought] });
    expect(adopted).toBe(1);
    const rows = await t.run(async (ctx) => Promise.all([brought, notBrought, third].map((id) => ctx.db.get(id))));
    expect(rows.map((row) => row?.storageStoreId)).toEqual(["store-new", "store-A", "store-C"]);
  });

  it("addresses a hand-over to the computer the works moved to", async () => {
    const t = convexTest(schema, modules);
    const { accountId, brought, notBrought } = await seed(t);
    const me = t.withIdentity(owner);
    await me.mutation(api.deviceWorks.adoptRestored, { storeId: "store-B", artifactIds: [brought] });
    expect(await me.query(api.deviceWorks.handOverTargets, { storeId: "store-A", artifactIds: [brought, notBrought] })).toEqual(["store-B"]);
    const handOver = await backup(t, accountId, "store-A", Date.now(), false, { handOverTo: ["store-B"] });
    expect((await me.query(api.deviceWorks.settings, { storeId: "store-B" })).handOvers).toEqual([String(handOver)]);
    expect((await me.query(api.deviceWorks.settings, { storeId: "store-A" })).handOvers).toEqual([]);
    const waiting = await me.query(api.deviceWorks.handOverBackups, { storeId: "store-B" });
    expect(waiting.map((row) => row.id)).toEqual([String(handOver)]);
  });

  it("starts a fresh live room each time a work moves between a computer and the cloud (F19)", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { brought } = await seed(t);
    const me = t.withIdentity(owner);
    const openRoom = () =>
      t.run(async (ctx) => {
        const now = Date.now();
        const artifact = (await ctx.db.get(brought))!;
        return ctx.db.insert("collaborationRooms", {
          artifactId: brought, schoolId: artifact.schoolId, typeKey: "document", provider: "self_hosted_yjs",
          partitionKey: "root", schemaVersion: 4, policyVersion: 1, status: "active",
          nextSequence: 3, snapshotSequence: 0, uncompactedBytes: 10, createdAt: now, updatedAt: now,
        });
      });
    const earlier = await openRoom();
    await t.run((ctx) => ctx.db.patch(brought, { liveStateVectorHash: "device-history" }));
    const content = { blocks: [{ id: "b1", type: "paragraph", text: "One paragraph." }] };
    expect(await me.mutation(api.deviceWorks.movedToCloud, { artifactId: brought, title: "Brought", tags: [], content, textIndex: "One paragraph." }))
      .toEqual({ moved: true });
    const [work, retired] = await t.run(async (ctx) => [await ctx.db.get(brought), await ctx.db.get(earlier)] as const);
    expect(work?.storageEpoch).toBe(1);
    expect(work?.liveStateVectorHash).toBeUndefined();
    expect(retired?.status).toBe("closed");
    expect(retired?.partitionKey).toBe(`__retired__:${earlier}`);
    const live = await t.run((ctx) =>
      ctx.db.query("collaborationRooms").withIndex("by_artifact_partition", (q) => q.eq("artifactId", brought).eq("partitionKey", "root")).collect());
    expect(live).toHaveLength(0);
    // Back to the computer: the cloud room it used meanwhile is retired too.
    const cloudRoom = await openRoom();
    await me.mutation(api.deviceWorks.movedToDevice, { artifactId: brought, storeId: "store-A" });
    expect((await t.run((ctx) => ctx.db.get(brought)))?.storageEpoch).toBe(2);
    expect((await t.run((ctx) => ctx.db.get(cloudRoom)))?.status).toBe("closed");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  });

  it("deletes backups a page at a time", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { accountId } = await seed(t);
    for (let index = 0; index < 120; index += 1) await backup(t, accountId, "store-A", index, false);
    const { deleted } = await t.withIdentity(owner).mutation(api.deviceWorks.deleteBackups, {});
    expect(deleted).toBe(100);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("deviceBackups").collect())).toHaveLength(0);
    vi.useRealTimers();
  });
});
