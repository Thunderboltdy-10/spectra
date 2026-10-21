/// <reference types="vite/client" />
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  encodeArtifactContentForStorage,
  sheetCellEntries,
} from "../shared/sheet-cells";
import { BRIDGE_CLAIM_REDRIVE_MS, BRIDGE_WRITE_EXPIRES_MS } from "../shared/replica-truth";
import type { QueueMaterializationArgs, CloudMaterializationArgs, queueMaterializationInTransaction,
  commitCloudMaterializationInTransaction } from "./replicaMaterialization";

const nativeBridgeKey = "native-materialization-test-key-0000000001";
beforeEach(() => vi.stubEnv("SPECTRA_COLLAB_BRIDGE_KEY", nativeBridgeKey));
afterEach(() => vi.unstubAllEnvs());
type NativeTestClient = Pick<ReturnType<typeof convexTest>, "query" | "action">;
async function signedNative(client: NativeTestClient, candidate:
  { destination: "bridge"; queue: QueueMaterializationArgs } | { destination: "cloud"; cloud: CloudMaterializationArgs }) {
  const workId = candidate.destination === "bridge" ? candidate.queue.workId : candidate.cloud.workId;
  const { accountId } = await client.query(api.nativeMaterialization.head, { workId });
  const operation = "materializeNative" as const;
  const payloadJson = JSON.stringify({ artifactId: workId, accountId, partitionKey: "root", candidate });
  const timestamp = Date.now(), nonce = "native-materialization-fixture-nonce";
  const digest = createHash("sha256").update(payloadJson).digest("base64url");
  const signature = createHmac("sha256", nativeBridgeKey).update([operation,timestamp,nonce,digest].join("|")).digest("base64url");
  return client.action(api.collaborationGatewayBridge.exchange, { operation, payloadJson, timestamp, nonce, signature });
}
const queueNative = (client: NativeTestClient, queue: QueueMaterializationArgs) =>
  signedNative(client, { destination: "bridge", queue }) as Promise<Awaited<ReturnType<typeof queueMaterializationInTransaction>>>;
const cloudNative = (client: NativeTestClient, cloud: CloudMaterializationArgs) =>
  signedNative(client, { destination: "cloud", cloud }) as Promise<Awaited<ReturnType<typeof commitCloudMaterializationInTransaction>>>;

const modules = import.meta.glob("./**/*.ts");
// School-scoped work maintains org-node aggregates, as it does in production.
function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}
const identity = {
  subject: "clerk_replica_truth",
  email: "replica-truth@example.test",
  emailVerified: true,
};
const payloadHash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const baseHash = payloadHash("base");
const nextHash = payloadHash("next");
const bridgeCredential = "bridge-test-credential-000000000001";

describe("reactive work metadata availability", () => {
  it("reports unavailable metadata after an open work is permanently deleted", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const user = t.withIdentity(identity);
    expect(await user.query(api.replicas.forWork, { workId: fixture.workId })).not.toBeNull();
    await t.run(ctx => ctx.db.patch(fixture.workId, { status: "deleted" }));
    expect(await user.query(api.replicas.forWork, { workId: fixture.workId })).toBeNull();
    expect(await user.query(api.replicas.strategyTransitionForWork, { workId: fixture.workId })).toBeNull();
  });

  it("returns no reactive metadata when the work record is gone", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const user = t.withIdentity(identity);
    await t.run(ctx => ctx.db.delete(fixture.workId));
    expect(await user.query(api.replicas.strategyTransitionForWork, { workId: fixture.workId })).toBeNull();
    expect(await user.query(api.replicas.forWork, { workId: fixture.workId })).toBeNull();
  });
});

describe("Bridge materialization receipt replay", () => {
  it("refreshes only the current authorized claim before the native write", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const queued = await queueNative(t.withIdentity(identity), {
      workId: fixture.workId, payloadRef: String(fixture.nextPayloadId), contentHash: nextHash,
      baseRevision: baseHash, fidelityMap: {}, regionIds: [], partNames: [],
    });
    const requestId = requireWriteRequestId(queued.requestId);
    const first = (await t.mutation(api.bridgeSync.claimWrite, { credential: bridgeCredential })).request!;
    await t.run(ctx => ctx.db.patch(requestId, { claimedAt: Date.now() - BRIDGE_CLAIM_REDRIVE_MS - 1 }));
    const current = (await t.mutation(api.bridgeSync.claimWrite, { credential: bridgeCredential })).request!;
    const before = await t.run(ctx => ctx.db.get(requestId));
    expect(await t.mutation(api.bridgeSync.refreshWriteClaim, {
      credential: bridgeCredential, requestId, claimGeneration: first.claimGeneration, claimToken: first.claimToken,
    })).toEqual({ valid: false });
    expect(await t.run(ctx => ctx.db.get(requestId))).toEqual(before);
    const refresh = { credential: bridgeCredential, requestId, claimGeneration: current.claimGeneration, claimToken: current.claimToken };
    expect(await t.mutation(api.bridgeSync.refreshWriteClaim, refresh)).toEqual({ valid: true });
    await t.run(ctx => ctx.db.patch(fixture.mountId, { state: "detached" }));
    expect(await t.mutation(api.bridgeSync.refreshWriteClaim, refresh)).toEqual({ valid: false });
    await t.run(ctx => ctx.db.patch(fixture.mountId, { state: "active" }));
    await t.run(ctx => ctx.db.patch(fixture.workId, { status: "deleted" }));
    expect(await t.mutation(api.bridgeSync.refreshWriteClaim, refresh)).toEqual({ valid: false });
  });

  it.each(["pending", "claimed", "verified"] as const)(
    "keeps the newer canonical head and immutable request when replaying %s A",
    async (state) => {
      const t = setupTest();
      const fixture = await seedWork(t);
      const asUser = t.withIdentity(identity);
      const input = {
        workId: fixture.workId, localReplicaId: fixture.localId,
        payloadRef: String(fixture.nextPayloadId), contentHash: nextHash, baseRevision: baseHash,
        fidelityMap: { entries: [] }, regionIds: ["body"], partNames: ["word/document.xml"],
        projectionContent: { blocks: [{ id: "body", text: "older A" }] },
        projectionContentHash: nextHash, promotionMode: "immediate-projection" as const,
      };
      const a = await queueNative(asUser, input);
      if (state !== "pending") {
        const claimed = (await t.mutation(api.bridgeSync.claimWrite, { credential: bridgeCredential })).request;
        expect(claimed?.requestId).toBe(a.requestId);
        if (state === "verified") await t.mutation(api.bridgeSync.completeWrite, {
          credential: bridgeCredential, requestId: requireWriteRequestId(a.requestId),
          outcome: "verified", actualRevision: nextHash,
          claimGeneration: claimed!.claimGeneration, claimToken: claimed!.claimToken,
        });
      }
      const newer = { blocks: [{ id: "body", text: "newer B" }] };
      if (state === "verified") {
        const b = await queueNative(asUser, {
          ...input, payloadRef: String(fixture.basePayloadId), contentHash: baseHash, baseRevision: nextHash,
          projectionContent: newer, projectionContentHash: "c".repeat(64),
        });
        const claimed = (await t.mutation(api.bridgeSync.claimWrite, { credential: bridgeCredential })).request;
        expect(claimed?.requestId).toBe(b.requestId);
        await t.mutation(api.bridgeSync.completeWrite, {
          credential: bridgeCredential, requestId: requireWriteRequestId(b.requestId),
          outcome: "verified", actualRevision: baseHash,
          claimGeneration: claimed!.claimGeneration, claimToken: claimed!.claimToken,
        });
      } else {
        // A later collaborative canonical save need not wait for native A.
        await t.run(async (ctx) => ctx.db.patch(fixture.workId, {
          content: newer, contentHash: "c".repeat(64), textIndex: "newer B",
        }));
      }
      const snapshot = () => t.run(async (ctx) => ({
        work: await ctx.db.get(fixture.workId), local: await ctx.db.get(fixture.localId),
        cloud: await ctx.db.get(fixture.cloudId),
        request: await ctx.db.get(requireWriteRequestId(a.requestId)),
      }));
      const before = await snapshot();
      const replay = await queueNative(asUser, input);
      expect(replay).toMatchObject({ requestId: a.requestId, state });
      expect(await snapshot()).toEqual(before);
      expect(before.work?.content).toEqual(newer);
    },
  );
});

function requireWriteRequestId(
  requestId: Id<"bridgeWriteRequests"> | "protected-original",
): Id<"bridgeWriteRequests"> {
  if (requestId === "protected-original") {
    throw new Error(
      "expected a Bridge write request, not a protected-original park",
    );
  }
  return requestId;
}

async function seedActor(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Replica Truth School",
      slug: `replica-truth-${crypto.randomUUID()}`,
      verifiedDomains: [],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject,
      email: identity.email,
      emailVerified: true,
      name: "Replica Truth",
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
    return { accountId, schoolId };
  });
}

async function seedWork(t: ReturnType<typeof convexTest>) {
  const actor = await seedActor(t);
  return t.run(async (ctx) => {
    const now = Date.now();
    const workId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: actor.accountId,
      schoolId: actor.schoolId,
      blueprintKey: "resource",
      resourceClass: "resource",
      nativeFormat: "docx",
      compatibilityProfile: "strict-native",
      title: "Truth fixture",
      content: { blocks: [] },
      contentHash: baseHash,
      textIndex: "",
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const deviceId = await ctx.db.insert("bridgeDevices", {
      accountId: actor.accountId,
      name: "Test Bridge",
      platform: "windows",
      credentialHash: Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(bridgeCredential),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join(""),
      protocolVersion: "1",
      appVersion: "1",
      pairedAt: now,
      lastSeenAt: now,
      state: "active",
    });
    const mountId = await ctx.db.insert("bridgeMounts", {
      accountId: actor.accountId,
      deviceId,
      rootLabel: "Test",
      grantId: "grant_deadbeef",
      state: "active",
      fileCount: 1,
      doubleSyncRisk: false,
      createdAt: now,
      updatedAt: now,
    });
    const baseStorageId = await ctx.storage.store(new Blob(["base"]));
    const nextStorageId = await ctx.storage.store(new Blob(["next"]));
    const basePayloadId = await ctx.db.insert("payloadObjects", {
      accountId: actor.accountId,
      hash: baseHash,
      storageId: baseStorageId,
      bytes: 4,
      mediaType: "application/test",
      refCount: 2,
      state: "active",
      createdAt: now,
      verifiedAt: now,
    });
    const nextPayloadId = await ctx.db.insert("payloadObjects", {
      accountId: actor.accountId,
      hash: nextHash,
      storageId: nextStorageId,
      bytes: 4,
      mediaType: "application/test",
      refCount: 0,
      state: "active",
      createdAt: now,
      verifiedAt: now,
    });
    const cloudId = await ctx.db.insert("workReplicas", {
      accountId: actor.accountId,
      workId,
      kind: "cloud",
      nativeFormat: "docx",
      payloadRef: String(basePayloadId),
      revision: baseHash,
      baseRevision: baseHash,
      contentHash: baseHash,
      state: "current",
      lastVerifiedAt: now,
      updatedAt: now,
    });
    const localId = await ctx.db.insert("workReplicas", {
      accountId: actor.accountId,
      workId,
      kind: "local",
      deviceId,
      mountId,
      localResourceId: "resource-1",
      relativePath: "Truth.docx",
      nativeFormat: "docx",
      payloadRef: String(basePayloadId),
      revision: baseHash,
      baseRevision: baseHash,
      contentHash: baseHash,
      state: "current",
      lastVerifiedAt: now,
      updatedAt: now,
    });
    return {
      ...actor,
      workId,
      deviceId,
      mountId,
      basePayloadId,
      nextPayloadId,
      cloudId,
      localId,
    };
  });
}

describe("replica truth machine", () => {
  it("does not reactivate an original package over a durable authored head", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const content = { blocks: [{ id: "edited", text: "saved edit" }] };
    await t.run(ctx => ctx.db.patch(fixture.workId, { blueprintKey: "document", content, liveStateVectorHash: "durable-head" }));
    expect(await t.withIdentity(identity).mutation(api.replicas.activateLens, {
      workId: fixture.workId, payloadHash: baseHash, content: { blocks: [] }, fidelityMap: {},
      semanticDigest: baseHash, nativeFormat: "docx", blueprintKey: "document",
    })).toMatchObject({ activated: false });
    expect((await t.run(ctx => ctx.db.get(fixture.workId)))?.content).toEqual(content);
  });

  it("commits cloud native bytes once and fences stale materializations without replacing authored content", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const actor = t.withIdentity(identity);
    const semantic = "c".repeat(64);
    const input = {
      workId: fixture.workId, payloadRef: String(fixture.nextPayloadId), contentHash: nextHash,
      baseRevision: baseHash, projectionContent: { blocks: [{ text: "native result" }] },
      projectionContentHash: semantic, fidelityMap: { entries: [] },
      nativeReceipt: {
        kind: "native-office-save" as const, format: "docx" as const,
        operationId: `native:${fixture.workId}:${baseHash}:${nextHash}`, artifactId: String(fixture.workId),
        basePayloadHash: baseHash, resultPayloadHash: nextHash, baseRevision: baseHash, resultRevision: nextHash,
        targets: { regionIds: ["docx:p:1"], partNames: ["/word/document.xml"] },
        semantic: { resultDigest: semantic, readbackDigest: semantic }, preservedPartNames: [], state: "cloud_saved" as const,
      },
    };
    const before = await t.run(ctx => ctx.db.get(fixture.workId));
    const first = await cloudNative(actor, input);
    expect(await cloudNative(actor, input)).toEqual(first);
    expect(await t.run(ctx => ctx.db.get(fixture.cloudId))).toMatchObject({ revision: nextHash, payloadRef: String(fixture.nextPayloadId) });
    expect((await t.run(ctx => ctx.db.get(fixture.workId)))?.content).toEqual(before?.content);
    const newer = "d".repeat(64);
    await t.run(ctx => ctx.db.patch(fixture.cloudId, { revision: newer, contentHash: newer }));
    expect(await cloudNative(actor, input)).toEqual(first);
    expect((await t.run(ctx => ctx.db.get(fixture.cloudId)))?.revision).toBe(newer);
    await expect(cloudNative(actor, {
      ...input, baseRevision: nextHash,
      nativeReceipt: { ...input.nativeReceipt, baseRevision: nextHash, basePayloadHash: nextHash, operationId: `native:${fixture.workId}:${nextHash}:${nextHash}` },
    })).rejects.toThrow("MATERIALIZATION_BASE_STALE");
    await t.run(ctx => ctx.db.patch(fixture.workId, { status: "deleted" }));
    await expect(cloudNative(actor, input)).rejects.toThrow();
  });

  it("activates and materializes a workbook beyond Convex's object-field limit", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const cells = Object.fromEntries(
      Array.from({ length: 1_322 }, (_, index) => [
        `A${index + 1}`,
        { value: index + 1 },
      ]),
    );
    const workbook = {
      workbook: { calculationMode: "automatic", locale: "en-US" },
      sheets: [
        {
          id: "xlsx:sheet:1",
          name: "Data",
          cells,
          tables: [],
          charts: [],
        },
      ],
      activeSheetId: "xlsx:sheet:1",
    };
    const storedWorkbook = encodeArtifactContentForStorage("sheets", workbook);
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.cloudId, { nativeFormat: "xlsx" });
      await ctx.db.patch(fixture.localId, {
        nativeFormat: "xlsx",
        relativePath: "Truth.xlsx",
      });
    });

    await t.withIdentity(identity).mutation(api.replicas.activateLens, {
      workId: fixture.workId,
      payloadHash: baseHash,
      content: storedWorkbook,
      fidelityMap: { entries: [] },
      semanticDigest: "c".repeat(64),
      nativeFormat: "xlsx",
      blueprintKey: "sheets",
      textIndex: "bounded workbook",
    });
    const activated = await t.run(async (ctx) => ctx.db.get(fixture.workId));
    const activatedSheet = (
      activated?.content as { sheets?: Array<{ cells?: unknown }> }
    )?.sheets?.[0];
    expect(sheetCellEntries(activatedSheet?.cells)).toHaveLength(1_322);

    const queued = await queueNative(t
      .withIdentity(identity), {
        workId: fixture.workId,
        payloadRef: String(fixture.nextPayloadId),
        contentHash: nextHash,
        baseRevision: baseHash,
        fidelityMap: { entries: [] },
        regionIds: ["xlsx:sheet:1:A1322"],
        partNames: ["/xl/worksheets/sheet1.xml"],
        baseContent: storedWorkbook,
        baseContentHash: "c".repeat(64),
        projectionContent: storedWorkbook,
        projectionContentHash: "d".repeat(64),
      });
    const requestId = requireWriteRequestId(queued.requestId);
    const request = await t.run(async (ctx) => ctx.db.get(requestId));
    const projectedSheet = (
      request?.projectionBaseContent as {
        sheets?: Array<{ cells?: unknown }>;
      }
    )?.sheets?.[0];
    expect(sheetCellEntries(projectedSheet?.cells)).toHaveLength(1_322);
  });

  it("derives one replay-safe request without optimistic current stamps", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const input = {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    };

    const first = await queueNative(asUser, input);
    const replay = await queueNative(asUser, input);

    expect(replay.requestId).toBe(first.requestId);
    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      requests: await ctx.db.query("bridgeWriteRequests").collect(),
      operations: await ctx.db.query("syncOperations").collect(),
    }));
    expect(truth.requests).toHaveLength(1);
    expect(truth.operations).toHaveLength(1);
    expect(truth.cloud).toMatchObject({
      state: "current",
      revision: baseHash,
      contentHash: baseHash,
    });
    expect(truth.local).toMatchObject({ state: "pending", revision: baseHash });
    expect(truth.local?.state).not.toBe("current");
  });

  it("retargets materialization onto the live Bridge replica of the same path", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const staleLocalId = await t.run(async (ctx) => {
      const now = Date.now();
      const staleDeviceId = await ctx.db.insert("bridgeDevices", {
        accountId: fixture.accountId,
        name: "Silent Bridge",
        platform: "windows",
        credentialHash: "c".repeat(64),
        protocolVersion: "1",
        appVersion: "1",
        pairedAt: now - 60 * 60_000,
        lastSeenAt: now - 60 * 60_000,
        state: "active",
      });
      const staleMountId = await ctx.db.insert("bridgeMounts", {
        accountId: fixture.accountId,
        deviceId: staleDeviceId,
        rootLabel: "Old",
        grantId: "grant_stale",
        state: "active",
        fileCount: 1,
        doubleSyncRisk: false,
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.insert("workReplicas", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        kind: "local",
        deviceId: staleDeviceId,
        mountId: staleMountId,
        localResourceId: "resource-stale",
        relativePath: "Truth.docx",
        nativeFormat: "docx",
        payloadRef: String(fixture.basePayloadId),
        revision: baseHash,
        baseRevision: baseHash,
        contentHash: baseHash,
        state: "current",
        lastVerifiedAt: now,
        updatedAt: now + 10,
      });
    });

    const queued = await queueNative(t.withIdentity(identity), {
        workId: fixture.workId,
        payloadRef: String(fixture.nextPayloadId),
        contentHash: nextHash,
        baseRevision: baseHash,
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        localReplicaId: staleLocalId,
      });
    const request = await t.run(async (ctx) =>
      ctx.db.get(requireWriteRequestId(queued.requestId)),
    );
    expect(request?.localResourceId).toBe("resource-1");
    expect(request?.deviceId).toBe(fixture.deviceId);

    const truth = await t
      .withIdentity(identity)
      .query(api.replicas.forWork, { workId: fixture.workId });
    assert(truth, "Authorized work must have replica metadata");
    expect(
      truth.replicas.find((replica) => replica._id === staleLocalId),
    ).toMatchObject({
      state: "unavailable",
      unavailableReason: "not-on-this-computer",
    });
    expect(truth.pendingCount).toBe(1);
  });

  it("rejects a second materialization until the first write is verified", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const thirdHash = "c".repeat(64);
    const thirdPayloadId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["third"]));
      return ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: thirdHash,
        storageId,
        bytes: 5,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: Date.now(),
        verifiedAt: Date.now(),
      });
    });
    await expect(
      queueNative(asUser, {
        workId: fixture.workId,
        payloadRef: String(thirdPayloadId),
        contentHash: thirdHash,
        baseRevision: nextHash,
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
      }),
    ).rejects.toThrow("MATERIALIZATION_BASE_STALE");
  });

  it("advances the stored semantic base to the projection represented by verified bytes", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const projection = { blocks: [{ id: "body", text: "Saved projection" }] };
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      projectionContent: projection,
      projectionContentHash: nextHash,
      projectionTextIndex: "Saved projection",
    });
    await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: requireWriteRequestId(queued.requestId),
      outcome: "verified",
      actualRevision: nextHash,
    });
    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.cloud).toMatchObject({
      projectionBaseRevision: nextHash,
      projectionBaseContent: projection,
      projectionBaseContentHash: nextHash,
      projectionBaseTextIndex: "Saved projection",
    });
    expect(truth.local).toMatchObject({
      projectionBaseRevision: nextHash,
      projectionBaseContent: projection,
    });
  });

  it("keeps an external upload and its exact replay on the same replica truth", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const input = {
      credential: bridgeCredential,
      replicaId: fixture.localId,
      hash: nextHash,
      bytes: 4,
      mediaType: "application/test",
      payloadRef: String(fixture.nextPayloadId),
    };

    const first = await t.mutation(api.bridgeSync.commitPayloadUpload, input);
    const afterFirst = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      operations: await ctx.db.query("syncOperations").collect(),
      conflicts: await ctx.db.query("syncConflicts").collect(),
    }));
    const replay = await t.mutation(api.bridgeSync.commitPayloadUpload, input);
    const afterReplay = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      operations: await ctx.db.query("syncOperations").collect(),
      conflicts: await ctx.db.query("syncConflicts").collect(),
    }));

    expect(first).toMatchObject({ externalChange: true });
    expect(replay).toEqual(first);
    expect(afterFirst.local).toMatchObject({
      state: "ahead",
      revision: nextHash,
      baseRevision: baseHash,
      contentHash: nextHash,
    });
    expect(afterFirst.cloud).toMatchObject({
      state: "behind",
      revision: baseHash,
      baseRevision: baseHash,
      contentHash: baseHash,
    });
    expect(afterFirst.operations).toHaveLength(1);
    expect(afterFirst.operations[0]).toMatchObject({
      direction: "external",
      revisionBefore: baseHash,
      revisionAfter: nextHash,
      state: "applied",
    });
    expect(afterFirst.conflicts).toEqual([]);
    expect(afterReplay).toEqual(afterFirst);
  });

  it("retains the verified common base across successive external saves", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const thirdHash = payloadHash("third");
    const thirdPayloadId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["third"]));
      return ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: thirdHash,
        storageId,
        bytes: 5,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: Date.now(),
        verifiedAt: Date.now(),
      });
    });

    await t.mutation(api.bridgeSync.commitPayloadUpload, {
      credential: bridgeCredential,
      replicaId: fixture.localId,
      hash: nextHash,
      bytes: 4,
      mediaType: "application/test",
      payloadRef: String(fixture.nextPayloadId),
    });
    await t.mutation(api.bridgeSync.commitPayloadUpload, {
      credential: bridgeCredential,
      replicaId: fixture.localId,
      hash: thirdHash,
      bytes: 5,
      mediaType: "application/test",
      payloadRef: String(thirdPayloadId),
    });

    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      operations: await ctx.db.query("syncOperations").collect(),
      conflicts: await ctx.db.query("syncConflicts").collect(),
    }));
    expect(truth.local).toMatchObject({
      state: "ahead",
      revision: thirdHash,
      baseRevision: baseHash,
      contentHash: thirdHash,
    });
    expect(truth.cloud).toMatchObject({
      state: "behind",
      revision: baseHash,
      contentHash: baseHash,
    });
    expect(truth.operations).toHaveLength(2);
    expect(
      new Set(truth.operations.map((operation) => operation.idempotencyKey))
        .size,
    ).toBe(2);
    expect(truth.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          revisionAfter: nextHash,
          state: "failed",
          errorCode: "external-revision-superseded",
        }),
        expect.objectContaining({ revisionAfter: thirdHash, state: "applied" }),
      ]),
    );
    expect(truth.conflicts).toEqual([]);
  });

  it("does not present a superseded external revision as still syncing", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "superseded-external",
        direction: "external",
        revisionBefore: "0".repeat(64),
        revisionAfter: nextHash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: now,
        updatedAt: now,
      });
    });

    const truth = await t.withIdentity(identity).query(api.replicas.forWork, {
      workId: fixture.workId,
    });
    assert(truth, "Authorized work must have replica metadata");
    expect(truth.pendingCount).toBe(0);
  });

  it("lets a modify collaborator read replica truth without crashing", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const collaboratorIdentity = {
      subject: "clerk_replica_collaborator",
      email: "replica-collab@example.test",
      emailVerified: true,
    };
    const strangerIdentity = {
      subject: "clerk_replica_stranger",
      email: "replica-stranger@example.test",
      emailVerified: true,
    };
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.workId, { schoolId: fixture.schoolId });
      const collaboratorAccountId = await ctx.db.insert("accounts", {
        clerkId: collaboratorIdentity.subject,
        email: collaboratorIdentity.email,
        emailVerified: true,
        name: "Replica Collaborator",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId: collaboratorAccountId,
        schoolId: fixture.schoolId,
        role: "student",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("accessGrants", {
        schoolId: fixture.schoolId,
        resourceType: "artifact",
        resourceId: fixture.workId,
        principalType: "account",
        principalId: collaboratorAccountId,
        level: "modify",
        capabilities: ["read", "modify", "restore", "use", "comment"],
        source: "direct",
        createdByAccountId: fixture.accountId,
        createdAt: now,
        updatedAt: now,
      });
      const strangerAccountId = await ctx.db.insert("accounts", {
        clerkId: strangerIdentity.subject,
        email: strangerIdentity.email,
        emailVerified: true,
        name: "Replica Stranger",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId: strangerAccountId,
        schoolId: fixture.schoolId,
        role: "student",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    });
    const ownerTruth = await t.withIdentity(identity).query(api.replicas.forWork, {
      workId: fixture.workId,
    });
    assert(ownerTruth, "Authorized work must have replica metadata");
    expect(ownerTruth.replicas.length).toBeGreaterThan(0);
    const collaboratorTruth = await t
      .withIdentity(collaboratorIdentity)
      .query(api.replicas.forWork, { workId: fixture.workId });
    assert(collaboratorTruth, "Authorized work must have replica metadata");
    expect(collaboratorTruth.replicas.map((replica) => replica._id)).toEqual(
      ownerTruth.replicas
        .filter((replica) => replica.kind === "cloud")
        .map((replica) => replica._id),
    );
    expect(collaboratorTruth.replicas.every((replica) => replica.kind === "cloud")).toBe(true);
    expect(collaboratorTruth.replicas.some((replica) => "relativePath" in replica)).toBe(false);
    expect(await t.withIdentity(strangerIdentity).query(api.replicas.forWork, {
      workId: fixture.workId,
    })).toBeNull();
  });

  it("forwards shared Office capability to cloud payloads and lens activation without exposing owner Bridge state", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const collaboratorIdentity = {
      subject: "clerk_replica_native_collaborator",
      email: "native-collaborator@example.test",
      emailVerified: true,
    };
    const readerIdentity = {
      subject: "clerk_replica_native_reader",
      email: "native-reader@example.test",
      emailVerified: true,
    };
    const revokedIdentity = {
      subject: "clerk_replica_native_revoked",
      email: "native-revoked@example.test",
      emailVerified: true,
    };
    const foreignIdentity = {
      subject: "clerk_replica_native_foreign",
      email: "native-foreign@example.test",
      emailVerified: true,
    };
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.workId, { schoolId: fixture.schoolId });
      const foreignSchoolId = await ctx.db.insert("schools", {
        name: "Foreign Replica School",
        slug: `foreign-replica-${crypto.randomUUID()}`,
        verifiedDomains: [],
        status: "active",
        timezone: "Europe/Madrid",
        policyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const identities = [
        [collaboratorIdentity, fixture.schoolId],
        [readerIdentity, fixture.schoolId],
        [revokedIdentity, fixture.schoolId],
        [foreignIdentity, foreignSchoolId],
      ] as const;
      const accountIds = new Map<string, Id<"accounts">>();
      for (const [candidate, schoolId] of identities) {
        const accountId = await ctx.db.insert("accounts", {
          clerkId: candidate.subject,
          email: candidate.email,
          emailVerified: true,
          name: candidate.email,
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
        accountIds.set(candidate.subject, accountId);
        await ctx.db.insert("schoolMemberships", {
          accountId,
          schoolId,
          role: "student",
          status: "active",
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      const grant = async (candidate: typeof collaboratorIdentity, level: "read" | "modify") =>
        ctx.db.insert("accessGrants", {
          schoolId: fixture.schoolId,
          resourceType: "artifact",
          resourceId: fixture.workId,
          principalType: "account",
          principalId: accountIds.get(candidate.subject)!,
          level,
          capabilities: level === "modify"
            ? ["read", "modify", "restore", "use", "comment"]
            : ["read", "use", "comment"],
          source: "direct",
          createdByAccountId: fixture.accountId,
          createdAt: now,
          updatedAt: now,
        });
      const collaboratorGrantId = await grant(collaboratorIdentity, "modify");
      await grant(readerIdentity, "read");
      const revokedGrantId = await grant(revokedIdentity, "modify");
      return { collaboratorGrantId, revokedGrantId };
    });

    expect(
      (await t.withIdentity(identity).query(api.spectraArtifacts.get, {
        artifactId: fixture.workId,
      })).accessLevel,
    ).toBe("modify");
    expect(
      (await t.withIdentity(collaboratorIdentity).query(api.spectraArtifacts.get, {
        artifactId: fixture.workId,
      })).accessLevel,
    ).toBe("modify");
    expect(
      (await t.withIdentity(readerIdentity).query(api.spectraArtifacts.get, {
        artifactId: fixture.workId,
      })).accessLevel,
    ).toBe("read");

    const cloudForOwner = await t.withIdentity(identity).query(api.replicas.payloadForWork, {
      workId: fixture.workId,
      prefer: "cloud",
    });
    const cloudForCollaborator = await t.withIdentity(collaboratorIdentity).query(api.replicas.payloadForWork, {
      workId: fixture.workId,
      prefer: "cloud",
    });
    const cloudForReader = await t.withIdentity(readerIdentity).query(api.replicas.payloadForWork, {
      workId: fixture.workId,
      prefer: "cloud",
    });
    expect(cloudForCollaborator).toMatchObject({
      payloadRef: String(fixture.basePayloadId),
      replicaKind: "cloud",
      hash: baseHash,
    });
    expect(cloudForReader?.payloadRef).toBe(String(fixture.basePayloadId));
    expect(cloudForOwner?.url).toBeTruthy();
    expect(cloudForCollaborator?.url).toBeTruthy();
    expect(cloudForCollaborator?.url).toBe(cloudForOwner?.url);
    expect(
      await t.withIdentity(collaboratorIdentity).query(api.replicas.payloadForWork, {
        workId: fixture.workId,
        prefer: "local-latest",
      }),
    ).toMatchObject({ replicaKind: "cloud", payloadRef: String(fixture.basePayloadId) });
    expect(
      await t.withIdentity(collaboratorIdentity).query(api.payloads.get, {
        hash: baseHash,
      }),
    ).toBeNull();
    expect(
      await t.withIdentity(collaboratorIdentity).query(api.payloads.get, {
        hash: baseHash,
        workId: fixture.workId,
      }),
    ).toMatchObject({ hash: baseHash, bytes: 4 });
    await t.run(async (ctx) => ctx.db.patch(ids.revokedGrantId, { revokedAt: Date.now() }));
    await expect(
      t.withIdentity(revokedIdentity).query(api.spectraArtifacts.get, {
        artifactId: fixture.workId,
      }),
    ).rejects.toThrow(/Artifact not found|WORK_NOT_FOUND|AUTH_RESOURCE_FORBIDDEN/);
    await expect(
      t.withIdentity(revokedIdentity).query(api.replicas.payloadForWork, {
        workId: fixture.workId,
        prefer: "cloud",
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);

    await expect(
      t.withIdentity(readerIdentity).mutation(api.replicas.activateLens, {
        workId: fixture.workId,
        payloadHash: baseHash,
        content: { blocks: [] },
        fidelityMap: { entries: [] },
        semanticDigest: "c".repeat(64),
        nativeFormat: "docx",
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);
    await expect(
      t.withIdentity(foreignIdentity).query(api.replicas.payloadForWork, {
        workId: fixture.workId,
        prefer: "cloud",
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);
    await expect(
      t.withIdentity(foreignIdentity).query(api.payloads.get, {
        hash: baseHash,
        workId: fixture.workId,
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);

    await t.withIdentity(collaboratorIdentity).mutation(api.replicas.activateLens, {
      workId: fixture.workId,
      payloadHash: baseHash,
      content: { blocks: [] },
      fidelityMap: { entries: [] },
      semanticDigest: "c".repeat(64),
      nativeFormat: "docx",
    });
    await t.run(async (ctx) => ctx.db.patch(ids.collaboratorGrantId, { revokedAt: Date.now() }));
    expect(await t.withIdentity(collaboratorIdentity).query(api.replicas.forWork, {
      workId: fixture.workId,
    })).toBeNull();
    await expect(
      t.withIdentity(collaboratorIdentity).query(api.replicas.payloadForWork, {
        workId: fixture.workId,
        prefer: "cloud",
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);
    await expect(
      t.withIdentity(collaboratorIdentity).mutation(api.replicas.activateLens, {
        workId: fixture.workId,
        payloadHash: baseHash,
        content: { blocks: [] },
        fidelityMap: { entries: [] },
        semanticDigest: "d".repeat(64),
        nativeFormat: "docx",
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);

  });

  it("lets a modify collaborator queue materialization only onto their own local replica", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const collaboratorCredential = "bridge-collaborator-credential-000001";
    const collaboratorIdentity = {
      subject: "clerk_replica_writer",
      email: "replica-writer@example.test",
      emailVerified: true,
    };
    const readerIdentity = {
      subject: "clerk_replica_reader",
      email: "replica-reader@example.test",
      emailVerified: true,
    };
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.workId, { schoolId: fixture.schoolId });
      const collaboratorAccountId = await ctx.db.insert("accounts", {
        clerkId: collaboratorIdentity.subject,
        email: collaboratorIdentity.email,
        emailVerified: true,
        name: "Replica Writer",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const readerAccountId = await ctx.db.insert("accounts", {
        clerkId: readerIdentity.subject,
        email: readerIdentity.email,
        emailVerified: true,
        name: "Replica Reader",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      for (const accountId of [collaboratorAccountId, readerAccountId]) {
        await ctx.db.insert("schoolMemberships", {
          accountId,
          schoolId: fixture.schoolId,
          role: "student",
          status: "active",
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      const collaboratorGrantId = await ctx.db.insert("accessGrants", {
        schoolId: fixture.schoolId,
        resourceType: "artifact",
        resourceId: fixture.workId,
        principalType: "account",
        principalId: collaboratorAccountId,
        level: "modify",
        capabilities: ["read", "modify", "restore", "use", "comment"],
        source: "direct",
        createdByAccountId: fixture.accountId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("accessGrants", {
        schoolId: fixture.schoolId,
        resourceType: "artifact",
        resourceId: fixture.workId,
        principalType: "account",
        principalId: readerAccountId,
        level: "read",
        capabilities: ["read", "use", "comment"],
        source: "direct",
        createdByAccountId: fixture.accountId,
        createdAt: now,
        updatedAt: now,
      });
      const deviceId = await ctx.db.insert("bridgeDevices", {
        accountId: collaboratorAccountId,
        name: "Collaborator Bridge",
        platform: "windows",
        credentialHash: Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(collaboratorCredential),
            ),
          ),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join(""),
        protocolVersion: "1",
        appVersion: "1",
        pairedAt: now,
        lastSeenAt: now,
        state: "active",
      });
      const mountId = await ctx.db.insert("bridgeMounts", {
        accountId: collaboratorAccountId,
        deviceId,
        rootLabel: "Collab",
        grantId: "grant_collaborator",
        state: "active",
        fileCount: 1,
        doubleSyncRisk: false,
        createdAt: now,
        updatedAt: now,
      });
      const storageId = await ctx.storage.store(new Blob(["collab"]));
      const payloadId = await ctx.db.insert("payloadObjects", {
        accountId: collaboratorAccountId,
        hash: nextHash,
        storageId,
        bytes: 6,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: now,
        verifiedAt: now,
      });
      const localId = await ctx.db.insert("workReplicas", {
        accountId: collaboratorAccountId,
        workId: fixture.workId,
        kind: "local",
        deviceId,
        mountId,
        localResourceId: "resource-collab",
        relativePath: "Shared.docx",
        nativeFormat: "docx",
        payloadRef: String(fixture.basePayloadId),
        revision: baseHash,
        baseRevision: baseHash,
        contentHash: baseHash,
        state: "current",
        lastVerifiedAt: now,
        updatedAt: now,
      });
      return { localId, payloadId, deviceId, mountId, collaboratorGrantId };
    });

    const queued = await queueNative(t
      .withIdentity(collaboratorIdentity), {
        workId: fixture.workId,
        payloadRef: String(seeded.payloadId),
        contentHash: nextHash,
        baseRevision: baseHash,
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
      });
    expect(queued.state).toBe("pending");

    await expect(
      queueNative(t.withIdentity(collaboratorIdentity), {
        workId: fixture.workId,
        payloadRef: String(seeded.payloadId),
        contentHash: nextHash,
        baseRevision: baseHash,
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        localReplicaId: fixture.localId,
      }),
    ).rejects.toThrow(/LOCAL_REPLICA_UNAVAILABLE/);

    await expect(
      queueNative(t.withIdentity(readerIdentity), {
        workId: fixture.workId,
        payloadRef: String(seeded.payloadId),
        contentHash: nextHash,
        baseRevision: baseHash,
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);

    const uploadUrl = await t
      .withIdentity(collaboratorIdentity)
      .mutation(api.payloads.issueUpload, {
        workId: fixture.workId,
      });
    expect(typeof uploadUrl).toBe("string");
    expect(String(uploadUrl).length).toBeGreaterThan(8);

    const claimed = await t.mutation(api.bridgeSync.claimWrite, {
      credential: collaboratorCredential,
    });
    const requestId = requireWriteRequestId(queued.requestId);
    expect(claimed.request?.requestId).toBe(requestId);
    await t.run(async (ctx) =>
      ctx.db.patch(seeded.collaboratorGrantId, { revokedAt: Date.now() }),
    );
    await expect(
      t.mutation(api.bridgeSync.beginPayloadUpload, {
        credential: collaboratorCredential,
        replicaId: seeded.localId,
        hash: nextHash,
        bytes: 6,
        mediaType: "application/test",
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);
    const completed = await t.mutation(api.bridgeSync.completeWrite, {
      credential: collaboratorCredential,
      requestId,
      outcome: "verified",
      actualRevision: nextHash,
      claimGeneration: claimed.request?.claimGeneration,
      claimToken: claimed.request?.claimToken,
    });
    expect(completed.state).toBe("failed");
    const afterRevocation = await t.run(async (ctx) => ({
      request: await ctx.db.get(requestId),
      local: await ctx.db.get(seeded.localId),
      cloud: await ctx.db.get(fixture.cloudId),
    }));
    expect(afterRevocation.request).toMatchObject({
      state: "failed",
      errorCode: "permission-revoked",
    });
    expect(afterRevocation.local).toMatchObject({
      state: "error",
      errorCode: "permission-revoked",
    });
    expect(afterRevocation.cloud).toMatchObject({
      payloadRef: String(fixture.basePayloadId),
      contentHash: baseHash,
    });
  });

  it("does not keep Syncing after an applied Spectra write", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "applied-spectra-write",
        direction: "cloud-to-local",
        revisionBefore: baseHash,
        revisionAfter: nextHash,
        state: "applied",
        actorKind: "user",
        createdAt: now,
        updatedAt: now,
      });
    });
    const truth = await t.withIdentity(identity).query(api.replicas.forWork, {
      workId: fixture.workId,
    });
    assert(truth, "Authorized work must have replica metadata");
    expect(truth.pendingCount).toBe(0);
  });

  it("does not treat a Keep Spectra write as an open conflict", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        state: "resolving-spectra",
        createdAt: now,
        updatedAt: now,
      });
    });
    const truth = await t.withIdentity(identity).query(api.replicas.forWork, {
      workId: fixture.workId,
    });
    assert(truth, "Authorized work must have replica metadata");
    expect(truth.openConflictCount).toBe(0);
    expect(truth.conflicts).toEqual([]);
  });

  it("expires an external revision that never reaches reconciliation", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const operationId = await t.run(async (ctx) => {
      const stalledAt = Date.now() - BRIDGE_WRITE_EXPIRES_MS - 1;
      return ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "stalled-external",
        direction: "external",
        revisionBefore: baseHash,
        revisionAfter: baseHash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: stalledAt,
        updatedAt: stalledAt,
      });
    });

    const result = await t.mutation(internal.replicas.sweepReplicaTruth, {});
    expect(result.documentsRead).toBeLessThanOrEqual(100);
    expect(result.expiredExternalOperations).toBe(1);
    const operation = await t.run(async (ctx) => ctx.db.get(operationId));
    expect(operation).toMatchObject({
      state: "failed",
      errorCode: "external-reconciliation-expired",
    });
  });

  it("compensates an expired claimed write and its dependent rows", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const ids = await t.run(async (ctx) => {
      const then = Date.now() - 60 * 60_000;
      await ctx.db.patch(fixture.localId, {
        state: "pending",
        updatedAt: then,
      });
      const requestId = await ctx.db.insert("bridgeWriteRequests", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        deviceId: fixture.deviceId,
        mountId: fixture.mountId,
        localResourceId: "resource-1",
        relativePath: "Truth.docx",
        payloadRef: String(fixture.nextPayloadId),
        baseRevision: baseHash,
        targetRevision: nextHash,
        contentHash: nextHash,
        idempotencyKey: "expired-write",
        regionIds: [],
        partNames: [],
        state: "claimed",
        claimedAt: then,
        attemptCount: 1,
        expiresAt: then + 1,
        createdAt: then,
        updatedAt: then,
      });
      const operationId = await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "expired-write",
        direction: "cloud-to-local",
        revisionBefore: baseHash,
        revisionAfter: nextHash,
        state: "pending",
        actorKind: "user",
        createdAt: then,
        updatedAt: then,
      });
      return { requestId, operationId };
    });

    const result = await t.mutation(internal.replicas.sweepReplicaTruth, {});
    expect(result.failedWrites).toBe(1);
    const truth = await t.run(async (ctx) => ({
      request: await ctx.db.get(ids.requestId),
      operation: await ctx.db.get(ids.operationId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.request).toMatchObject({
      state: "failed",
      errorCode: "write-expired",
    });
    expect(truth.operation).toMatchObject({
      state: "failed",
      errorCode: "write-expired",
    });
    expect(truth.local).toMatchObject({
      state: "error",
      errorCode: "write-expired",
    });
  });

  it("releases only payload bytes with no live references", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) =>
      ctx.db.patch(fixture.nextPayloadId, {
        verifiedAt: Date.now() - 25 * 60 * 60_000,
      }),
    );

    const result = await t.mutation(internal.replicas.sweepReplicaTruth, {});
    expect(result.releasedPayloads).toBe(1);
    const truth = await t.run(async (ctx) => ({
      released: await ctx.db.get(fixture.nextPayloadId),
      retained: await ctx.db.get(fixture.basePayloadId),
    }));
    expect(truth.released).toMatchObject({ state: "released", refCount: 0 });
    expect(truth.retained).toMatchObject({ state: "active" });
  });

  it("finishes cloud-to-device storage only after Bridge read-back", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => ctx.db.delete(fixture.localId));
    const asUser = t.withIdentity(identity);

    const transition = await asUser.mutation(
      api.replicas.transitionStorageStrategy,
      {
        workId: fixture.workId,
        toPreset: "device",
        mountId: fixture.mountId,
        relativePath: "Truth.docx",
      },
    );
    expect(transition.state).toBe("pending");
    expect(transition.materializationRequestId).not.toBeNull();
    expect(transition.operationId).not.toBeNull();
    expect(transition.preview).toMatchObject({
      before: { locations: { cloud: expect.objectContaining({ kind: "cloud" }) } },
      after: { physicalLocalAction: "write-retained-payload-to-existing-local-resource" },
    });
    expect(transition.transitionReceipt).toMatchObject({
      state: "pending",
      operationId: String(transition.operationId),
    });
    const replay = await asUser.mutation(
      api.replicas.transitionStorageStrategy,
      {
        workId: fixture.workId,
        toPreset: "device",
        mountId: fixture.mountId,
        relativePath: "Truth.docx",
      },
    );
    expect(replay.transitionId).toBe(transition.transitionId);
    expect(replay.materializationRequestId).toBe(
      transition.materializationRequestId,
    );
    expect(replay.operationId).toBe(transition.operationId);
    const status = await asUser.query(api.replicas.strategyTransitionForWork, {
      workId: fixture.workId,
    });
    expect(status).toMatchObject({
      requestId: transition.materializationRequestId,
      operationId: transition.operationId,
      requestState: "pending",
      operationState: "pending",
      preview: {
        pendingWork: {
          localResourceId: expect.any(String),
          relativePath: "Truth.docx",
        },
      },
    });

    const completed = await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: transition.materializationRequestId!,
      outcome: "verified",
      actualRevision: baseHash,
    });
    expect(completed.state).toBe("verified");
    const truth = await t.run(async (ctx) => ({
      transition: await ctx.db.get(transition.transitionId),
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db
        .query("workReplicas")
        .withIndex("by_work_kind", (q) =>
          q.eq("workId", fixture.workId).eq("kind", "local"),
        )
        .unique(),
    }));
    expect(truth.transition).toMatchObject({
      state: "verified",
      toPreset: "device",
    });
    expect(truth.cloud).toMatchObject({
      state: "unavailable",
      unavailableReason: "metadata-only",
    });
    expect(truth.cloud?.payloadRef).toBeUndefined();
    expect(truth.local).toMatchObject({ state: "current", revision: baseHash });
    expect(truth.local?.payloadRef).toBeUndefined();
    await expect(
      asUser.mutation(api.payloads.issueUpload, { workId: fixture.workId }),
    ).rejects.toThrow("CLOUD_CONTENT_METADATA_ONLY");
  });

  it("finishes Keep in Spectra by attaching a retained payload without waiting on Bridge", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "device",
    });
    const afterDevice = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      payload: await ctx.db.get(fixture.basePayloadId),
    }));
    expect(afterDevice.cloud).toMatchObject({
      state: "unavailable",
      unavailableReason: "metadata-only",
    });
    expect(afterDevice.cloud?.payloadRef).toBeUndefined();
    expect(afterDevice.local?.payloadRef).toBeUndefined();
    expect(afterDevice.payload).toMatchObject({
      state: "active",
      hash: baseHash,
    });

    const transition = await asUser.mutation(
      api.replicas.transitionStorageStrategy,
      {
        workId: fixture.workId,
        toPreset: "spectra",
      },
    );
    expect(transition.state).toBe("verified");
    const truth = await t.run(async (ctx) => ({
      transition: await ctx.db.get(transition.transitionId),
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.transition).toMatchObject({
      state: "verified",
      toPreset: "spectra",
    });
    expect(truth.cloud).toMatchObject({
      state: "current",
      payloadRef: String(fixture.basePayloadId),
      contentHash: baseHash,
    });
    expect(truth.local).toMatchObject({
      state: "unavailable",
      unavailableReason: "unlinked-by-user",
    });
  });

  it("completes Keep in Spectra from disk-only bytes after Bridge uploads them", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "device",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.basePayloadId, { state: "released" });
    });
    const transition = await asUser.mutation(
      api.replicas.transitionStorageStrategy,
      {
        workId: fixture.workId,
        toPreset: "spectra",
      },
    );
    expect(transition.state).toBe("pending");
    const claimed = await t.mutation(api.bridgeSync.claimPendingPayloadUpload, {
      credential: bridgeCredential,
    });
    expect(claimed.request).toMatchObject({
      replicaId: fixture.localId,
      relativePath: "Truth.docx",
    });
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["base"])),
    );
    await t.mutation(api.bridgeSync.commitPayloadUpload, {
      credential: bridgeCredential,
      replicaId: fixture.localId,
      hash: baseHash,
      bytes: 4,
      mediaType: "application/test",
      storageId,
    });
    const truth = await t.run(async (ctx) => ({
      transition: await ctx.db.get(transition.transitionId),
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.transition).toMatchObject({
      state: "verified",
      toPreset: "spectra",
    });
    expect(truth.cloud).toMatchObject({
      state: "current",
      contentHash: baseHash,
    });
    expect(truth.cloud?.payloadRef).toBeTruthy();
    expect(truth.local).toMatchObject({
      state: "unavailable",
      unavailableReason: "unlinked-by-user",
    });
  });

  it("claims a Keep in Spectra upload when the cloud payload hash does not match disk", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "device",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.basePayloadId, { state: "released" });
      await ctx.db.patch(fixture.cloudId, {
        payloadRef: String(fixture.nextPayloadId),
        contentHash: undefined,
        state: "unavailable",
        unavailableReason: "metadata-only",
      });
    });
    const transition = await asUser.mutation(
      api.replicas.transitionStorageStrategy,
      {
        workId: fixture.workId,
        toPreset: "spectra",
      },
    );
    expect(transition.state).toBe("pending");
    const claimed = await t.mutation(api.bridgeSync.claimPendingPayloadUpload, {
      credential: bridgeCredential,
    });
    expect(claimed.request).toMatchObject({
      replicaId: fixture.localId,
      relativePath: "Truth.docx",
    });
  });

  it("gives Library the full replica set so a This-PC file is not Unavailable", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "device",
    });
    const rows = await asUser.query(api.replicas.presentationsForAccount, {});
    const row = rows.find((candidate) => candidate.workId === fixture.workId);
    expect(row?.replicas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "local", state: "current" }),
        expect.objectContaining({ kind: "cloud", state: "unavailable" }),
      ]),
    );
    expect(
      row?.replicas.some(
        (replica) => replica.kind === "local" && replica.state === "current",
      ),
    ).toBe(true);
  });

  it("sweeps a stalled pending storage transition so the radios can exit", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const stalledAt = Date.now() - 3 * 60_000;
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.cloudId, {
        payloadRef: undefined,
        contentHash: undefined,
        state: "unavailable",
        unavailableReason: "metadata-only",
      });
    });
    const transitionId = await t.run(async (ctx) =>
      ctx.db.insert("storageStrategyTransitions", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        idempotencyKey: "strategy_stall_test",
        fromPreset: "both",
        toPreset: "spectra",
        state: "pending",
        before: { hadItemPolicy: false, preset: "both" },
        createdAt: stalledAt,
        updatedAt: stalledAt,
      }),
    );
    const result = await t.mutation(internal.replicas.sweepReplicaTruth, {});
    expect(result.failedTransitions).toBe(1);
    const transition = await t.run(async (ctx) => ctx.db.get(transitionId));
    expect(transition).toMatchObject({
      state: "failed",
      errorCode: "strategy-transition-failed",
    });
  });

  it("makes linked storage metadata-only without losing the verified local revision", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);

    const transition = await asUser.mutation(
      api.replicas.transitionStorageStrategy,
      {
        workId: fixture.workId,
        toPreset: "linked",
      },
    );
    expect(transition.state).toBe("verified");
    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.cloud).toMatchObject({
      state: "unavailable",
      unavailableReason: "metadata-only",
    });
    expect(truth.cloud?.payloadRef).toBeUndefined();
    expect(truth.local).toMatchObject({
      state: "current",
      contentHash: baseHash,
      protectedOriginal: true,
    });
    expect(truth.local?.payloadRef).toBeUndefined();
  });

  it("rolls a storage strategy back when Bridge read-back disagrees", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => ctx.db.delete(fixture.localId));
    const asUser = t.withIdentity(identity);
    const transition = await asUser.mutation(
      api.replicas.transitionStorageStrategy,
      {
        workId: fixture.workId,
        toPreset: "device",
        mountId: fixture.mountId,
        relativePath: "Truth.docx",
      },
    );

    const completed = await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: transition.materializationRequestId!,
      outcome: "verified",
      actualRevision: nextHash,
    });
    expect(completed.state).toBe("failed");
    const [truth, policy] = await Promise.all([
      t.run(async (ctx) => ({
        transition: await ctx.db.get(transition.transitionId),
        cloud: await ctx.db.get(fixture.cloudId),
      })),
      asUser.query(api.syncPolicy.effective, {
        itemId: String(fixture.workId),
      }),
    ]);
    expect(truth.transition).toMatchObject({
      state: "failed",
      errorCode: "readback-revision-mismatch",
    });
    expect(truth.cloud).toMatchObject({
      state: "current",
      payloadRef: String(fixture.basePayloadId),
    });
    if (!policy) throw new Error("expected an effective sync policy");
    expect(policy.preset).toBe("spectra");
  });

  it("parks a locked write outside the eligible claim window", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const claimed = await t.mutation(api.bridgeSync.claimWrite, {
      credential: bridgeCredential,
    });
    const requestId = requireWriteRequestId(queued.requestId);
    expect(claimed.request?.requestId).toBe(requestId);
    await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId,
      outcome: "waiting",
      errorCode: "office-locked",
      errorMessage: "Waiting for Office",
      claimGeneration: claimed.request?.claimGeneration,
      claimToken: claimed.request?.claimToken,
    });

    const immediate = await t.mutation(api.bridgeSync.claimWrite, {
      credential: bridgeCredential,
    });
    expect(immediate.request).toBeNull();
    const request = await t.run(async (ctx) => ctx.db.get(requestId));
    expect(request).toMatchObject({
      state: "pending",
      errorCode: "office-locked",
    });
    expect(request?.retryAt).toBeGreaterThan(Date.now());
  });

  it("reconciles legacy labels from retained payload hashes", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        contentHash: nextHash,
        revision: "legacy-current",
        state: "current",
      });
    });

    const result = await t.mutation(
      internal.replicas.reconcileReplicaTruthMigration,
      {},
    );
    expect(result.state).toBe("complete");
    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      conflicts: await ctx.db.query("syncConflicts").collect(),
    }));
    expect(truth.cloud).toMatchObject({
      state: "diverged",
      revision: baseHash,
    });
    expect(truth.local).toMatchObject({
      state: "diverged",
      revision: nextHash,
    });
    expect(truth.conflicts).toHaveLength(1);
    expect(truth.conflicts[0]).toMatchObject({
      state: "open",
      localPayloadRef: String(fixture.nextPayloadId),
      spectraPayloadRef: String(fixture.basePayloadId),
    });
  });

  it("migrates a local-only full-cloud work to ahead, never false current", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => ctx.db.delete(fixture.cloudId));

    await t.mutation(internal.replicas.reconcileReplicaTruthMigration, {});
    const local = await t.run(async (ctx) => ctx.db.get(fixture.localId));
    expect(local).toMatchObject({
      state: "ahead",
      revision: baseHash,
      contentHash: baseHash,
    });
  });

  it("keeps both byte versions by moving the local identity to a real fork", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        contentHash: nextHash,
        revision: nextHash,
        state: "diverged",
        updatedAt: now,
      });
      await ctx.db.patch(fixture.cloudId, {
        state: "diverged",
        updatedAt: now,
      });
      await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        localPayloadRef: String(fixture.nextPayloadId),
        spectraPayloadRef: String(fixture.basePayloadId),
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t
      .withIdentity(identity)
      .mutation(api.replicas.resolveExternalConflict, {
        workId: fixture.workId,
        resolution: "keep-both",
      });
    expect(result.resolved).toBe(1);
    expect(result.workId).not.toBeNull();
    const truth = await t.run(async (ctx) => {
      const forkId = result.workId as Id<"spectraArtifacts">;
      return {
        fork: await ctx.db.get(forkId),
        local: await ctx.db.get(fixture.localId),
        forkCloud: await ctx.db
          .query("workReplicas")
          .withIndex("by_work_kind", (q) =>
            q.eq("workId", forkId).eq("kind", "cloud"),
          )
          .unique(),
        originalCloud: await ctx.db.get(fixture.cloudId),
        conflict: (await ctx.db.query("syncConflicts").collect())[0],
      };
    });
    expect(truth.fork).toMatchObject({
      resourceClass: "resource",
      contentHash: nextHash,
    });
    expect(truth.local).toMatchObject({
      workId: result.workId,
      payloadRef: String(fixture.nextPayloadId),
      state: "current",
    });
    expect(truth.forkCloud).toMatchObject({
      payloadRef: String(fixture.nextPayloadId),
      state: "current",
    });
    expect(truth.originalCloud).toMatchObject({
      payloadRef: String(fixture.basePayloadId),
      state: "current",
    });
    expect(truth.conflict).toMatchObject({
      state: "forked",
      forkedWorkId: result.workId,
    });
  });

  it("refuses legacy conflict resolution outside the durable reconciliation commit", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const conflicts = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        revision: nextHash,
        contentHash: nextHash,
        state: "ahead",
        updatedAt: now,
      });
      await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "external-next",
        direction: "external",
        revisionBefore: baseHash,
        revisionAfter: nextHash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: now,
        updatedAt: now,
      });
      const relevant = await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        localPayloadRef: String(fixture.nextPayloadId),
        spectraPayloadRef: String(fixture.basePayloadId),
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
      const unrelated = await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["header"],
        partNames: ["word/header1.xml"],
        localRevision: "c".repeat(64),
        spectraRevision: baseHash,
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
      return { relevant, unrelated };
    });

    const result = t
      .withIdentity(identity)
      .mutation(api.replicas.recordExternalReconciliation, {
        workId: fixture.workId,
        localReplicaId: fixture.localId,
        localPayloadRef: String(fixture.nextPayloadId),
        localRevision: nextHash,
        content: { blocks: [{ id: "body", text: "external" }] },
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        conflictRegionIds: [],
        resolution: "local",
      });
    // Applying and resolving now happen only in the durable Yjs/history
    // transaction (nativeReconciliation.commit, covered in
    // s11-native-history-boundaries). The legacy public path must not resolve.
    await expect(result).rejects.toThrow("EXTERNAL_DURABLE_COMMIT_REQUIRED");
    const truth = await t.run(async (ctx) => ({
      relevant: await ctx.db.get(conflicts.relevant),
      unrelated: await ctx.db.get(conflicts.unrelated),
      cloud: await ctx.db.get(fixture.cloudId),
    }));
    expect(truth.relevant).toMatchObject({ state: "open" });
    expect(truth.unrelated).toMatchObject({ state: "open" });
    expect(truth.cloud).toMatchObject({ revision: baseHash, payloadRef: String(fixture.basePayloadId) });
  });

  it("keeps overlapping Keep Office conflicts open without the durable reconciliation commit", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const conflictId = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        revision: nextHash,
        contentHash: nextHash,
        state: "ahead",
        updatedAt: now,
      });
      await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "external-overlap",
        direction: "external",
        revisionBefore: baseHash,
        revisionAfter: nextHash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["pptx:slide:/ppt/slides/slide1.xml", "pptx:slide:/ppt/slides/slide31.xml"],
        partNames: ["ppt/slides/slide1.xml", "ppt/slides/slide31.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        localPayloadRef: String(fixture.nextPayloadId),
        spectraPayloadRef: String(fixture.basePayloadId),
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = t
      .withIdentity(identity)
      .mutation(api.replicas.recordExternalReconciliation, {
        workId: fixture.workId,
        localReplicaId: fixture.localId,
        localPayloadRef: String(fixture.nextPayloadId),
        localRevision: nextHash,
        content: { slides: [{ id: "slide-1", speakerNotes: "native" }] },
        fidelityMap: { entries: [] },
        regionIds: ["pptx:slide:/ppt/slides/slide1.xml"],
        partNames: ["ppt/notesSlides/notesSlide1.xml"],
        conflictRegionIds: [],
        resolution: "local",
      });
    // Keep Office resolution is part of the durable reconciliation commit.
    await expect(result).rejects.toThrow("EXTERNAL_DURABLE_COMMIT_REQUIRED");
    const truth = await t.run(async (ctx) => ctx.db.get(conflictId));
    expect(truth).toMatchObject({ state: "open" });
  });

  it("persists precise conflict previews for reload", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        revision: nextHash,
        contentHash: nextHash,
        state: "ahead",
        updatedAt: now,
      });
      await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "external-preview",
        direction: "external",
        revisionBefore: baseHash,
        revisionAfter: nextHash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: now,
        updatedAt: now,
      });
    });
    const previews = [
      {
        regionId: "body",
        spectra: "Spectra version",
        external: "Word version",
      },
    ];
    await t
      .withIdentity(identity)
      .mutation(api.replicas.recordExternalReconciliation, {
        workId: fixture.workId,
        localReplicaId: fixture.localId,
        localPayloadRef: String(fixture.nextPayloadId),
        localRevision: nextHash,
        content: { blocks: [{ id: "body", text: "Spectra version" }] },
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        conflictRegionIds: ["body"],
        previews,
      });
    const truth = await t.withIdentity(identity).query(api.replicas.forWork, {
      workId: fixture.workId,
    });
    assert(truth, "Authorized work must have replica metadata");
    expect(truth.conflicts[0]?.previews).toEqual(previews);
  });

  it("does not blob-conflict a Word save against an unverified Spectra write", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const wordHash = payloadHash("word");
    const wordPayloadId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["word"]));
      return ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: wordHash,
        storageId,
        bytes: 4,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: Date.now(),
        verifiedAt: Date.now(),
      });
    });
    await t.mutation(api.bridgeSync.commitPayloadUpload, {
      credential: bridgeCredential,
      replicaId: fixture.localId,
      hash: wordHash,
      bytes: 4,
      mediaType: "application/test",
      payloadRef: String(wordPayloadId),
    });
    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      conflicts: await ctx.db.query("syncConflicts").collect(),
      requests: await ctx.db.query("bridgeWriteRequests").collect(),
    }));
    expect(truth.cloud).toMatchObject({
      revision: baseHash,
      contentHash: baseHash,
    });
    expect(truth.local).toMatchObject({
      revision: wordHash,
      contentHash: wordHash,
    });
    expect(truth.conflicts).toEqual([]);
    expect(
      truth.requests.some(
        (request) =>
          request.state === "failed" &&
          request.errorCode === "external-save-during-write",
      ),
    ).toBe(true);
  });

  it("supersedes an in-flight write when the disk revision moved", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const first = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const wordHash = "d".repeat(64);
    const keepHash = "e".repeat(64);
    const payloads = await t.run(async (ctx) => {
      const now = Date.now();
      const wordStorage = await ctx.storage.store(new Blob(["word"]));
      const keepStorage = await ctx.storage.store(new Blob(["keep"]));
      const wordPayloadId = await ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: wordHash,
        storageId: wordStorage,
        bytes: 4,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: now,
        verifiedAt: now,
      });
      const keepPayloadId = await ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: keepHash,
        storageId: keepStorage,
        bytes: 4,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: now,
        verifiedAt: now,
      });
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(wordPayloadId),
        revision: wordHash,
        contentHash: wordHash,
        updatedAt: now,
      });
      return { keepPayloadId };
    });
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(payloads.keepPayloadId),
      contentHash: keepHash,
      baseRevision: wordHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      projectionContent: { blocks: [{ id: "body", text: "LOOPHOLD-27" }] },
      projectionContentHash: keepHash,
    });
    const truth = await t.run(async (ctx) => ({
      first: await ctx.db.get(requireWriteRequestId(first.requestId)),
      next: await ctx.db.get(requireWriteRequestId(queued.requestId)),
      local: await ctx.db.get(fixture.localId),
      work: await ctx.db.get(fixture.workId),
    }));
    expect(truth.first).toMatchObject({
      state: "failed",
      errorCode: "external-save-during-write",
    });
    expect(queued.state).toBe("pending");
    expect(truth.local).toMatchObject({ state: "pending", revision: wordHash });
    expect(truth.work?.content).toEqual({
      blocks: [{ id: "body", text: "LOOPHOLD-27" }],
    });
  });

  async function seedKeepSpectraConflict(
    t: ReturnType<typeof convexTest>,
    fixture: Awaited<ReturnType<typeof seedWork>>,
  ) {
    const keepHash = "c".repeat(64);
    const keepPayloadId = await t.run(async (ctx) => {
      const now = Date.now();
      const storageId = await ctx.storage.store(new Blob(["keep"]));
      const payloadId = await ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: keepHash,
        storageId,
        bytes: 4,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: now,
        verifiedAt: now,
      });
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        revision: nextHash,
        contentHash: nextHash,
        state: "diverged",
        updatedAt: now,
      });
      await ctx.db.patch(fixture.cloudId, {
        state: "diverged",
        updatedAt: now,
      });
      await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["body", "heading-quality", "heading-resiliency"],
        partNames: ["word/document.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        localPayloadRef: String(fixture.nextPayloadId),
        spectraPayloadRef: String(fixture.basePayloadId),
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
      return payloadId;
    });
    return { keepHash, keepPayloadId };
  }

  it("refuses a desktop write that was not built on the unread Word save", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const seeded = await seedKeepSpectraConflict(t, fixture);
    await expect(queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(seeded.keepPayloadId),
      contentHash: seeded.keepHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    })).rejects.toThrow("MATERIALIZATION_BASE_STALE");
  });

  it("binds Keep Spectra to the queued write even when open conflict regions are a unioned superset", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const seeded = await seedKeepSpectraConflict(t, fixture);
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(seeded.keepPayloadId),
      contentHash: seeded.keepHash,
      baseRevision: nextHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const resolved = await asUser.mutation(
      api.replicas.resolveExternalConflict,
      {
        workId: fixture.workId,
        resolution: "spectra",
        requestId: requireWriteRequestId(queued.requestId),
      },
    );
    expect(resolved.requestId).toBe(queued.requestId);
    const conflict = await t.run(
      async (ctx) => (await ctx.db.query("syncConflicts").collect())[0],
    );
    expect(conflict).toMatchObject({
      state: "resolving-spectra",
      resolutionRequestId: queued.requestId,
    });
  });

  it("still binds Keep Spectra when the write overlaps any open conflict region", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const seeded = await seedKeepSpectraConflict(t, fixture);
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(seeded.keepPayloadId),
      contentHash: seeded.keepHash,
      baseRevision: nextHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    await expect(
      asUser.mutation(api.replicas.resolveExternalConflict, {
        workId: fixture.workId,
        resolution: "spectra",
      }),
    ).resolves.toMatchObject({ requestId: queued.requestId });
  });

  it("refuses Keep Spectra when no pending write exists", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        revision: nextHash,
        contentHash: nextHash,
        state: "diverged",
        updatedAt: now,
      });
      await ctx.db.patch(fixture.cloudId, {
        state: "diverged",
        updatedAt: now,
      });
      await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        localPayloadRef: String(fixture.nextPayloadId),
        spectraPayloadRef: String(fixture.basePayloadId),
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
    });
    await expect(
      t.withIdentity(identity).mutation(api.replicas.resolveExternalConflict, {
        workId: fixture.workId,
        resolution: "spectra",
      }),
    ).rejects.toThrow(/CONFLICT_RESOLUTION_WRITE_REQUIRED/);
  });

  it("resolves Keep Spectra when the active local copy and cloud agree", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.localId, {
        payloadRef: undefined,
        contentHash: undefined,
        state: "current",
        updatedAt: now,
      });
      const missingReplicaId = await ctx.db.insert("workReplicas", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        kind: "local",
        deviceId: fixture.deviceId,
        mountId: fixture.mountId,
        localResourceId: "missing-copy",
        relativePath: "missing.docx",
        nativeFormat: "docx",
        revision: nextHash,
        state: "unavailable",
        unavailableReason: "missing-on-disk",
        errorCode: "externally-deleted",
        updatedAt: now,
      });
      const matchingReplicaId = await ctx.db.insert("workReplicas", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        kind: "local",
        deviceId: fixture.deviceId,
        mountId: fixture.mountId,
        localResourceId: "verified-copy",
        relativePath: "verified-copy.docx",
        nativeFormat: "docx",
        payloadRef: String(fixture.basePayloadId),
        revision: baseHash,
        baseRevision: baseHash,
        contentHash: baseHash,
        state: "current",
        lastVerifiedAt: now,
        updatedAt: now,
      });
      const externalOperationId = await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: matchingReplicaId,
        idempotencyKey: "external-save-reconciled-with-cloud",
        direction: "external",
        revisionBefore: baseHash,
        revisionAfter: baseHash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [missingReplicaId, fixture.cloudId],
        regionIds: ["body", "heading-quality"],
        partNames: ["word/document.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        localPayloadRef: undefined,
        spectraPayloadRef: String(fixture.basePayloadId),
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
      return { externalOperationId };
    });
    const resolved = await t
      .withIdentity(identity)
      .mutation(api.replicas.resolveExternalConflict, {
        workId: fixture.workId,
        resolution: "spectra",
      });
    expect(resolved.resolved).toBe(1);
    const truth = await t.run(async (ctx) => ({
      conflict: (await ctx.db.query("syncConflicts").collect())[0],
      externalOperation: await ctx.db.get(seeded.externalOperationId),
    }));
    expect(truth.conflict).toMatchObject({ state: "resolved-spectra" });
    expect(truth.externalOperation).toMatchObject({ state: "verified" });
  });

  it("leaves work content unchanged while a verified-first materialization is pending", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      projectionContent: { blocks: [{ id: "body", text: "P5V1-NATIVE-AI-2301" }] },
      projectionContentHash: nextHash,
      promotionMode: "verified-first",
    });
    const truth = await t.run(async (ctx) => ({
      work: await ctx.db.get(fixture.workId),
      request: await ctx.db.get(requireWriteRequestId(queued.requestId)),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(queued.state).toBe("pending");
    expect(truth.work?.content).toEqual({ blocks: [] });
    expect(truth.request).toMatchObject({
      state: "pending",
      projectionBaseContent: { blocks: [{ id: "body", text: "P5V1-NATIVE-AI-2301" }] },
    });
    expect(truth.local?.state).toBe("pending");
  });

  it("projects an immediately accepted native edit while Bridge sync is pending", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const projection = {
      blocks: [{ id: "body", text: "Spectra owns the accepted revision" }],
    };
    const queued = await queueNative(t.withIdentity(identity), {
        workId: fixture.workId,
        payloadRef: String(fixture.nextPayloadId),
        contentHash: nextHash,
        baseRevision: baseHash,
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        projectionContent: projection,
        projectionContentHash: nextHash,
        promotionMode: "immediate-projection",
      });
    const truth = await t.run(async (ctx) => ({
      work: await ctx.db.get(fixture.workId),
      request: await ctx.db.get(requireWriteRequestId(queued.requestId)),
      local: await ctx.db.get(fixture.localId),
      cloud: await ctx.db.get(fixture.cloudId),
    }));

    expect(queued.state).toBe("pending");
    expect(truth.work?.content).toEqual(projection);
    expect(truth.request).toMatchObject({
      state: "pending",
      projectionBaseContent: projection,
      projectionBaseContentHash: nextHash,
    });
    expect(truth.local?.state).toBe("pending");
    expect(truth.cloud?.revision).toBe(baseHash);
  });

  it("coalesces a newer Spectra edit over an unclaimed Office-locked write", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const thirdHash = "c".repeat(64);
    const thirdPayloadId = await t.run(async (ctx) => {
      const now = Date.now();
      const storageId = await ctx.storage.store(new Blob(["third"]));
      return ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: thirdHash,
        storageId,
        bytes: 5,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: now,
        verifiedAt: now,
      });
    });
    const first = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      projectionContent: { blocks: [{ id: "body", text: "first edit" }] },
      projectionContentHash: nextHash,
      promotionMode: "immediate-projection",
    });
    const firstRequestId = requireWriteRequestId(first.requestId);
    await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: firstRequestId,
      outcome: "waiting",
      errorCode: "office-locked",
    });

    const latestProjection = {
      blocks: [{ id: "body", text: "first edit plus second edit" }],
    };
    const second = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(thirdPayloadId),
      contentHash: thirdHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      projectionContent: latestProjection,
      projectionContentHash: thirdHash,
      promotionMode: "immediate-projection",
    });
    const truth = await t.run(async (ctx) => ({
      work: await ctx.db.get(fixture.workId),
      first: await ctx.db.get(firstRequestId),
      firstOperation: (await ctx.db.query("syncOperations").collect()).find(
        (operation) => operation.revisionAfter === nextHash,
      ),
      second: await ctx.db.get(requireWriteRequestId(second.requestId)),
      local: await ctx.db.get(fixture.localId),
    }));

    expect(second.requestId).not.toBe(first.requestId);
    expect(truth.work?.content).toEqual(latestProjection);
    expect(truth.first).toMatchObject({
      state: "failed",
      errorCode: "superseded-by-newer-cloud-revision",
    });
    expect(truth.firstOperation).toMatchObject({
      state: "failed",
      errorCode: "superseded-by-newer-cloud-revision",
    });
    expect(truth.second).toMatchObject({
      state: "pending",
      baseRevision: baseHash,
      targetRevision: thirdHash,
      projectionBaseContent: latestProjection,
    });
    expect(truth.local?.state).toBe("pending");
  });

  it("advances replica byte and projection bases on verified-first without rewriting work content", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const externalOperationId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "external-save-awaiting-convergence",
        direction: "external",
        revisionBefore: baseHash,
        revisionAfter: nextHash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: now,
        updatedAt: now,
      });
    });
    const asUser = t.withIdentity(identity);
    const projection = { blocks: [{ id: "body", text: "P5V1-NATIVE-AI-2301" }] };
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      projectionContent: projection,
      projectionContentHash: nextHash,
      promotionMode: "verified-first",
    });
    await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: requireWriteRequestId(queued.requestId),
      outcome: "verified",
      actualRevision: nextHash,
    });
    const truth = await t.run(async (ctx) => ({
      work: await ctx.db.get(fixture.workId),
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      request: await ctx.db.get(requireWriteRequestId(queued.requestId)),
      externalOperation: await ctx.db.get(externalOperationId),
    }));
    expect(truth.work?.content).toEqual({ blocks: [] });
    expect(truth.request?.state).toBe("verified");
    expect(truth.local).toMatchObject({
      revision: nextHash,
      projectionBaseContent: projection,
      state: "current",
    });
    expect(truth.cloud).toMatchObject({
      projectionBaseContent: projection,
      projectionBaseRevision: nextHash,
    });
    expect(truth.externalOperation).toMatchObject({ state: "verified" });
  });

  it("reports authorized materialization status and hides requests from strangers", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      promotionMode: "verified-first",
    });
    const requestId = requireWriteRequestId(queued.requestId);
    const status = await asUser.query(api.replicas.materializationStatus, {
      requestId,
    });
    expect(status).toMatchObject({
      requestId,
      state: "pending",
      retryAt: expect.any(Number),
    });
    const strangerIdentity = {
      subject: "clerk_materialization_stranger",
      email: "materialization-stranger@example.test",
      emailVerified: true,
    };
    await t.run(async (ctx) => {
      const now = Date.now();
      const strangerAccountId = await ctx.db.insert("accounts", {
        clerkId: strangerIdentity.subject,
        email: strangerIdentity.email,
        emailVerified: true,
        name: "Stranger",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId: strangerAccountId,
        schoolId: fixture.schoolId,
        role: "student",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    });
    await expect(
      t.withIdentity(strangerIdentity).query(api.replicas.materializationStatus, {
        requestId,
      }),
    ).rejects.toThrow(/WRITE_REQUEST_NOT_FOUND/);
  });

  it("cancels pending verified-first writes without overwriting a newer projection", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      projectionContent: { blocks: [{ id: "body", text: "AI phantom" }] },
      projectionContentHash: nextHash,
      promotionMode: "verified-first",
    });
    const requestId = requireWriteRequestId(queued.requestId);
    const newer = { blocks: [{ id: "body", text: "human later" }] };
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.workId, { content: newer, updatedAt: Date.now() });
    });
    const cancelled = await asUser.mutation(api.replicas.cancelMaterialization, {
      requestId,
    });
    expect(cancelled).toMatchObject({ cancelled: true, state: "failed" });
    const truth = await t.run(async (ctx) => ({
      work: await ctx.db.get(fixture.workId),
      request: await ctx.db.get(requestId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.work?.content).toEqual(newer);
    expect(truth.request).toMatchObject({
      state: "failed",
      errorCode: "cancelled-before-claim",
    });
    expect(truth.local).toMatchObject({ state: "current" });
    await t.run(async (ctx) => {
      await ctx.db.patch(requestId, {
        state: "claimed",
        claimedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const refused = await asUser.mutation(api.replicas.cancelMaterialization, {
      requestId,
    });
    expect(refused).toMatchObject({
      cancelled: false,
      state: "claimed",
      mustConverge: true,
    });
  });

  it("fences late A acknowledgements after B has verified on the same replica", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const thirdHash = "c".repeat(64);
    const thirdPayloadId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["third"]));
      return ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: thirdHash,
        storageId,
        bytes: 5,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: Date.now(),
        verifiedAt: Date.now(),
      });
    });
    const first = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const firstRequestId = requireWriteRequestId(first.requestId);
    const firstClaim = await t.mutation(api.bridgeSync.claimWrite, {
      credential: bridgeCredential,
    });
    if (!firstClaim.request) throw new Error("expected A to be claimable");
    await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: firstRequestId,
      outcome: "verified",
      actualRevision: nextHash,
      claimGeneration: firstClaim.request.claimGeneration,
      claimToken: firstClaim.request.claimToken,
    });

    const second = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(thirdPayloadId),
      contentHash: thirdHash,
      baseRevision: nextHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const secondRequestId = requireWriteRequestId(second.requestId);
    const secondClaim = await t.mutation(api.bridgeSync.claimWrite, {
      credential: bridgeCredential,
    });
    if (!secondClaim.request) throw new Error("expected B to be claimable");
    await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: secondRequestId,
      outcome: "verified",
      actualRevision: thirdHash,
      claimGeneration: secondClaim.request.claimGeneration,
      claimToken: secondClaim.request.claimToken,
    });

    const beforeLateAcks = await t.run(async (ctx) => ({
      request: await ctx.db.get(secondRequestId),
      local: await ctx.db.get(fixture.localId),
      cloud: await ctx.db.get(fixture.cloudId),
    }));
    for (const outcome of ["waiting", "failed", "verified"] as const) {
      const late = await t.mutation(api.bridgeSync.completeWrite, {
        credential: bridgeCredential,
        requestId: firstRequestId,
        outcome,
        actualRevision: outcome === "verified" ? nextHash : undefined,
        claimGeneration: firstClaim.request.claimGeneration,
        claimToken: firstClaim.request.claimToken,
        errorCode: outcome === "waiting" ? "office-locked" : undefined,
      });
      expect(late.state).toBe("verified");
    }
    const afterLateAcks = await t.run(async (ctx) => ({
      request: await ctx.db.get(secondRequestId),
      local: await ctx.db.get(fixture.localId),
      cloud: await ctx.db.get(fixture.cloudId),
    }));
    expect(afterLateAcks.request).toMatchObject({ state: "verified", targetRevision: thirdHash });
    expect(afterLateAcks.local).toMatchObject({ state: "current", revision: thirdHash, contentHash: thirdHash });
    expect(afterLateAcks.cloud).toMatchObject({ state: "current", revision: thirdHash, contentHash: thirdHash });
    expect(afterLateAcks).toEqual(beforeLateAcks);
  });

  it("ignores an acknowledgement from a reclaimed claim generation", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const requestId = requireWriteRequestId(queued.requestId);
    const firstClaim = await t.mutation(api.bridgeSync.claimWrite, {
      credential: bridgeCredential,
    });
    if (!firstClaim.request) throw new Error("expected first claim");
    await t.run(async (ctx) => {
      await ctx.db.patch(requestId, {
        claimedAt: Date.now() - BRIDGE_CLAIM_REDRIVE_MS - 1,
        updatedAt: Date.now() - BRIDGE_CLAIM_REDRIVE_MS - 1,
      });
    });
    const secondClaim = await t.mutation(api.bridgeSync.claimWrite, {
      credential: bridgeCredential,
    });
    if (!secondClaim.request) throw new Error("expected reclaimed claim");
    const before = await t.run(async (ctx) => ({
      request: await ctx.db.get(requestId),
      local: await ctx.db.get(fixture.localId),
      cloud: await ctx.db.get(fixture.cloudId),
    }));
    const stale = await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId,
      outcome: "verified",
      actualRevision: nextHash,
      claimGeneration: firstClaim.request.claimGeneration,
      claimToken: firstClaim.request.claimToken,
    });
    expect(stale).toMatchObject({ state: "pending", ignored: true, reason: "stale-claim" });
    const after = await t.run(async (ctx) => ({
      request: await ctx.db.get(requestId),
      local: await ctx.db.get(fixture.localId),
      cloud: await ctx.db.get(fixture.cloudId),
    }));
    expect(after).toEqual(before);
    expect(after.request).toMatchObject({
      state: "claimed",
      claimGeneration: secondClaim.request.claimGeneration,
      claimToken: secondClaim.request.claimToken,
    });
    await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId,
      outcome: "verified",
      actualRevision: nextHash,
      claimGeneration: secondClaim.request.claimGeneration,
      claimToken: secondClaim.request.claimToken,
    });
    const completed = await t.run(async (ctx) => ctx.db.get(requestId));
    expect(completed).toMatchObject({ state: "verified", claimGeneration: secondClaim.request.claimGeneration });
  });
});
