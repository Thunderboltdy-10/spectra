/// <reference types="vite/client" />
import { createHash, createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { reconcileDurablePayloadOwners } from "./durablePayloadOwnership";
import { validateDurablePayload } from "./collaborationDurablePayload";
import { PAYLOAD_RELEASE_GRACE_MS } from "../shared/replica-truth";
import { readFileSync } from "node:fs";
import { createCollaborationAuthorizationGuard } from "../scripts/collaboration-persist.mjs";

const modules = import.meta.glob("./**/*.ts");
async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {name:"Review",slug:"review",verifiedDomains:[],status:"active",timezone:"Europe/Madrid",policyVersion:1,createdAt:now,updatedAt:now});
    const result = [];
    for (const clerkId of ["owner", "other"]) {
      const accountId = await ctx.db.insert("accounts",{clerkId,email:`${clerkId}@example.test`,emailVerified:true,name:clerkId,status:"active",createdAt:now,updatedAt:now});
      await ctx.db.insert("schoolMemberships",{accountId,schoolId,role:"student",status:"active",joinedAt:now,createdAt:now,updatedAt:now});
      const artifactId = await ctx.db.insert("spectraArtifacts",{ownerAccountId:accountId,schoolId,blueprintKey:"document",title:clerkId,content:{},textIndex:"",tags:[],status:"active",createdAt:now,updatedAt:now});
      result.push({accountId,artifactId});
    }
    return result;
  });
  const body = JSON.stringify({blocks:[{id:"p",text:"shared immutable body"}]});
  const storageId = await t.run(ctx=>ctx.storage.store(new Blob([body])));
  const facts = {storageId,digest:createHash("sha256").update(body).digest("hex"),byteLength:Buffer.byteLength(body),policyVersion:0};
  const owner = t.withIdentity({subject:"owner",email:"owner@example.test",emailVerified:true});
  const other = t.withIdentity({subject:"other",email:"other@example.test",emailVerified:true});
  return {t,ids,facts,body,owner,other};
}

import { canonicalIntakeAttestation, INTAKE_ATTESTATION_PURPOSE, type IntakeAttestation } from "../shared/intake-attestation";
import { adopt } from "./artifactContent";
import { decodeIntakeCursor, encodeIntakeCursor, releaseArtifactIntakePage } from "./artifactIntakeLifecycle";

afterEach(() => vi.unstubAllEnvs());
function attest(input: Omit<IntakeAttestation, "version" | "purpose" | "signature" | "issuedAt" | "expiresAt" | "nonce">) {
  const secret = "local-fixture-secret-".repeat(3);
  vi.stubEnv("SPECTRA_SECRET_BRIDGE_KEY", secret);
  const payload = {...input, version: 1 as const, purpose: INTAKE_ATTESTATION_PURPOSE,
    issuedAt: Date.now(), expiresAt: Date.now() + 120_000, nonce: "fixture-nonce-1234567890"};
  const key = createHmac("sha256", secret).update(INTAKE_ATTESTATION_PURPOSE).digest();
  return {...payload, signature: createHmac("sha256", key).update(canonicalIntakeAttestation(payload)).digest("base64url")};
}

it("requires trusted upload provenance, binds actor/epoch/dependencies, and retries a lost adoption receipt", async () => {
  const {t, ids, facts, owner, other} = await fixture();
  expect(adopt).toHaveProperty("isInternal", true);
  const attestation = attest({kind: "content", actorClerkId: "owner", actorAccountId: ids[0].accountId,
    targetId: ids[0].artifactId, attemptId: JSON.stringify([0, null]), storageId: facts.storageId,
    bytes: facts.byteLength, sha256: facts.digest, mediaType: "application/vnd.spectra.content+json"});
  const args = {artifactId: ids[0].artifactId, policyVersion: 0, attestation};
  await expect(owner.action(api.artifactIntakeActions.adoptDurableContent, {...args, attestation: {...attestation, signature: "x".repeat(43)}})).rejects.toThrow("SIGNATURE_INVALID");
  await expect(other.action(api.artifactIntakeActions.adoptDurableContent, args)).rejects.toThrow("ACTOR_INVALID");
  await expect(owner.action(api.artifactIntakeActions.adoptDurableContent, {...args, dependencies: {assetIds: [], nativePayloadHashes: []}})).rejects.toThrow("ATTESTATION_INVALID");
  const first = await owner.action(api.artifactIntakeActions.adoptDurableContent, args);
  expect(await owner.action(api.artifactIntakeActions.adoptDurableContent, args)).toEqual(first);
  expect(await t.run(ctx => ctx.db.query("collaborationDurablePayloads").collect())).toHaveLength(1);
  await t.run(ctx => ctx.db.patch(ids[0].accountId, {status: "deactivated"}));
  await expect(owner.action(api.artifactIntakeActions.adoptDurableContent, args)).rejects.toThrow();
});

it.each([false, true])("rejects foreign adoption before dedup (existing destination: %s)", async (dedup) => {
  const {t,ids,facts,body,owner,other}=await fixture();
  const first = await owner.mutation(internal.artifactContent.adopt,{artifactId:ids[0].artifactId,...facts});
  await t.run(ctx=>reconcileDurablePayloadOwners(ctx,"spectraArtifacts",String(ids[0].artifactId),{payloadRef:first.payloadRef}));
  if (dedup) {
    const ownStorage = await t.run(ctx=>ctx.storage.store(new Blob([body])));
    await other.mutation(internal.artifactContent.adopt,{artifactId:ids[1].artifactId,...facts,storageId:ownStorage});
  }
  await expect(other.mutation(internal.artifactContent.adopt,{artifactId:ids[1].artifactId,...facts})).rejects.toThrow("STORAGE_OWNERSHIP");
  await t.run(ctx=>validateDurablePayload(ctx,{artifactId:ids[0].artifactId,payloadRef:first.payloadRef,digest:facts.digest,kind:"projection"}));
  expect(await t.run(async ctx => (await ctx.storage.get(facts.storageId))?.text() ?? null)).not.toBeNull();
});

it("retains legacy cross-artifact aliases until the last owner releases", async () => {
  const {t,ids,facts,owner}=await fixture();
  const first = await owner.mutation(internal.artifactContent.adopt,{artifactId:ids[0].artifactId,...facts});
  const alias = await t.run(async ctx => {
    const row = await ctx.db.get(ctx.db.normalizeId("collaborationDurablePayloads",first.payloadRef)!);
    const {_id, _creationTime, ...fields} = row!;
    await ctx.db.patch(_id,{createdAt:Date.now()-PAYLOAD_RELEASE_GRACE_MS-1});
    await reconcileDurablePayloadOwners(ctx,"spectraArtifacts",String(ids[0].artifactId),{payloadRef:first.payloadRef});
    return ctx.db.insert("collaborationDurablePayloads",{...fields, ...ids[1], createdAt:Date.now()-PAYLOAD_RELEASE_GRACE_MS-1});
  });
  expect(await t.mutation(internal.durablePayloadOwnership.release,{payloadRef:alias})).toBe(true);
  expect(await t.run(async ctx => (await ctx.storage.get(facts.storageId))?.text() ?? null)).not.toBeNull();
  await t.run(ctx=>reconcileDurablePayloadOwners(ctx,"spectraArtifacts",String(ids[0].artifactId),null));
  expect(await t.mutation(internal.durablePayloadOwnership.release,{payloadRef:first.payloadRef})).toBe(true);
  expect(await t.run(async ctx => (await ctx.storage.get(facts.storageId))?.text() ?? null)).toBeNull();
});

it("protects native payload owners from durable GC and rejects reverse adoption", async () => {
  const {t,ids,facts,owner,other}=await fixture();
  const first = await owner.mutation(internal.artifactContent.adopt,{artifactId:ids[0].artifactId,...facts});
  const nativeId = await t.run(async ctx => {
    await ctx.db.patch(ctx.db.normalizeId("collaborationDurablePayloads",first.payloadRef)!,{createdAt:Date.now()-PAYLOAD_RELEASE_GRACE_MS-1});
    return ctx.db.insert("payloadObjects",{accountId:ids[0].accountId,hash:facts.digest,storageId:facts.storageId,bytes:facts.byteLength,mediaType:"application/octet-stream",refCount:1,state:"active",createdAt:Date.now(),verifiedAt:Date.now()});
  });
  await expect(other.mutation(api.payloads.put,{workId:ids[1].artifactId,hash:facts.digest,storageId:facts.storageId,bytes:facts.byteLength,mediaType:"application/octet-stream"})).rejects.toThrow("OWNERSHIP");
  expect(await t.mutation(internal.durablePayloadOwnership.release,{payloadRef:first.payloadRef})).toBe(true);
  expect(await t.run(async ctx => (await ctx.storage.get(facts.storageId))?.text() ?? null)).not.toBeNull();
  await t.mutation(internal.durablePayloadOwnership.release,{payloadRef:String(nativeId)});
  expect(await t.run(async ctx => (await ctx.storage.get(facts.storageId))?.text() ?? null)).toBeNull();
});

it("revokes a deactivated actor's cached grant even with an unchanged artifact policy",async()=>{
  const {t,ids}=await fixture();
  await t.run(async ctx=>{
    const artifact=(await ctx.db.get(ids[0].artifactId))!;
    await ctx.db.insert("collaborationRooms",{artifactId:ids[0].artifactId,schoolId:artifact.schoolId!,typeKey:"document",provider:"self_hosted_yjs",partitionKey:"root",schemaVersion:2,policyVersion:0,status:"active",nextSequence:1,snapshotSequence:0,uncompactedBytes:0,createdAt:Date.now(),updatedAt:Date.now()});
  });
  const authArgs={...ids[0],partitionKey:"root",policyVersion:0};
  expect(await t.query(internal.collaborationGatewayStore.authorize,authArgs)).toMatchObject({allowed:true,canModify:true});
  await t.run(ctx=>ctx.db.patch(ids[0].accountId,{status:"deactivated"}));
  expect(await t.query(internal.collaborationGatewayStore.authorize,authArgs)).toMatchObject({allowed:false,reason:"access_revoked"});
  expect(await t.query(internal.collaborationGatewayStore.policy,{artifactId:ids[0].artifactId,partitionKey:"root"})).toMatchObject({available:true,policyVersion:0});
  const source=readFileSync("scripts/collaboration-gateway.mjs","utf8");
  const code=source.slice(source.indexOf("async function refreshAuthorization("),source.indexOf("async function reauthorize("));
  const build = (bridge: () => Promise<unknown>) => new Function("authorizationGuard",`${code}; return refreshAuthorization;`)(createCollaborationAuthorizationGuard({authorize:bridge}));
  const context={...authArgs,canModify:true,authorizationCheckedAt:Date.now()-30_000,authorizationRevoked:false};
  await expect(build(()=>t.query(internal.collaborationGatewayStore.authorize,authArgs))(context)).rejects.toThrow("ACCESS_REVOKED");
  expect(context).toMatchObject({canModify:false,authorizationRevoked:true});
  const cached = {...context,canModify:true,authorizationRevoked:false,authorizationCheckedAt:Date.now()-10_000};
  expect(await build(()=>Promise.reject(new Error("fetch failed")))(cached)).toBe(cached);
  expect(cached.canModify).toBe(true);
  // Exercise the actual quiet-connection sweep, without a real server/socket.
  const sweepCode=source.slice(source.indexOf("async function enforceActivePolicyVersions("),source.indexOf("const policySweep ="));
  const close=vi.fn();
  const connection={context:{...cached},sendStateless:vi.fn(),webSocket:{close}};
  const connections=new Set([connection]);
  const sweep=new Function("bridge","activeConnections","refreshAuthorization",`let policySweepRunning=false; ${sweepCode}; return enforceActivePolicyVersions;`)(
    ()=>t.query(internal.collaborationGatewayStore.policy,{artifactId:ids[0].artifactId,partitionKey:"root"}),connections,
    build(()=>t.query(internal.collaborationGatewayStore.authorize,authArgs)));
  await sweep();
  expect(close).toHaveBeenCalledWith(4403,"Access or permissions changed");
  expect(connections.size).toBe(0);
});


it("retries a deduplicated upload after its redundant bytes were deleted", async () => {
  const {t, ids, facts, body, owner}=await fixture();
  const original=await owner.mutation(internal.artifactContent.adopt,{artifactId:ids[0].artifactId,...facts});
  const storageId=await t.run(ctx=>ctx.storage.store(new Blob([body])));
  const args={artifactId:ids[0].artifactId,...facts,storageId};
  expect(await owner.mutation(internal.artifactContent.adopt,args)).toEqual(original);
  expect(await t.run(ctx=>ctx.db.system.get(storageId))).toBeNull();
  expect(await owner.mutation(internal.artifactContent.adopt,args)).toEqual(original);
});

it("encodes intake cleanup cursors when the Convex runtime has no Node Buffer", () => {
  const bufferDescriptor=Object.getOwnPropertyDescriptor(globalThis,"Buffer");
  try {
    Object.defineProperty(globalThis,"Buffer",{configurable:true,writable:true,value:undefined});
    const cursor={version:"d01:v2",family:"imports" as const,cursor:null};
    expect(decodeIntakeCursor(encodeIntakeCursor(cursor))).toEqual(cursor);
    expect(()=>decodeIntakeCursor("not-base64!" )).toThrow("INTAKE_CURSOR_INVALID");
  } finally {
    if(bufferDescriptor) Object.defineProperty(globalThis,"Buffer",bufferDescriptor);
    else Reflect.deleteProperty(globalThis,"Buffer");
  }
});


it("keeps a legacy aliased durable blob through another artifact's intake GC", async () => {
  const {t,ids,facts,owner}=await fixture();
  const source=await owner.mutation(internal.artifactContent.adopt,{artifactId:ids[0].artifactId,...facts});
  await t.run(async ctx => {
    await ctx.db.patch(ids[1].artifactId,{status:"deleted"});
    await ctx.db.insert("artifactAssets", {artifactId:ids[1].artifactId, uploadedByAccountId:ids[1].accountId,
      storageId:facts.storageId, path:"old/shared",name:"shared",mediaType:"application/vnd.spectra.content+json",
      bytes:facts.byteLength,sha256:facts.digest,status:"active",createdAt:Date.now(),updatedAt:Date.now()});
  });
  const page=await t.run(ctx=>releaseArtifactIntakePage(ctx,{artifactId:ids[1].artifactId,ownerAccountId:ids[1].accountId,cursor:null}));
  expect(page.releasedBytes).toBe(0);
  expect(await t.run(async ctx => (await ctx.storage.get(facts.storageId))?.text() ?? null)).not.toBeNull();
  await t.run(ctx=>validateDurablePayload(ctx,{artifactId:ids[0].artifactId,payloadRef:source.payloadRef,digest:facts.digest,kind:"projection"}));
});

it("checks only pinned version rows while releasing intake for a large source", async () => {
  const {t,ids}=await fixture();
  const facts=await t.run(async ctx=>{
    const now=Date.now();
    const source=await ctx.db.get(ids[1].artifactId);
    const container=await ctx.db.get(ids[0].artifactId);
    await ctx.db.patch(ids[1].artifactId,{status:"deleted"});
    const assetId=await ctx.db.insert("artifactAssets",{
      artifactId:ids[1].artifactId, schoolId:source!.schoolId,
      uploadedByAccountId:ids[1].accountId, path:"native/image", name:"image.png",
      mediaType:"image/png", bytes:512_000, sha256:"a".repeat(64), status:"active",
      createdAt:now, updatedAt:now,
    });
    const pinnedVersionId=await ctx.db.insert("spectraArtifactVersions",{
      artifactId:ids[1].artifactId, ownerAccountId:ids[1].accountId,
      schoolId:source!.schoolId, source:"manual", schemaVersion:2,
      after:{blocks:[{type:"image",attrs:{assetId:String(assetId)}}]}, createdAt:now,
    });
    await ctx.db.insert("artifactEmbeds",{
      containerType:"artifact", containerId:String(ids[0].artifactId),
      containerRegionId:"durable-retention:pinned", sourceArtifactId:ids[1].artifactId,
      schoolId:container!.schoolId, mode:"compact", interaction:"read",
      versionPolicy:"pinned", pinnedVersionId, contextPolicy:"summary",
      createdByAccountId:ids[0].accountId, placementState:"confirmed",
      createdAt:now, updatedAt:now,
    });
    // A large unrelated history row is intentionally present. Retention only
    // needs the exact checkpoint referenced by a surviving pin.
    await ctx.db.insert("spectraArtifactVersions",{
      artifactId:ids[1].artifactId, ownerAccountId:ids[1].accountId,
      schoolId:source!.schoolId, source:"manual", schemaVersion:2,
      after:{legacyBody:"x".repeat(500_000)}, createdAt:now+1,
    });
    return {assetId};
  });
  const page=await t.run(async ctx=>{
    const guardedDb=new Proxy(ctx.db,{get(target,key,receiver){
      if(key==="query") return (table:string)=>{
        if(table==="spectraArtifactVersions") throw new Error("UNBOUNDED_VERSION_SCAN");
        return target.query(table as never);
      };
      const value=Reflect.get(target,key,receiver);
      return typeof value==="function" ? value.bind(target) : value;
    }});
    const guardedCtx=new Proxy(ctx,{get(target,key,receiver){
      if(key==="db") return guardedDb;
      const value=Reflect.get(target,key,receiver);
      return typeof value==="function" ? value.bind(target) : value;
    }});
    return releaseArtifactIntakePage(guardedCtx as typeof ctx,{
      artifactId:ids[1].artifactId, ownerAccountId:ids[1].accountId, cursor:null,
    });
  });
  expect(page.retainedRows).toBe(1);
  expect(await t.run(ctx=>ctx.db.get(facts.assetId))).toMatchObject({
    status:"active", retentionReason:expect.stringMatching(/^pinned-version:/),
  });
});

it("does not let a direct asset revoke delete another artifact's legacy durable body", async () => {
  const {t,ids,facts,owner,other}=await fixture();
  const source=await owner.mutation(internal.artifactContent.adopt,{artifactId:ids[0].artifactId,...facts});
  const assetId=await t.run(ctx=>ctx.db.insert("artifactAssets",{artifactId:ids[1].artifactId,
    schoolId: undefined, uploadedByAccountId:ids[1].accountId,storageId:facts.storageId,
    path:"old/shared",name:"shared",mediaType:"application/vnd.spectra.content+json",
    bytes:facts.byteLength,sha256:facts.digest,status:"active",createdAt:Date.now(),updatedAt:Date.now()}));
  expect(await other.mutation(api.artifactAssets.revoke,{assetId})).toMatchObject({revoked:true});
  await t.run(ctx=>validateDurablePayload(ctx,{artifactId:ids[0].artifactId,payloadRef:source.payloadRef,digest:facts.digest,kind:"projection"}));
});

it("rejects native adoption of an existing intake asset blob", async () => {
  const {t,ids,facts,owner}=await fixture();
  await t.run(ctx=>ctx.db.insert("artifactAssets",{artifactId:ids[0].artifactId,
    uploadedByAccountId:ids[0].accountId,storageId:facts.storageId,
    path:"source/document",name:"document",mediaType:"application/octet-stream",
    bytes:facts.byteLength,sha256:facts.digest,status:"active",createdAt:Date.now(),updatedAt:Date.now()}));
  await expect(owner.mutation(api.payloads.put,{workId:ids[0].artifactId,hash:facts.digest,
    storageId:facts.storageId,bytes:facts.byteLength,mediaType:"application/octet-stream"}))
    .rejects.toThrow("PAYLOAD_STORAGE_OWNERSHIP");
  expect(await t.run(ctx=>ctx.db.query("payloadObjects").collect())).toHaveLength(0);
  expect(await t.run(ctx=>ctx.db.system.get(facts.storageId))).not.toBeNull();
});
