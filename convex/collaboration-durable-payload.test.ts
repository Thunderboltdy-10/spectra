/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { validateDurablePayload } from "./collaborationDurablePayload";
import { reconcileDurablePayloadOwners } from "./durablePayloadOwnership";
import { PAYLOAD_RELEASE_GRACE_MS } from "../shared/replica-truth";

const modules = import.meta.glob("./**/*.ts");
async function fixture() {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType","orgNodeCountByWorkspace","orgNodeCountByParent"]) aggregateTest.register(t,name);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Durable", slug: "durable", verifiedDomains: [], status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: "durable", email: "durable@example.test", emailVerified: true, name: "Durable", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "document", title: "Durable", content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now });
    const roomId = await ctx.db.insert("collaborationRooms", { artifactId, schoolId, typeKey: "document", provider: "self_hosted_yjs", partitionKey: "root", schemaVersion: 2, policyVersion: 0, status: "active", nextSequence: 1, snapshotSequence: 0, uncompactedBytes: 0, createdAt: now, updatedAt: now });
    return { artifactId, accountId, roomId };
  });
  const body = JSON.stringify({ content: { blocks: [{ id: "a", text: "界".repeat(600_000) }] } });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob([body])));
  const input = { ...ids, storageId, kind: "projection" as const, digest: createHash("sha256").update(body).digest("hex"), byteLength: Buffer.byteLength(body), mediaType: "application/json", manifestVersion: 1, partitionKey: "root", policyVersion: 0 };
  const { roomId: _room, ...put } = input;
  return { t, ids, put };
}

describe("durable payload adoption", () => {
  it("adopts a complete multibyte payload using only a bounded manifest", async () => {
    const { t, put } = await fixture();
    expect(Buffer.byteLength(JSON.stringify(put))).toBeLessThan(1024);
    const result = await t.mutation(internal.collaborationDurablePayload.put, put);
    const row = await t.run(ctx => validateDurablePayload(ctx, { ...put, payloadRef: result.payloadRef }));
    expect(row.byteLength).toBeGreaterThan(1_000_000);
    expect((await t.mutation(internal.collaborationDurablePayload.put, put)).payloadRef).toBe(result.payloadRef);
  });

  it("rejects false digest, incomplete bytes and stale permission epochs", async () => {
    const { t, put, ids } = await fixture();
    await expect(t.mutation(internal.collaborationDurablePayload.put, { ...put, digest: "0".repeat(64) })).rejects.toThrow("MISMATCH");
    await expect(t.mutation(internal.collaborationDurablePayload.put, { ...put, byteLength: put.byteLength + 1 })).rejects.toThrow("MISMATCH");
    await t.run(ctx => ctx.db.patch(ids.roomId, { policyVersion: 1 }));
    await expect(t.mutation(internal.collaborationDurablePayload.put, put)).rejects.toThrow("FORBIDDEN");
  });

  it("rejects a payload from a different artifact or an old actor epoch at final adoption", async () => {
    const { t, put } = await fixture();
    const result = await t.mutation(internal.collaborationDurablePayload.put, put);
    await expect(t.run(ctx => validateDurablePayload(ctx, { ...put, payloadRef: result.payloadRef, policyVersion: 1 }))).rejects.toThrow("INVALID");
    await expect(t.run(ctx => validateDurablePayload(ctx, { ...put, payloadRef: result.payloadRef, kind: "yjs-update" }))).rejects.toThrow("INVALID");
  });

  it("retains snapshot and pending-operation owners until the final release", async () => {
    const { t, put } = await fixture();
    const { payloadRef } = await t.mutation(internal.collaborationDurablePayload.put, put);
    await t.run(async ctx => {
      const id = ctx.db.normalizeId("collaborationDurablePayloads", payloadRef)!;
      await ctx.db.patch(id, { createdAt: Date.now() - PAYLOAD_RELEASE_GRACE_MS - 1 });
      await reconcileDurablePayloadOwners(ctx, "artifactSnapshotObjects", "pinned-version", { payloadRef });
      await reconcileDurablePayloadOwners(ctx, "bridgeWriteRequests", "pending-write", { payloadRef });
    });
    expect(await t.mutation(internal.durablePayloadOwnership.release, { payloadRef })).toBe(false);
    await t.run(ctx => reconcileDurablePayloadOwners(ctx, "artifactSnapshotObjects", "pinned-version", null));
    expect(await t.mutation(internal.durablePayloadOwnership.release, { payloadRef })).toBe(false);
    await t.run(ctx => reconcileDurablePayloadOwners(ctx, "bridgeWriteRequests", "pending-write", null));
    expect(await t.mutation(internal.durablePayloadOwnership.release, { payloadRef })).toBe(true);
    expect(await t.mutation(internal.durablePayloadOwnership.release, { payloadRef })).toBe(false);
  });
});

describe("AI content reference writes", () => {
  async function stagedWorkbook() {
    const { t, ids } = await fixture();
    const actor = t.withIdentity({ subject: "durable", email: "durable@example.test", emailVerified: true });
    const runId = await t.run(async ctx => {
      const artifact = (await ctx.db.get(ids.artifactId))!;
      await ctx.db.patch(ids.artifactId, { blueprintKey: "sheets", summary: "Workbook with 200000 filled cells about Durable." });
      return ctx.db.insert("spectraAiRuns", {
        ownerAccountId: ids.accountId, schoolId: artifact.schoolId, sourceSurface: "artifact",
        status: "running", userPrompt: "Change the distant cell", executionId: "durable-ai",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    const body = JSON.stringify({ sheets: [{ id: "large", name: "Large", cells: {
      A1: { value: "界".repeat(100_000) }, P9996: { value: 919296 },
    } }] });
    const storageId = await t.run(ctx => ctx.storage.store(new Blob([body])));
    const digest = createHash("sha256").update(body).digest("hex");
    const adopted = await actor.mutation(internal.artifactContent.adopt, {
      artifactId: ids.artifactId, storageId, digest, byteLength: Buffer.byteLength(body), policyVersion: 0,
    });
    const content = { spectraContentRef: {
      version: 1 as const, artifactId: ids.artifactId, payloadRef: adopted.payloadRef,
      digest, byteLength: Buffer.byteLength(body), path: "value" as const, dependencies: adopted.dependencies,
    } };
    const args = { artifactId: ids.artifactId, runId, executionId: "durable-ai", content, commit: true };
    return { t, ids, actor, args };
  }

  it("commits a bounded reference and retains its body and preview without an empty-sheet substitution", async () => {
    const { t, actor, args } = await stagedWorkbook();
    expect(Buffer.byteLength(JSON.stringify(args))).toBeLessThan(1024);
    await actor.mutation(api.spectraArtifacts.stageAiPatch, args);
    const artifact = await t.run(ctx => ctx.db.get(args.artifactId));
    expect(artifact?.content).toEqual(args.content);
    expect(artifact?.aiPreview?.content).toEqual(args.content);
    expect(artifact?.summary).toBe("Workbook with 200000 filled cells about Durable.");
    const owners = await t.run(ctx => ctx.db.query("collaborationPayloadOwners")
      .withIndex("by_payload", q => q.eq("payloadRef", args.content.spectraContentRef.payloadRef)).collect());
    expect(owners).toEqual(expect.arrayContaining([expect.objectContaining({ ownerTable: "spectraArtifacts", ownerId: args.artifactId })]));
    await actor.mutation(api.spectraArtifacts.stageAiPatch, { ...args, summary: "Updated the distant cell." });
    expect((await t.run(ctx => ctx.db.get(args.artifactId)))?.summary).toBe("Updated the distant cell.");
  });

  it.each(["digest", "bytes", "malformed", "foreign artifact", "foreign actor", "stale epoch", "dependencies"])("rejects %s at commit without changing the artifact", async failure => {
    const { t, actor, args } = await stagedWorkbook();
    const content = structuredClone(args.content);
    if (failure === "digest") content.spectraContentRef.digest = "0".repeat(64);
    if (failure === "bytes") content.spectraContentRef.byteLength++;
    if (failure === "malformed") content.spectraContentRef.digest = "invalid";
    if (failure === "foreign artifact") content.spectraContentRef.artifactId = "foreign" as typeof args.artifactId;
    if (failure === "dependencies") content.spectraContentRef.dependencies = { assetIds: ["foreign"], nativePayloadHashes: [], nativePayloadRefs: [] };
    if (failure === "foreign actor" || failure === "stale epoch") await t.run(async ctx => {
      const id = ctx.db.normalizeId("collaborationDurablePayloads", content.spectraContentRef.payloadRef)!;
      if (failure === "stale epoch") await ctx.db.patch(id, { policyVersion: 1 });
      else {
        const other = await ctx.db.insert("accounts", { clerkId: "other", email: "other@example.test", emailVerified: true, name: "Other", status: "active", createdAt: Date.now(), updatedAt: Date.now() });
        await ctx.db.patch(id, { accountId: other });
      }
    });
    const before = await t.run(ctx => ctx.db.get(args.artifactId));
    await expect(actor.mutation(api.spectraArtifacts.stageAiPatch, { ...args, content })).rejects.toThrow(/INVALID/);
    expect(await t.run(ctx => ctx.db.get(args.artifactId))).toEqual(before);
  });

  it("preserves references in pending previews and refuses references on a new artifact", async () => {
    const { t, actor, args } = await stagedWorkbook();
    await t.run(ctx => ctx.db.patch(args.artifactId, { aiState: "creating", aiRunId: args.runId, aiExecutionId: args.executionId }));
    const { commit: _commit, ...pending } = args;
    await actor.mutation(api.spectraArtifacts.patchPendingContent, { ...pending, progress: 0.5 });
    expect((await t.run(ctx => ctx.db.get(args.artifactId)))?.aiPreview?.content).toEqual(args.content);
    await expect(actor.mutation(api.spectraArtifacts.create, { blueprintKey: "sheets", title: "Foreign copy", content: args.content })).rejects.toThrow("COLLABORATION_DURABLE_PAYLOAD_INVALID");
  });
});


it("keeps a pinned large body and native base through real deletion coordination, then releases both", async () => {
  const {t,ids} = await fixture();
  const actor = t.withIdentity({subject:"durable",email:"durable@example.test",emailVerified:true});
  const nativeBytes = new Uint8Array([80,75,3,4,5]);
  const nativeHash = createHash("sha256").update(nativeBytes).digest("hex");
  const nativeStorage = await t.run(ctx=>ctx.storage.store(new Blob([nativeBytes])));
  const nativeId = await t.run(async ctx=>{
    const id = await ctx.db.insert("payloadObjects",{accountId:ids.accountId,hash:nativeHash,storageId:nativeStorage,bytes:nativeBytes.length,mediaType:"application/octet-stream",refCount:1,state:"active",createdAt:Date.now(),verifiedAt:Date.now()});
    await ctx.db.insert("workReplicas",{accountId:ids.accountId,workId:ids.artifactId,kind:"cloud",payloadRef:String(id),nativeFormat:"docx",revision:nativeHash,contentHash:nativeHash,state:"current",updatedAt:Date.now()});
    return id;
  });
  const body=JSON.stringify({blocks:[{id:"p",text:"界".repeat(100_000)}],nativeBinding:{sourcePayloadHash:nativeHash}});
  const storageId=await t.run(ctx=>ctx.storage.store(new Blob([body])));
  const digest=createHash("sha256").update(body).digest("hex");
  const adopted=await actor.mutation(internal.artifactContent.adopt,{artifactId:ids.artifactId,storageId,digest,byteLength:Buffer.byteLength(body),policyVersion:0,dependencies:{assetIds:[],nativePayloadHashes:[nativeHash]}});
  const content={spectraContentRef:{version:1,artifactId:ids.artifactId,payloadRef:adopted.payloadRef,digest,byteLength:Buffer.byteLength(body),path:"value",dependencies:adopted.dependencies}};
  const containerId = await t.run(async ctx=>{
    const artifact=await ctx.db.get(ids.artifactId);
    await ctx.db.patch(ids.artifactId,{content});
    await reconcileDurablePayloadOwners(ctx,"spectraArtifacts",String(ids.artifactId),{content});
    return ctx.db.insert("spectraArtifacts",{ownerAccountId:ids.accountId,schoolId:artifact!.schoolId,blueprintKey:"document",title:"Pin owner",content:{},textIndex:"",tags:[],status:"active",createdAt:Date.now(),updatedAt:Date.now()});
  });
  const version = await actor.mutation(api.changeGroups.createNamedCheckpoint,{artifactId:ids.artifactId,name:"Retained large body"});
  const pinId=await t.run(async ctx=>{
    const artifact=await ctx.db.get(ids.artifactId);
    const embedId=await ctx.db.insert("artifactEmbeds",{containerType:"artifact",containerId:String(containerId),containerRegionId:"document:pin",sourceArtifactId:ids.artifactId,schoolId:artifact!.schoolId,mode:"compact",interaction:"read",versionPolicy:"pinned",pinnedVersionId:version.versionId,contextPolicy:"summary",createdByAccountId:ids.accountId,createdAt:Date.now(),updatedAt:Date.now()});
    // Retained-pin reads require the exact placement in the host's current content.
    await ctx.db.patch(containerId,{content:{tiptap:{type:"doc",content:[{type:"spectraReference",attrs:{embedId:String(embedId),containerType:"artifact",containerId:String(containerId),containerRegionId:"document:pin",sourceArtifactId:String(ids.artifactId),versionPolicy:"pinned",pinnedVersionId:String(version.versionId)}}]}}});
    return embedId;
  });
  const deletion=await actor.mutation(api.spectraArtifacts.permanentlyDelete,{artifactId:ids.artifactId});
  const drain=async(jobId: typeof deletion.jobId,generation=1)=>{
    for(let i=0;i<100;i++){
      const job=await t.run(ctx=>ctx.db.get(jobId));
      if(!job || job.phase==="complete" || job.phase==="retained") return;
      expect(job.phase).not.toBe("failed");
      await t.mutation(internal.spectraArtifactDeletion.process,{jobId,generation});
    }
    throw new Error("deletion did not drain");
  };
  await drain(deletion.jobId);
  expect(await t.run(ctx=>ctx.db.get(deletion.jobId))).toMatchObject({phase:"retained"});
  const payloadId=await t.run(async ctx=>ctx.db.normalizeId("collaborationDurablePayloads",adopted.payloadRef)!);
  expect(await actor.query(api.artifactContent.read,{artifactId:ids.artifactId,payloadRef:payloadId,digest})).toMatchObject({digest});
  expect(await actor.query(api.payloads.get,{workId:ids.artifactId,hash:nativeHash})).toMatchObject({hash:nativeHash});
  await t.run(async ctx=>{
    await ctx.db.patch(payloadId,{createdAt:Date.now()-PAYLOAD_RELEASE_GRACE_MS-1});
    await ctx.db.patch(containerId,{status:"deleted"});
  });
  await expect(actor.query(api.artifactContent.read,{artifactId:ids.artifactId,payloadRef:payloadId,digest})).rejects.toThrow();
  await t.run(ctx=>ctx.db.patch(containerId,{status:"active"}));
  await actor.mutation(api.artifactEmbeds.remove,{embedId:pinId});
  const jobs=await t.run(ctx=>ctx.db.query("artifactDeletionJobs").collect());
  for(const job of jobs) if(job.phase!=="complete") await drain(job._id,job.generation);
  expect(await t.run(ctx=>ctx.db.get(deletion.jobId))).toMatchObject({phase:"complete"});
  await t.run(async ctx=>{
    for (const object of await ctx.db.query("artifactSnapshotObjects").collect()) if (object.refCount===0) await ctx.db.patch(object._id,{lastReferencedAt:Date.now()-31*86_400_000});
  });
  await t.mutation(internal.artifactSnapshots.maintain,{});
  await t.mutation(internal.durablePayloadOwnership.release,{payloadRef:adopted.payloadRef});
  await t.mutation(internal.durablePayloadOwnership.release,{payloadRef:String(nativeId)});
  expect(await t.run(ctx=>ctx.db.get(payloadId))).toMatchObject({status:"released"});
  expect(await t.run(ctx=>ctx.db.get(nativeId))).toMatchObject({state:"released"});
});
