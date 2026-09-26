/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import * as Y from "yjs";
import schema from "./schema";
import { internal } from "./_generated/api";
import { requireDurablePayloadAuthority } from "./collaborationDurablePayload";

const modules = import.meta.glob("./**/*.ts");
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("base64url");

async function fixture(options: { level?: "read" | "modify"; principal?: "account" | "school";
  source?: "direct" | "workspace_inheritance"; revoked?: boolean; expired?: boolean; owner?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const school = (name: string) => ctx.db.insert("schools", { name, slug: crypto.randomUUID(),
      verifiedDomains: [], status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    const home = await school("Home"), foreign = await school("Foreign");
    const account = (name: string) => ctx.db.insert("accounts", { clerkId: name, email: `${name}@example.test`,
      emailVerified: true, name, status: "active", createdAt: now, updatedAt: now });
    const owner = await account("owner"), visitor = await account("visitor");
    for (const [accountId, schoolId] of [[owner, home], [visitor, foreign]] as const)
      await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active",
        joinedAt: now, createdAt: now, updatedAt: now });
    const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: options.owner ? visitor : owner,
      schoolId: home, blueprintKey: "document", title: "Invited", tags: [], content: { blocks: [] },
      textIndex: "Invited", status: "active", createdAt: now, updatedAt: now });
    const roomId = await ctx.db.insert("collaborationRooms", { artifactId, schoolId: home, typeKey: "document",
      provider: "self_hosted_yjs", partitionKey: "root", schemaVersion: 2, policyVersion: 0, status: "active",
      nextSequence: 1, snapshotSequence: 0, uncompactedBytes: 0, createdAt: now, updatedAt: now });
    const grantId = await ctx.db.insert("accessGrants", { schoolId: home, resourceType: "artifact", resourceId: artifactId,
      principalType: options.principal ?? "account", principalId: options.principal === "school" ? foreign : visitor,
      level: options.level ?? "modify", capabilities: options.level === "read" ? ["read"] : ["read", "modify"],
      source: options.source ?? "direct", createdByAccountId: owner, createdAt: now, updatedAt: now,
      ...(options.revoked ? { revokedAt: now - 1 } : {}), ...(options.expired ? { expiresAt: now - 1 } : {}) });
    return { artifactId, roomId, accountId: visitor, grantId, updatedAt: now };
  });
  const access = { artifactId: ids.artifactId, accountId: ids.accountId, partitionKey: "root", policyVersion: 0 };
  const document = new Y.Doc();
  document.getMap("spectra:work-v2:live-meta").set("title", "Invited");
  const update = Uint8Array.from(Y.encodeStateAsUpdate(document)).buffer;
  const stateVectorHash = hash(Y.encodeStateVector(document));
  document.destroy();
  const projectionJson = JSON.stringify({ title: "Invited", tags: [], typeKey: "document", schemaVersion: 2, content: { blocks: [] } });
  const projectionHash = hash(projectionJson);
  const append = { ...access, actorKind: "human" as const, clientId: "visitor", idempotencyKey: "visitor:edit",
    update, expectedRoomId: ids.roomId, expectedNextSequence: 1, baseStateVectorHash: "initial-state-vector",
    stateVectorHash, regionIds: ["metadata:title"] };
  const checkpoint = { ...access, roomId: ids.roomId, clientId: "visitor", stateVectorHash, projectionJson, projectionHash, throughSequence: 0 };
  return { t, ids, access, append, checkpoint, update, stateVectorHash, projectionJson, projectionHash };
}

describe("exact invited collaboration authority", () => {
  it("allows a foreign account's direct modify grant through bootstrap, append, checkpoint and payload access", async () => {
    const f = await fixture();
    expect(await f.t.query(internal.collaborationGatewayStore.authorize, f.access)).toMatchObject({ allowed: true, canModify: true });
    await f.t.run(ctx => requireDurablePayloadAuthority(ctx, f.access, true));
    await f.t.mutation(internal.collaborationGatewayStore.bootstrapNative, { ...f.access, clientId: "visitor",
      artifactUpdatedAt: f.ids.updatedAt, expectedNextSequence: 1, update: f.update,
      stateVectorHash: f.stateVectorHash, projectionJson: f.projectionJson, projectionHash: f.projectionHash });
    await f.t.mutation(internal.collaborationGatewayStore.append, { ...f.append,
      expectedNextSequence: 2, baseStateVectorHash: f.stateVectorHash });
    await f.t.mutation(internal.collaborationGatewayStore.checkpoint, { ...f.checkpoint, throughSequence: 2 });
    expect(await f.t.query(internal.collaborationGatewayStore.load, { artifactId: f.ids.artifactId,
      partitionKey: "root", afterSequence: 0, limit: 10 })).toMatchObject({ roomId: f.ids.roomId, nextSequence: 3 });
    await f.t.run(ctx => ctx.db.patch(f.ids.grantId, { revokedAt: Date.now() }));
    expect(await f.t.query(internal.collaborationGatewayStore.authorize, f.access)).toMatchObject({ allowed: false });
    await expect(f.t.mutation(internal.collaborationGatewayStore.append, { ...f.append,
      expectedNextSequence: 2, baseStateVectorHash: f.stateVectorHash })).rejects.toThrow("COLLABORATION_GATEWAY_FORBIDDEN");
  });

  it.each([false, true])("keeps direct read invitations read-only even with foreign owner metadata (%s)", async owner => {
    const f = await fixture({ level: "read", owner });
    expect(await f.t.query(internal.collaborationGatewayStore.authorize, f.access)).toMatchObject({ allowed: true, canModify: false, level: "read" });
    await f.t.run(ctx => requireDurablePayloadAuthority(ctx, f.access));
    await expect(f.t.run(ctx => requireDurablePayloadAuthority(ctx, f.access, true))).rejects.toThrow("COLLABORATION_GATEWAY_FORBIDDEN");
    await expect(f.t.mutation(internal.collaborationGatewayStore.append, f.append)).rejects.toThrow("COLLABORATION_GATEWAY_FORBIDDEN");
    await expect(f.t.mutation(internal.collaborationGatewayStore.checkpoint, f.checkpoint)).rejects.toThrow("COLLABORATION_GATEWAY_FORBIDDEN");
  });

  it.each([{ principal: "school" as const }, { source: "workspace_inheritance" as const }, { revoked: true }, { expired: true }])(
    "rejects foreign non-account, inherited and inactive grants (%j)", async options => {
      const f = await fixture(options);
      expect(await f.t.query(internal.collaborationGatewayStore.authorize, f.access)).toMatchObject({ allowed: false });
      await expect(f.t.run(ctx => requireDurablePayloadAuthority(ctx, f.access))).rejects.toThrow("COLLABORATION_GATEWAY_FORBIDDEN");
      await expect(f.t.mutation(internal.collaborationGatewayStore.append, f.append)).rejects.toThrow("COLLABORATION_GATEWAY_FORBIDDEN");
      await expect(f.t.mutation(internal.collaborationGatewayStore.checkpoint, f.checkpoint)).rejects.toThrow("COLLABORATION_GATEWAY_FORBIDDEN");
    });
});
