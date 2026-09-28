/// <reference types="vite/client" />
import { createHash, createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
afterEach(() => vi.useRealTimers());

function setup() {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"])
    aggregateTest.register(t, name);
  return t;
}

type T = ReturnType<typeof setup>;

/** An erasure is a chain of one-page mutations plus the artifact deletion
 * jobs it starts: more hops than convex-test's default of 100. The runtime
 * accepts an iteration limit its type declaration omits. */
function finishErasure(t: T) {
  const finish = t.finishAllScheduledFunctions as (advanceTimers: () => void, maxIterations: number) => Promise<void>;
  return finish(vi.runAllTimers, 1000);
}

async function seed(t: T) {
  const localBytes = "the student's local copy of a shared essay";
  const attachmentBlob = await t.run(ctx => ctx.storage.store(new Blob(["png"], { type: "image/png" })));
  const localBlob = await t.run(ctx => ctx.storage.store(new Blob([localBytes], { type: DOCX })));
  return t.run(async ctx => {
    const now = Date.now();
    const school = (slug: string) => ctx.db.insert("schools", {
      name: slug, slug, verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const account = (clerkId: string, name: string) => ctx.db.insert("accounts", {
      clerkId, email: `${clerkId}@example.test`, emailVerified: true, name, avatarUrl: "https://img.example.test/a.png",
      status: "active", lastSeenAt: now, createdAt: now, updatedAt: now,
    });
    const schoolA = await school("erasure-a");
    const schoolB = await school("erasure-b");
    const erased = await account("erase-me", "Ana Student");
    const peer = await account("peer", "Peer Teacher");
    const bystander = await account("bystander", "Unrelated Student");
    // The erased account belongs to two schools (one past, one current).
    await ctx.db.insert("schoolMemberships", { accountId: erased, schoolId: schoolA, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId: erased, schoolId: schoolB, role: "teacher", status: "ended", endedAt: now, createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId: peer, schoolId: schoolA, role: "teacher", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const bystanderMembership = await ctx.db.insert("schoolMemberships", { accountId: bystander, schoolId: schoolB, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });

    const workspace = (owner: Id<"accounts">, schoolId: Id<"schools">, title: string) => ctx.db.insert("spectraWorkspaces", {
      ownerAccountId: owner, schoolId, title, status: "active", defaultView: "cards", createdAt: now, updatedAt: now, lastActivityAt: now,
    });
    const privateWorkspace = await workspace(erased, schoolA, "General");
    const sharedWorkspace = await workspace(erased, schoolB, "Class notes");
    await ctx.db.insert("accessGrants", {
      schoolId: schoolB, resourceType: "workspace", resourceId: sharedWorkspace, principalType: "school", principalId: schoolB,
      level: "read", capabilities: ["read"], source: "direct", createdByAccountId: erased, createdAt: now, updatedAt: now,
    });
    const node = (fields: { accountId: Id<"accounts">; parentId: Id<"orgNodes"> | null; kind: "workspace" | "work" | "folder"; sourceId?: string; workspaceContextId?: Id<"spectraWorkspaces"> }) =>
      ctx.db.insert("orgNodes", { ...fields, name: "node", orderKey: "a", createdAt: now, updatedAt: now });
    const privateWorkspaceNode = await node({ accountId: erased, parentId: null, kind: "workspace", sourceId: privateWorkspace });
    const sharedWorkspaceNode = await node({ accountId: erased, parentId: null, kind: "workspace", sourceId: sharedWorkspace });

    const artifact = (owner: Id<"accounts">, schoolId: Id<"schools">, title: string) => ctx.db.insert("spectraArtifacts", {
      schoolId, ownerAccountId: owner, blueprintKey: "document", title, content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now,
    });
    const privateWork = await artifact(erased, schoolA, "Private diary");
    const privateWorkNode = await node({ accountId: erased, parentId: privateWorkspaceNode, kind: "work", sourceId: privateWork, workspaceContextId: privateWorkspace });
    const grantedWork = await artifact(erased, schoolA, "Shared with the class");
    await ctx.db.insert("accessGrants", {
      schoolId: schoolA, resourceType: "artifact", resourceId: grantedWork, principalType: "school", principalId: schoolA,
      level: "read", capabilities: ["read"], source: "direct", createdByAccountId: erased, createdAt: now, updatedAt: now,
    });
    const grantedWorkNode = await node({ accountId: erased, parentId: privateWorkspaceNode, kind: "work", sourceId: grantedWork, workspaceContextId: privateWorkspace });
    const workspaceWork = await artifact(erased, schoolB, "Notes in the shared workspace");
    const workspaceWorkNode = await node({ accountId: erased, parentId: sharedWorkspaceNode, kind: "work", sourceId: workspaceWork, workspaceContextId: sharedWorkspace });
    const peerWork = await artifact(peer, schoolA, "Peer's lesson");
    const bystanderWork = await artifact(bystander, schoolB, "Bystander essay");
    const accountGrant = await ctx.db.insert("accessGrants", {
      schoolId: schoolA, resourceType: "artifact", resourceId: peerWork, principalType: "account", principalId: erased,
      level: "read", capabilities: ["read"], source: "direct", createdByAccountId: peer, createdAt: now, updatedAt: now,
    });

    const comment = (authorKind: "human" | "ai", authorDisplayName?: string) => ctx.db.insert("artifactComments", {
      artifactId: peerWork, authorAccountId: erased, authorKind, authorDisplayName, body: "A question about slide 2",
      anchor: { regionId: "root" }, mentionedAccountIds: [], status: "open", createdAt: now, updatedAt: now,
    });
    const humanComment = await comment("human");
    const aiComment = await comment("ai", "Ana Student's AI");

    const run = (owner: Id<"accounts">, schoolId: Id<"schools">, threadId?: Id<"spectraThreads">) => ctx.db.insert("spectraAiRuns", {
      ownerAccountId: owner, schoolId, sourceSurface: "chat", userPrompt: "Summarise my diary", status: "completed", phase: "completed",
      executionId: "execution-1", threadId, createdAt: now, updatedAt: now,
    });
    const thread = await ctx.db.insert("spectraThreads", {
      ownerAccountId: erased, schoolId: schoolA, title: "Diary help", origin: "chat", status: "active", messageCount: 1, createdAt: now, updatedAt: now,
    });
    const runId = await run(erased, schoolA, thread);
    await ctx.db.insert("spectraMessages", { threadId: thread, schoolId: schoolA, role: "user", content: "Summarise my diary", runId, createdAt: now });
    for (let sequence = 1; sequence <= 70; sequence++)
      await ctx.db.insert("spectraRunEvents", { runId, executionId: "execution-1", sequence, type: "status", payload: { type: "status" }, createdAt: now });
    await ctx.db.insert("spectraRunAttachments", {
      runId, executionId: "execution-1", ownerAccountId: erased, storageId: attachmentBlob, originalFileId: "upload-1",
      sha256: "a".repeat(64), status: "active", name: "photo.png", mimeType: "image/png", size: 3, handling: "image", createdAt: now, updatedAt: now,
    });
    const bystanderRun = await run(bystander, schoolB);

    const claim = (owner: Id<"accounts">, schoolId: Id<"schools">) => ctx.db.insert("memoryClaims", {
      accountId: owner, schoolId, scope: "private_school", subjectKind: "user", claimType: "declared_fact",
      proposition: "Has an appointment on Fridays", normalizedProposition: "has an appointment on fridays", propositionHash: `${owner}-claim`,
      assertion: "asserted", confidence: 1, sensitivity: "restricted", status: "active", createdBy: "user", validFrom: now, createdAt: now, updatedAt: now,
    });
    await claim(erased, schoolA);
    const bystanderClaim = await claim(bystander, schoolB);

    const calendar = (owner: Id<"accounts">, schoolId: Id<"schools">) => ctx.db.insert("calendarItems", {
      ownerAccountId: owner, schoolId, kind: "personal_event", title: "Therapy appointment", allDay: true, timezone: "UTC",
      timePrecision: "date_only", status: "active", sourceLocked: false, linkedArtifactIds: [], revision: 1, createdBy: "human", createdAt: now, updatedAt: now,
    });
    await calendar(erased, schoolA);
    const bystanderEvent = await calendar(bystander, schoolB);

    const preference = (owner: Id<"accounts">) => ctx.db.insert("accountPreferences", {
      accountId: owner, scope: "account", scopeKey: "account", values: { theme: "dark" }, schemaVersion: 1, updatedAt: now,
    });
    await preference(erased);
    const bystanderPreference = await preference(bystander);

    const device = await ctx.db.insert("bridgeDevices", {
      accountId: erased, name: "Ana's laptop", platform: "windows", credentialHash: "h".repeat(64), protocolVersion: "1", appVersion: "1",
      pairedAt: now, lastSeenAt: now, state: "active",
    });
    const payload = await ctx.db.insert("payloadObjects", {
      accountId: erased, storageId: localBlob, hash: sha(localBytes), bytes: Buffer.byteLength(localBytes),
      mediaType: DOCX, refCount: 1, state: "active", createdAt: now, verifiedAt: now,
    });
    await ctx.db.insert("workReplicas", {
      workId: peerWork, accountId: erased, deviceId: device, kind: "local", localResourceId: "essay", relativePath: "essay.docx",
      nativeFormat: "docx", payloadRef: String(payload), revision: "r1", state: "current", updatedAt: now,
    });
    return {
      schoolA, schoolB, erased, peer, bystander, bystanderMembership, privateWorkspace, sharedWorkspace,
      privateWorkspaceNode, sharedWorkspaceNode, privateWork, privateWorkNode, grantedWork, grantedWorkNode,
      workspaceWork, workspaceWorkNode, peerWork, bystanderWork, accountGrant, humanComment, aiComment, runId, thread,
      bystanderRun, bystanderClaim, bystanderEvent, bystanderPreference, device, payload, attachmentBlob, localBlob,
    };
  });
}

it("erases an account across two schools, keeps its shared works under a tombstone and leaves others untouched", async () => {
  vi.useFakeTimers();
  const t = setup();
  const ids = await seed(t);
  const bystanderBefore = await t.run(ctx => ctx.db.get(ids.bystander));

  const first = await t.mutation(internal.accountErasure.requestForDeletedIdentity, { clerkId: "erase-me" });
  expect(first.status).toBe("running");
  // Frozen at once: no session, no membership, before any page runs.
  const frozen = await t.run(async ctx => ({
    account: await ctx.db.get(ids.erased),
    memberships: await ctx.db.query("schoolMemberships").withIndex("by_account", q => q.eq("accountId", ids.erased)).collect(),
  }));
  expect(frozen.account?.status).toBe("deactivated");
  expect(frozen.memberships.every(row => row.status === "ended")).toBe(true);

  // A redelivered webhook joins the same job.
  expect((await t.mutation(internal.accountErasure.requestForDeletedIdentity, { clerkId: "erase-me" })).jobId).toBe(first.jobId);
  await finishErasure(t);

  const after = await t.run(async ctx => {
    return {
      job: await ctx.db.get(first.jobId),
      jobs: await ctx.db.query("accountErasureJobs").collect(),
      account: await ctx.db.get(ids.erased),
      memberships: await ctx.db.query("schoolMemberships").withIndex("by_account", q => q.eq("accountId", ids.erased)).collect(),
      privateWork: await ctx.db.get(ids.privateWork),
      grantedWork: await ctx.db.get(ids.grantedWork),
      workspaceWork: await ctx.db.get(ids.workspaceWork),
      privateWorkspace: await ctx.db.get(ids.privateWorkspace),
      sharedWorkspace: await ctx.db.get(ids.sharedWorkspace),
      privateWorkspaceNode: await ctx.db.get(ids.privateWorkspaceNode),
      sharedWorkspaceNode: await ctx.db.get(ids.sharedWorkspaceNode),
      privateWorkNode: await ctx.db.get(ids.privateWorkNode),
      grantedWorkNode: await ctx.db.get(ids.grantedWorkNode),
      workspaceWorkNode: await ctx.db.get(ids.workspaceWorkNode),
      accountGrant: await ctx.db.get(ids.accountGrant),
      schoolGrants: await ctx.db.query("accessGrants").withIndex("by_principal", q => q.eq("principalType", "school")).collect(),
      humanComment: await ctx.db.get(ids.humanComment),
      aiComment: await ctx.db.get(ids.aiComment),
      runs: await ctx.db.query("spectraAiRuns").withIndex("by_account_created", q => q.eq("ownerAccountId", ids.erased)).collect(),
      events: await ctx.db.query("spectraRunEvents").withIndex("by_run_sequence", q => q.eq("runId", ids.runId)).collect(),
      threads: await ctx.db.query("spectraThreads").withIndex("by_account_status", q => q.eq("ownerAccountId", ids.erased)).collect(),
      messages: await ctx.db.query("spectraMessages").withIndex("by_thread", q => q.eq("threadId", ids.thread)).collect(),
      attachments: await ctx.db.query("spectraRunAttachments").withIndex("by_owner_created", q => q.eq("ownerAccountId", ids.erased)).collect(),
      claims: await ctx.db.query("memoryClaims").withIndex("by_account_status_updated", q => q.eq("accountId", ids.erased)).collect(),
      calendar: await ctx.db.query("calendarItems").withIndex("by_account_start", q => q.eq("ownerAccountId", ids.erased)).collect(),
      preferences: await ctx.db.query("accountPreferences").withIndex("by_account", q => q.eq("accountId", ids.erased)).collect(),
      devices: await ctx.db.query("bridgeDevices").withIndex("by_account_state", q => q.eq("accountId", ids.erased)).collect(),
      replicas: await ctx.db.query("workReplicas").withIndex("by_account_state", q => q.eq("accountId", ids.erased)).collect(),
      payload: await ctx.db.get(ids.payload),
      attachmentBlob: await ctx.db.system.get(ids.attachmentBlob),
      localBlob: await ctx.db.system.get(ids.localBlob),
      audit: await ctx.db.query("auditEvents").collect(),
      bystander: await ctx.db.get(ids.bystander),
      bystanderMembership: await ctx.db.get(ids.bystanderMembership),
      bystanderWork: await ctx.db.get(ids.bystanderWork),
      bystanderRun: await ctx.db.get(ids.bystanderRun),
      bystanderClaim: await ctx.db.get(ids.bystanderClaim),
      bystanderEvent: await ctx.db.get(ids.bystanderEvent),
      bystanderPreference: await ctx.db.get(ids.bystanderPreference),
      peerWork: await ctx.db.get(ids.peerWork),
    };
  });

  expect(after.job).toMatchObject({ stage: "completed", keptWorks: 2, deletedWorks: 1, retainedWorks: 0 });
  expect(after.jobs).toHaveLength(1);
  // The account row survives as the author tombstone, with no personal data.
  expect(after.account).toMatchObject({ name: "Former member", email: "", emailVerified: false, status: "deactivated", clerkId: "erase-me" });
  expect(after.account?.avatarUrl).toBeUndefined();
  expect(after.account?.lastSeenAt).toBeUndefined();
  expect(after.memberships).toEqual([]);

  // Private work is gone; works others can reach keep their content and author id.
  expect(after.privateWork).toBeNull();
  expect(after.grantedWork).toMatchObject({ title: "Shared with the class", ownerAccountId: ids.erased, status: "active" });
  expect(after.workspaceWork).toMatchObject({ title: "Notes in the shared workspace", ownerAccountId: ids.erased, status: "active" });
  expect(after.privateWorkspace).toBeNull();
  expect(after.sharedWorkspace).not.toBeNull();
  expect(after.privateWorkspaceNode).toBeNull();
  expect(after.privateWorkNode).toBeNull();
  expect(after.grantedWorkNode).toBeNull();
  expect(after.sharedWorkspaceNode).not.toBeNull();
  expect(after.workspaceWorkNode).not.toBeNull();

  // Access held by the erased account closes; access it gave others stays.
  expect(after.accountGrant).toBeNull();
  expect(after.schoolGrants.map(grant => grant.resourceId).sort()).toEqual([String(ids.grantedWork), String(ids.sharedWorkspace)].sort());
  expect(after.humanComment).not.toBeNull();
  expect(after.aiComment?.authorDisplayName).toBe("Former member's AI");

  // Private rows and their blobs are deleted.
  expect(after.runs).toEqual([]);
  expect(after.events).toEqual([]);
  expect(after.threads).toEqual([]);
  expect(after.messages).toEqual([]);
  expect(after.attachments).toEqual([]);
  expect(after.attachmentBlob).toBeNull();
  expect(after.claims).toEqual([]);
  expect(after.calendar).toEqual([]);
  expect(after.preferences).toEqual([]);
  expect(after.devices).toEqual([]);
  expect(after.replicas).toEqual([]);
  expect(after.payload?.state).toBe("released");
  expect(after.localBlob).toBeNull();

  // Audit keeps the fact of the erasure, not the person.
  const erasureAudit = after.audit.filter(event => event.action.startsWith("account.erasure."));
  expect(erasureAudit.map(event => event.action).sort()).toEqual(["account.erasure.completed", "account.erasure.requested"]);
  expect(JSON.stringify(erasureAudit)).not.toContain("erase-me@example.test");
  expect(JSON.stringify(erasureAudit)).not.toContain("Ana");

  // An unrelated account and a peer are untouched.
  expect(after.bystander).toEqual(bystanderBefore);
  expect(after.bystanderMembership?.status).toBe("active");
  for (const row of [after.bystanderWork, after.bystanderRun, after.bystanderClaim, after.bystanderEvent, after.bystanderPreference, after.peerWork])
    expect(row).not.toBeNull();

  // Late or repeated events are no-ops, and a stale page call does nothing.
  expect(await t.mutation(internal.accountErasure.requestForDeletedIdentity, { clerkId: "erase-me" })).toMatchObject({ status: "completed", jobId: first.jobId });
  expect(await t.mutation(internal.accountErasure.process, { jobId: first.jobId, step: 0 })).toBeNull();

  // A session token issued before the deletion cannot restore name and email.
  await expect(
    t.withIdentity({ subject: "erase-me", email: "erase-me@example.test", emailVerified: true, name: "Ana Student" })
      .mutation(api.identity.registerSelf, {}),
  ).rejects.toThrow(/IDENTITY_ACCOUNT_ERASED/);
  expect((await t.run(ctx => ctx.db.get(ids.erased)))?.email).toBe("");
  // Drives the whole scheduled erasure job across two schools; allow for full-suite load.
}, 60_000);

it("a deletion that arrives before registration leaves an erased tombstone", async () => {
  const t = setup();
  const result = await t.mutation(internal.accountErasure.requestForDeletedIdentity, { clerkId: "never-registered" });
  expect(result.status).toBe("completed");
  const account = await t.run(ctx => ctx.db.query("accounts").withIndex("by_clerk_id", q => q.eq("clerkId", "never-registered")).unique());
  expect(account).toMatchObject({ status: "deactivated", email: "", name: "Former member" });
  await expect(
    t.withIdentity({ subject: "never-registered", email: "late@example.test", emailVerified: true })
      .mutation(api.identity.registerSelf, {}),
  ).rejects.toThrow(/IDENTITY_ACCOUNT_ERASED/);
  // The same person may still sign up again under a new identity.
  const fresh = await t.withIdentity({ subject: "new-identity", email: "late@example.test", emailVerified: true })
    .mutation(api.identity.registerSelf, {});
  expect(fresh).not.toBe(account?._id);
});

it("waits for a live AI run's lease before deleting it", async () => {
  vi.useFakeTimers();
  const t = setup();
  const ids = await seed(t);
  const leaseExpiresAt = Date.now() + 30 * 60_000;
  await t.run(ctx => ctx.db.patch(ids.runId, { status: "running", leaseExpiresAt }));
  const { jobId } = await t.mutation(internal.accountErasure.requestForDeletedIdentity, { clerkId: "erase-me" });
  await finishErasure(t);
  expect((await t.run(ctx => ctx.db.get(jobId)))?.stage).toBe("completed");
  expect(await t.run(ctx => ctx.db.get(ids.runId))).toBeNull();
  // The run was only deleted once its lease had lapsed on the job's clock.
  expect(Date.now()).toBeGreaterThanOrEqual(leaseExpiresAt);
});

it("the bridge action erases only for a request signed with the server key", async () => {
  const key = "bridge-key-fixture-with-at-least-32-characters";
  vi.stubEnv("SPECTRA_SECRET_BRIDGE_KEY", key);
  try {
    const t = setup();
    const timestamp = Date.now();
    const nonce = "nonce-fixture";
    const sign = (clerkId: string, signingKey: string) => createHmac("sha256", signingKey)
      .update(["erase-account", clerkId, "-", "clerk-user-deleted", timestamp, nonce, "-"].join("|"))
      .digest("base64url");
    await expect(t.action(api.secretBridge.eraseDeletedIdentity, {
      clerkId: "victim", timestamp, nonce, signature: sign("victim", "not-the-server-key-but-long-enough-to-pass"),
    })).rejects.toThrow(/SECRET_BRIDGE_INVALID/);
    await expect(t.action(api.secretBridge.eraseDeletedIdentity, {
      clerkId: "victim", timestamp, nonce, signature: sign("someone-else", key),
    })).rejects.toThrow(/SECRET_BRIDGE_INVALID/);
    expect(await t.run(ctx => ctx.db.query("accounts").collect())).toEqual([]);
    expect(await t.action(api.secretBridge.eraseDeletedIdentity, {
      clerkId: "victim", timestamp, nonce, signature: sign("victim", key),
    })).toEqual({ status: "completed" });
  } finally {
    vi.unstubAllEnvs();
  }
});
