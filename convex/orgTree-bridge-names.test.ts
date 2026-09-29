/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "clerk_org_tree_bridge_names",
  email: "org-tree-bridge-names@example.test",
  emailVerified: true,
};

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

/** One Library work that Bridge mirrors as Biology/Essay.docx on disk. */
async function seedLinkedWork(t: ReturnType<typeof setupTest>, relativePath = "Biology/Essay.docx") {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Bridge Names School", slug: `bridge-names-${crypto.randomUUID()}`, verifiedDomains: [],
      status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: identity.email, emailVerified: true, name: "Bridge Names",
      status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    const deviceId = await ctx.db.insert("bridgeDevices", {
      accountId, name: "Laptop", platform: "windows", credentialHash: "c".repeat(64), protocolVersion: "1",
      appVersion: "1", pairedAt: now, lastSeenAt: now, state: "active",
    });
    const rootOrgNodeId = await ctx.db.insert("orgNodes", {
      accountId, schoolId, parentId: null, kind: "folder", name: "Mounted", orderKey: "a", createdAt: now, updatedAt: now,
    });
    const mountId = await ctx.db.insert("bridgeMounts", {
      accountId, deviceId, rootLabel: "Mounted", grantId: "grant_deadbeef", rootKey: "a".repeat(64), rootOrgNodeId,
      state: "active", fileCount: 1, doubleSyncRisk: false, lastScanId: crypto.randomUUID(), lastScanAt: now,
      createdAt: now, updatedAt: now,
    });
    const workId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: accountId, schoolId, blueprintKey: "resource", title: "Essay", content: {}, tags: [],
      status: "active", createdAt: now, updatedAt: now,
    });
    const nodeId = await ctx.db.insert("orgNodes", {
      accountId, schoolId, parentId: rootOrgNodeId, kind: "work", name: "Essay", sourceId: String(workId),
      orderKey: "b", typeKey: "resource", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("workReplicas", {
      accountId, workId, kind: "local", deviceId, mountId, localResourceId: "lr_00000000000000aa",
      relativePath, nativeFormat: "docx", revision: "a".repeat(64), contentHash: "a".repeat(64),
      state: "current", updatedAt: now,
    });
    return { accountId, nodeId, rootOrgNodeId };
  });
}

async function structureRequests(t: ReturnType<typeof setupTest>) {
  return t.run((ctx) => ctx.db.query("bridgeFsRequests").collect());
}

describe("Library names mirrored to Bridge files", () => {
  it("keeps the file's extension and folder when a linked work is renamed", async () => {
    const t = setupTest();
    const { nodeId } = await seedLinkedWork(t);
    await t.withIdentity(identity).mutation(api.orgTree.rename, { nodeId, name: "  Essay   draft " });
    const [request] = await structureRequests(t);
    expect(request).toMatchObject({
      kind: "rename",
      sourceRelativePath: "Biology/Essay.docx",
      targetRelativePath: "Biology/Essay draft.docx",
    });
  });

  it("drops trailing dots, which Windows would strip from the file name", async () => {
    const t = setupTest();
    const { nodeId } = await seedLinkedWork(t);
    await t.withIdentity(identity).mutation(api.orgTree.rename, { nodeId, name: "Notes..." });
    const [request] = await structureRequests(t);
    expect(request?.targetRelativePath).toBe("Biology/Notes.docx");
  });

  it("does not double the extension when the new name already has it", async () => {
    const t = setupTest();
    const { nodeId } = await seedLinkedWork(t);
    await t.withIdentity(identity).mutation(api.orgTree.rename, { nodeId, name: "Final essay.DOCX" });
    const [request] = await structureRequests(t);
    expect(request?.targetRelativePath).toBe("Biology/Final essay.docx");
  });

  it("does not ask Bridge to rename the file when a Library move keeps its name", async () => {
    const t = setupTest();
    const { nodeId } = await seedLinkedWork(t);
    await t.withIdentity(identity).mutation(api.orgTree.move, { nodeIds: [nodeId], parentId: null });
    expect(await structureRequests(t)).toEqual([]);
  });
});

/** The owner chose to mirror Library structure onto the folder on disk. */
async function mirrorStructureToDisk(t: ReturnType<typeof setupTest>, accountId: string) {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("syncPolicies", {
      accountId: accountId as never, scopeKind: "account", scopeId: accountId, preset: "both",
      contentDirection: "bidirectional", discovery: "auto", structure: "mirror-to-disk", cloudContent: "full",
      includeGlobs: [], excludeGlobs: [], timing: "continuous", protectedOriginal: false, createdAt: now, updatedAt: now,
    });
  });
}

describe("Trash and restore of a Bridge-linked work", () => {
  it("asks Bridge to delete the file once, even when the work is trashed again", async () => {
    const t = setupTest();
    const { nodeId, accountId } = await seedLinkedWork(t);
    await mirrorStructureToDisk(t, accountId);
    const user = t.withIdentity(identity);
    await user.mutation(api.orgTree.trash, { nodeIds: [nodeId] });
    // The replica moves on (a sync touched it) before the second, stale trash.
    await t.run(async (ctx) => {
      const replica = (await ctx.db.query("workReplicas").collect())[0]!;
      await ctx.db.patch(replica._id, { updatedAt: replica.updatedAt + 1 });
    });
    await user.mutation(api.orgTree.trash, { nodeIds: [nodeId] });
    const requests = await structureRequests(t);
    expect(requests.filter((request) => request.kind === "delete")).toHaveLength(1);
  });

  it("withdraws the waiting file deletion when the work is restored", async () => {
    const t = setupTest();
    const { nodeId, accountId } = await seedLinkedWork(t);
    await mirrorStructureToDisk(t, accountId);
    const user = t.withIdentity(identity);
    await user.mutation(api.orgTree.trash, { nodeIds: [nodeId] });
    const [queued] = await structureRequests(t);
    expect(queued?.kind).toBe("delete");
    expect(["approval-required", "pending"]).toContain(queued?.state);

    await user.mutation(api.orgTree.restore, { nodeIds: [nodeId] });
    const [after] = await structureRequests(t);
    expect(after?.state).toBe("ignored");
    expect(after?.explanation).toMatch(/restored/i);
  });
});
