/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";
import { artifactOperationTarget, artifactSourceIdentity, assertAiArtifactWriteAdmission, lookupVerifiedAiArtifactWriteReplay, type AiArtifactContentEvidence } from "./spectraArtifactWriteScope";
import { canonicalArtifactWriteContent } from "../src/features/spectra/operations/artifact-write-content";

const modules = import.meta.glob("./**/*.ts");
const prepare = makeFunctionReference<"action">("spectraArtifactWrites:preparePlan");
const archive = makeFunctionReference<"mutation">("spectraArtifactWrites:archive");
const body = (text: string) => ({ blocks: [{ id: "p", type: "paragraph", text }] });
const createInput = { blueprintKey: "document", title: "Created work", content: body("Created explanation") };

async function fixture(follow: "wipe" | "archive" | "create" = "wipe") {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"]) aggregateTest.register(t, name);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Creation", slug: "creation", verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: "creation-owner", email: "creation@example.test", emailVerified: true, name: "Creator", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const runId = await ctx.db.insert("spectraAiRuns", { ownerAccountId: accountId, schoolId, sourceSurface: "workspace", userPrompt: "Create the work and perform the next operation", executionId: "create-attempt", status: "running", createdAt: now, updatedAt: now });
    return { schoolId, accountId, runId };
  });
  const actor = t.withIdentity({ subject: "creation-owner", email: "creation@example.test", emailVerified: true });
  const attempt = { runId: ids.runId, executionId: "create-attempt" };
  const second = follow === "create" ? { type: "artifact.create", input: createInput }
    : follow === "archive" ? { type: "artifact.archive", input: { artifactId: "@created:0" } }
    : { type: "artifact.update", input: { artifactId: "@created:0", blueprintKey: "document", content: body("") } };
  const { operationIds } = await actor.mutation(api.spectraOperations.recordPlan, { ...attempt,
    operations: [{ type: "artifact.create", input: createInput, requiresConfirmation: false }, { ...second, requiresConfirmation: false }],
  });
  const [createId, followerId] = operationIds;
  const pending = await actor.mutation(api.spectraArtifacts.createPending, { ...attempt, blueprintKey: "document", title: createInput.title });
  const bind = () => actor.mutation(api.spectraOperations.attachPendingArtifact, { operationId: createId, artifactId: pending.artifactId, executionId: attempt.executionId });
  await bind();
  const admitted = (operationId = followerId, afterContent: unknown = body("")) => t.run(async ctx => {
    const artifact = (await ctx.db.get(pending.artifactId))!;
    return assertAiArtifactWriteAdmission(ctx, { actorAccountId: ids.accountId, artifactId: artifact._id,
      aiOperation: { ...attempt, operationId }, beforeContent: artifact.content, afterContent });
  });
  const activate = (operationId = followerId) => t.run(ctx => ctx.db.patch(operationId, { status: "executing" }));
  const approve = async () => {
    await actor.action(prepare, attempt);
    await actor.mutation(api.spectraRuns.updateStatus, { ...attempt, status: "awaiting_confirmation", approvalReasons: ["Apply the prepared deletion"] });
    await actor.mutation(api.spectraRuns.claimConfirmation, attempt);
    await t.run(ctx => ctx.db.patch(ids.runId, { status: "running" }));
  };
  const commitCreation = async () => {
    await activate(createId);
    return t.run(async ctx => {
      const artifact = (await ctx.db.get(pending.artifactId))!;
      const afterContent = canonicalArtifactWriteContent("document", createInput.content);
      const admission = await assertAiArtifactWriteAdmission(ctx, { actorAccountId: ids.accountId, artifactId: artifact._id,
        aiOperation: { ...attempt, operationId: createId }, beforeContent: artifact.content, afterContent });
      const versionId = await ctx.db.insert("spectraArtifactVersions", { artifactId: artifact._id, ownerAccountId: ids.accountId, schoolId: ids.schoolId, source: "ai", runId: ids.runId, after: afterContent, createdAt: Date.now() });
      await ctx.db.patch(artifact._id, { content: afterContent, currentVersionId: versionId, liveStateVectorHash: "created-vector" });
      const result = { artifactId: artifact._id, versionId };
      await ctx.db.patch(createId, { output: { ...admission.operation.output,
        artifactWriteReceipt: { scope: admission.operationDigest, result,
          sourceContentIdentity: await artifactSourceIdentity((await ctx.db.get(artifact._id))!), resultContentDigest: admission.resultContentDigest },
      } });
      const evidence: AiArtifactContentEvidence = { version: 1, operationDigest: admission.operationDigest,
        sourceContentIdentity: admission.scope.sourceContentIdentity, baseContentDigest: admission.scope.baseContentDigest,
        resultContentDigest: admission.resultContentDigest, fullContentDeletion: false };
      return { result, evidence };
    });
  };
  return { t, actor, ids, attempt, createId, followerId, pending, bind, admitted, activate, approve, commitCreation };
}

describe("created artifact effect identity", () => {
  it("binds an untouched allocation exclusively to its exact create operation", async () => {
    const f = await fixture("create");
    expect(await f.t.run(ctx => ctx.db.get(f.pending.artifactId))).toMatchObject({ createdFrom: { operationId: f.createId, allocationContentDigest: expect.any(String) } });
    await expect(f.actor.mutation(api.spectraOperations.attachPendingArtifact, { operationId: f.followerId, artifactId: f.pending.artifactId, executionId: f.attempt.executionId })).rejects.toThrow("Pending artifact not found");
    await f.t.run(ctx => ctx.db.patch(f.createId, { type: "artifact.update" }));
    await expect(f.bind()).rejects.toThrow("no longer pending");
  });

  it("rejects preexisting or edited work even when AI presentation flags match", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.pending.artifactId, { content: body("Human writing before bind") }));
    await expect(f.bind()).rejects.toThrow("Pending artifact not found");
    await expect(f.actor.action(prepare, f.attempt)).rejects.toThrow("CREATION_SOURCE_CHANGED");
  });

  it("prepares a late allocated executing create without admitting unrelated executing edits", async () => {
    const f = await fixture();
    await f.activate(f.createId);
    await f.bind();
    expect(await f.actor.action(prepare, { ...f.attempt, operationId: f.createId })).toEqual({ approvalReasons: [] });
    expect((await f.admitted(f.createId, createInput.content)).scope.kind).toBe("create");
    // The harness stages a proposed edit on its own, so it can ask before it
    // runs; an edit already executing is never prepared again.
    expect((await f.actor.action(prepare, { ...f.attempt, operationId: f.followerId })).approvalReasons.length).toBeGreaterThan(0);
    await f.activate(f.followerId);
    await expect(f.actor.action(prepare, { ...f.attempt, operationId: f.followerId })).rejects.toThrow("PREPARATION_CHANGED");
  });

  it("does not rebase initial creation over a later human edit", async () => {
    const f = await fixture();
    await f.actor.action(prepare, { ...f.attempt, operationId: f.createId });
    await f.activate(f.createId);
    await f.t.run(ctx => ctx.db.patch(f.pending.artifactId, { content: body("Human revision after preparation") }));
    await expect(f.admitted(f.createId, createInput.content)).rejects.toThrow("CREATION_SOURCE_CHANGED");
  });

  it("permits only canonical-equivalent empty-room bootstrap, preserving title and history fences", async () => {
    const f = await fixture();
    await f.actor.action(prepare, { ...f.attempt, operationId: f.createId });
    await f.activate(f.createId);
    await f.t.run(async ctx => {
      const artifact = (await ctx.db.get(f.pending.artifactId))!;
      await ctx.db.patch(artifact._id, { content: canonicalArtifactWriteContent("document", artifact.content),
        liveStateVectorHash: "empty-bootstrap-vector", contentHash: "bootstrap-projection-hash" });
    });
    await f.bind();
    expect((await f.admitted(f.createId, createInput.content)).scope.kind).toBe("create");
    await f.t.run(ctx => ctx.db.patch(f.pending.artifactId, { title: "Human title" }));
    await expect(f.admitted(f.createId, createInput.content)).rejects.toThrow("CREATION_SOURCE_CHANGED");
  });

  it("derives and accepts a planned create-then-wipe approval, requiring the creating receipt", async () => {
    const f = await fixture();
    await f.approve();
    const follower = await f.t.run(ctx => ctx.db.get(f.followerId));
    expect(follower).toMatchObject({ requiresConfirmation: true, output: { artifactWriteScope: { kind: "full_content_delete", artifactId: f.pending.artifactId, baseProducerOperationId: f.createId } } });
    await f.activate();
    await expect(f.admitted()).rejects.toThrow("DEPENDENCY_NOT_COMMITTED");
    await f.commitCreation();
    expect((await f.admitted()).scope.kind).toBe("full_content_delete");
    await f.t.run(ctx => ctx.db.patch(f.pending.artifactId, { content: body("Intervening human work") }));
    await expect(f.admitted()).rejects.toThrow("APPROVAL_SCOPE_REQUIRED");
  });

  it("replays a creating receipt after Stop without overwriting human content", async () => {
    const f = await fixture();
    await f.actor.action(prepare, { ...f.attempt, operationId: f.createId });
    const committed = await f.commitCreation();
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.runId, { status: "cancelled" });
      await ctx.db.patch(f.pending.artifactId, { content: body("Human after creation") });
    });
    expect(await f.t.run(ctx => lookupVerifiedAiArtifactWriteReplay(ctx, { actorAccountId: f.ids.accountId, artifactId: f.pending.artifactId,
      aiOperation: { ...f.attempt, operationId: f.createId }, evidence: committed.evidence }))).toEqual({ result: committed.result });
    expect(await f.t.run(ctx => ctx.db.get(f.pending.artifactId))).toMatchObject({ content: body("Human after creation") });
  });

  it("keeps @created indices in their original recordPlan batch across replanning", async () => {
    const f = await fixture();
    const newer = await f.actor.mutation(api.spectraOperations.recordPlan, { ...f.attempt,
      operations: [{ type: "artifact.create", input: createInput, requiresConfirmation: false },
        { type: "artifact.update", input: { artifactId: "@created:0", blueprintKey: "document", content: body("New") }, requiresConfirmation: false }],
    });
    const allocated = await f.actor.mutation(api.spectraArtifacts.createPending, { ...f.attempt, blueprintKey: "document", title: "New batch" });
    await f.actor.mutation(api.spectraOperations.attachPendingArtifact, { operationId: newer.operationIds[0], artifactId: allocated.artifactId, executionId: f.attempt.executionId });
    expect(await f.t.run(async ctx => artifactOperationTarget(ctx, (await ctx.db.get(f.followerId))!, "preparation"))).toBe(f.pending.artifactId);
    expect(await f.t.run(async ctx => artifactOperationTarget(ctx, (await ctx.db.get(newer.operationIds[1]))!, "preparation"))).toBe(allocated.artifactId);
  });

  it("archives a newly created exact target only after its approved producer commits", async () => {
    const f = await fixture("archive");
    await f.approve();
    await f.activate();
    const args = { ...f.attempt, operationId: f.followerId, artifactId: f.pending.artifactId };
    await expect(f.actor.mutation(archive, args)).rejects.toThrow("DEPENDENCY_NOT_COMMITTED");
    await f.commitCreation();
    expect(await f.actor.mutation(archive, args)).toEqual({ artifactId: f.pending.artifactId });
    expect(await f.t.run(ctx => ctx.db.get(f.pending.artifactId))).toMatchObject({ status: "archived" });
  });
});
