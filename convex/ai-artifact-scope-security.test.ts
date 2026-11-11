/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";
import { artifactOperationDigest, artifactSourceIdentity, assertAiArtifactWriteAdmission, lookupVerifiedAiArtifactWriteReplay, type AiArtifactContentEvidence } from "./spectraArtifactWriteScope";
import { canonicalArtifactWriteContent, normalizeAiArtifactWriteContent } from "../src/features/spectra/operations/artifact-write-content";
import { preparationContext } from "./spectraArtifactWrites";
import { observeDatabase } from "../scripts/perf-read-ledger";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { POLICY_PRESETS } from "../shared/sync-policy";

const modules = import.meta.glob("./**/*.ts");
const prepare = makeFunctionReference<"action">("spectraArtifactWrites:preparePlan");
const archive = makeFunctionReference<"mutation">("spectraArtifactWrites:archive");
const commitPreparation = makeFunctionReference<"mutation">("spectraArtifactWrites:commitPreparation");
const body = (text: string) => ({ blocks: [{ id: "body", type: "paragraph", text }] });

async function fixture(type: "artifact.archive" | "artifact.update" = "artifact.archive", content = body("Authored explanation")) {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"]) aggregateTest.register(t, name);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Artifact approval", slug: "artifact-approval", verifiedDomains: [], status: "active",
      timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accounts = [];
    for (const name of ["artifact-owner", "artifact-other"]) {
      const accountId = await ctx.db.insert("accounts", {
        clerkId: name, email: `${name}@example.test`, emailVerified: true, name, status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
      });
      accounts.push(accountId);
    }
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: accounts[0], schoolId, blueprintKey: "document", title: "Approved artifact",
      content, textIndex: "Authored explanation", tags: [], status: "active", createdAt: now, updatedAt: now,
    });
    const runId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId: accounts[0], schoolId, sourceSurface: "workspace", userPrompt: "Clear the selected artifact",
      executionId: "artifact-attempt-1", status: "running", phase: "planning", createdAt: now, updatedAt: now,
    });
    const operationId = await ctx.db.insert("spectraOperations", {
      runId, executionId: "artifact-attempt-1", actorType: "ai", type, status: "proposed",
      input: type === "artifact.archive" ? { artifactId } : { artifactId, blueprintKey: "document", content: body("") },
      affected: [], requiresConfirmation: false, createdAt: now,
    });
    return { artifactId, runId, operationId, accountId: accounts[0], otherAccountId: accounts[1], schoolId };
  });
  const actor = t.withIdentity({ subject: "artifact-owner", email: "artifact-owner@example.test", emailVerified: true });
  const other = t.withIdentity({ subject: "artifact-other", email: "artifact-other@example.test", emailVerified: true });
  const attempt = { runId: ids.runId, executionId: "artifact-attempt-1" };
  const args = { ...attempt, operationId: ids.operationId, artifactId: ids.artifactId };
  const operation = () => t.run(ctx => ctx.db.get(ids.operationId));
  const artifact = () => t.run(ctx => ctx.db.get(ids.artifactId));
  const pending = async () => {
    await actor.action(prepare, attempt);
    await actor.mutation(api.spectraRuns.updateStatus, { ...attempt, status: "awaiting_confirmation", approvalReasons: ["Clear selected artifact"] });
  };
  const executing = async () => t.run(async ctx => {
    await ctx.db.patch(ids.runId, { status: "running", phase: "applying" });
    await ctx.db.patch(ids.operationId, { status: "executing" });
  });
  const approved = async () => {
    await pending();
    await actor.mutation(api.spectraRuns.claimConfirmation, attempt);
    await executing();
  };
  return { t, actor, other, ids, attempt, args, operation, artifact, pending, executing, approved };
}

describe("artifact preparation and archive approval boundary", () => {
  it.each([["both", "docx"], ["spectra", "docx"], ["both", "docm"]] as const)("classifies native writeback under %s for %s before admitting the edit", async (preset, nativeFormat) => {
    const f = await fixture("artifact.update");
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.artifactId, { nativeFormat });
      await ctx.db.patch(f.ids.operationId, { input: { artifactId: f.ids.artifactId, blueprintKey: "document", content: body("Updated explanation") } });
      await ctx.db.insert("workReplicas", { accountId: f.ids.accountId, workId: f.ids.artifactId, kind: "local", nativeFormat: "docx", revision: "native-before", state: "current", updatedAt: Date.now() });
      await ctx.db.insert("syncPolicies", { accountId: f.ids.accountId, scopeKind: "account", scopeId: String(f.ids.accountId), ...POLICY_PRESETS[preset], createdAt: Date.now(), updatedAt: Date.now() });
    });
    await f.actor.mutation(api.spectraHarness.recordToolOperations, { ...f.attempt, toolCallId: "native-edit", operationIds: [f.ids.operationId] });
    await f.actor.action(prepare, f.attempt);
    expect((await f.operation())?.requiresConfirmation).toBe(preset === "both");
    if (preset === "both") {
      expect((await f.operation())?.output.artifactWriteScope.approvalCategories).toEqual(["bridge_files"]);
      await expect(f.actor.mutation(api.spectraHarness.ensureApproved, { ...f.attempt, toolCallId: "native-edit" })).rejects.toThrow("AI_PERMISSION_REQUIRED");
      await f.t.run(ctx => ctx.db.insert("accountPreferences", { accountId: f.ids.accountId, scope: "account", scopeKey: "account", schemaVersion: 1, values: { ai: { permissionAllow: ["bridge_files"] } }, updatedAt: Date.now() }));
      await expect(f.actor.mutation(api.spectraHarness.ensureApproved, { ...f.attempt, toolCallId: "native-edit" })).resolves.toBeNull();
    }
  });

  it("checks both categories for a native wipe and Never still overrides an accepted approval", async () => {
    const f = await fixture("artifact.update");
    const preferenceId = await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.artifactId, { nativeFormat: "docx" });
      await ctx.db.insert("workReplicas", { accountId: f.ids.accountId, workId: f.ids.artifactId, kind: "local", nativeFormat: "docx", revision: "native-before", state: "current", updatedAt: Date.now() });
      await ctx.db.insert("syncPolicies", { accountId: f.ids.accountId, scopeKind: "account", scopeId: String(f.ids.accountId), ...POLICY_PRESETS.both, createdAt: Date.now(), updatedAt: Date.now() });
      return ctx.db.insert("accountPreferences", { accountId: f.ids.accountId, scope: "account", scopeKey: "account", schemaVersion: 1, values: { ai: { permissionAllow: ["bridge_files"] } }, updatedAt: Date.now() });
    });
    await f.actor.mutation(api.spectraHarness.recordToolOperations, { ...f.attempt, toolCallId: "native-wipe", operationIds: [f.ids.operationId] });
    await f.actor.action(prepare, f.attempt);
    expect((await f.operation())?.output.artifactWriteScope.approvalCategories).toEqual(["permanent_delete", "bridge_files"]);
    await expect(f.actor.mutation(api.spectraHarness.ensureApproved, { ...f.attempt, toolCallId: "native-wipe" })).rejects.toThrow("AI_PERMISSION_REQUIRED");
    await f.pending();
    await f.actor.mutation(api.spectraRuns.claimConfirmation, f.attempt);
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.runId, { status: "running" });
      await ctx.db.patch(preferenceId, { values: { ai: { permissionFullControl: true, permissionDeny: ["bridge_files"] } } });
    });
    await expect(f.actor.mutation(api.spectraHarness.ensureApproved, { ...f.attempt, toolCallId: "native-wipe" })).rejects.toThrow("Never");
    expect((await f.artifact())?.content).toEqual(body("Authored explanation"));
  });

  it("admits an approved native readback that regenerates file-owned binding hashes", async () => {
    const f = await fixture("artifact.update");
    const binding = { format: "docx", sourcePayloadHash: "a".repeat(64), semanticDigest: "b".repeat(64), identityStable: false };
    const before = { ...body("Authored explanation"), nativeBinding: binding };
    const after = body("Updated explanation");
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.artifactId, { nativeFormat: "docx", content: before });
      await ctx.db.patch(f.ids.operationId, { input: { artifactId: f.ids.artifactId, blueprintKey: "document", content: after } });
      await ctx.db.insert("workReplicas", { accountId: f.ids.accountId, workId: f.ids.artifactId, kind: "local", nativeFormat: "docx", revision: "native-before", state: "current", updatedAt: Date.now() });
      await ctx.db.insert("syncPolicies", { accountId: f.ids.accountId, scopeKind: "account", scopeId: String(f.ids.accountId), ...POLICY_PRESETS.both, createdAt: Date.now(), updatedAt: Date.now() });
    });
    await f.approved();
    const readback = { ...after, nativeBinding: { ...binding, sourcePayloadHash: "c".repeat(64), semanticDigest: "d".repeat(64), identityStable: true } };
    await expect(f.t.run(ctx => assertAiArtifactWriteAdmission(ctx, { actorAccountId: f.ids.accountId,
      artifactId: f.ids.artifactId, aiOperation: { ...f.attempt, operationId: f.ids.operationId }, beforeContent: before, afterContent: readback,
    }))).resolves.toMatchObject({ scope: { approvalCategories: ["bridge_files"] } });
  });

  it("binds the native permission category to the presented approval", async () => {
    const f = await fixture("artifact.update");
    await f.pending();
    await f.t.run(async ctx => {
      const operation = (await ctx.db.get(f.ids.operationId))!;
      await ctx.db.patch(operation._id, { output: { ...operation.output, artifactWriteScope: {
        ...operation.output.artifactWriteScope, approvalCategories: ["permanent_delete", "bridge_files"],
      } } });
    });
    await expect(f.actor.mutation(api.spectraRuns.claimConfirmation, f.attempt)).rejects.toThrow("APPROVAL_SCOPE_CHANGED");
  });

  it("replays an admitted write after Stop without overwriting later human work", async () => {
    const f = await fixture("artifact.update");
    await f.approved();
    const result = { artifactId: f.ids.artifactId, nativeResult: { revision: "committed-native-revision" } };
    const evidence = await f.t.run(async ctx => {
      const admission = await assertAiArtifactWriteAdmission(ctx, {
        actorAccountId: f.ids.accountId, artifactId: f.ids.artifactId,
        aiOperation: { ...f.attempt, operationId: f.ids.operationId },
        beforeContent: body("Authored explanation"), afterContent: body(""),
      });
      await ctx.db.patch(f.ids.artifactId, { content: body("") });
      await ctx.db.patch(f.ids.operationId, { output: {
        ...admission.operation.output,
        artifactWriteReceipt: { scope: admission.operationDigest, result,
          sourceContentIdentity: await artifactSourceIdentity((await ctx.db.get(f.ids.artifactId))!),
          resultContentDigest: admission.resultContentDigest },
      } });
      return { version: 1, operationDigest: admission.operationDigest,
        sourceContentIdentity: admission.scope.sourceContentIdentity,
        baseContentDigest: admission.scope.baseContentDigest,
        resultContentDigest: admission.resultContentDigest, fullContentDeletion: true } satisfies AiArtifactContentEvidence;
    });
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.artifactId, { content: body("Later human writing") });
      await ctx.db.patch(f.ids.runId, { status: "cancelled" });
      await ctx.db.patch(f.ids.operationId, { status: "cancelled" });
    });
    const before = { artifact: await f.artifact(), operation: await f.operation() };
    const replay = (overrides = {}) => f.t.run(ctx => lookupVerifiedAiArtifactWriteReplay(ctx, {
      actorAccountId: f.ids.accountId, artifactId: f.ids.artifactId,
      aiOperation: { ...f.attempt, operationId: f.ids.operationId }, evidence, ...overrides,
    }));
    expect(await replay()).toEqual({ result });
    expect({ artifact: await f.artifact(), operation: await f.operation() }).toEqual(before);
    await expect(replay({ actorAccountId: f.ids.otherAccountId })).rejects.toThrow("NOT_OWNED");
    await expect(replay({ evidence: { ...evidence, operationDigest: "substituted" } })).rejects.toThrow("RECEIPT_SCOPE_MISMATCH");
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { ownerAccountId: f.ids.otherAccountId }));
    await expect(replay()).rejects.toThrow();
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.artifactId, { ownerAccountId: f.ids.accountId });
      await ctx.db.patch(f.ids.operationId, { input: { artifactId: f.ids.artifactId, blueprintKey: "document", content: body("Changed operation") } });
    });
    await expect(replay()).rejects.toThrow("RECEIPT_SCOPE_MISMATCH");
  });

  it("does not interpret an unstarted cancelled write as a replay or admit its first effect", async () => {
    const f = await fixture("artifact.update");
    await f.approved();
    await f.t.run(ctx => ctx.db.patch(f.ids.runId, { status: "cancelled" }));
    const scope = (await f.operation())!.output.artifactWriteScope;
    const identity = { actorAccountId: f.ids.accountId, artifactId: f.ids.artifactId, aiOperation: { ...f.attempt, operationId: f.ids.operationId } };
    expect(await f.t.run(ctx => lookupVerifiedAiArtifactWriteReplay(ctx, { ...identity,
      evidence: { version: 1, operationDigest: scope.operationDigest, sourceContentIdentity: scope.sourceContentIdentity,
        baseContentDigest: scope.baseContentDigest, resultContentDigest: scope.resultContentDigest, fullContentDeletion: true },
    }))).toBeNull();
    await expect(f.t.run(ctx => assertAiArtifactWriteAdmission(ctx, { ...identity,
      beforeContent: body("Authored explanation"), afterContent: body(""),
    }))).rejects.toThrow("NOT_ACTIVE");
    expect(await f.artifact()).toMatchObject({ content: body("Authored explanation") });
  });

  it("rechecks current authority before replaying an archive receipt", async () => {
    const f = await fixture();
    await f.approved();
    await f.actor.mutation(archive, f.args);
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { status: "active", ownerAccountId: f.ids.otherAccountId }));
    await expect(f.actor.mutation(archive, f.args)).rejects.toThrow();
    expect(await f.artifact()).toMatchObject({ status: "active" });
  });

  it("keeps current-plan order and returned row bytes independent of large past attempts", async () => {
    const f = await fixture("artifact.update");
    const archiveId = await f.t.run(ctx => ctx.db.insert("spectraOperations", {
      runId: f.ids.runId, executionId: f.attempt.executionId, actorType: "ai", type: "artifact.archive", status: "proposed",
      input: { artifactId: f.ids.artifactId }, affected: [], createdAt: Date.now(),
    }));
    const measure = () => f.actor.run(async ctx => {
      const observer = observeDatabase(ctx.db);
      const handler = Reflect.get(preparationContext, "_handler") as (
        ctx: QueryCtx, args: typeof f.attempt,
      ) => Promise<{ operations: Array<{ _id: Id<"spectraOperations"> }> }>;
      const result = await handler({ ...ctx, db: observer.db }, f.attempt);
      return { ids: result.operations.map(operation => operation._id), ...observer.snapshot() };
    });
    const before = await measure();
    await f.t.run(async ctx => {
      for (let i = 0; i < 64; i++) await ctx.db.insert("spectraOperations", {
        runId: f.ids.runId, executionId: i % 2 ? `past-attempt-${i}` : f.attempt.executionId,
        actorType: "ai", type: "artifact.update", status: i % 2 ? "proposed" : "cancelled",
        input: { artifactId: f.ids.artifactId, blueprintKey: "document", content: body("Historical payload ".repeat(1_000)) },
        affected: [], createdAt: Date.now(),
      });
    });
    const after = await measure();
    expect(after.ids).toEqual([f.ids.operationId, archiveId]);
    expect(after.documentsReturned).toBe(before.documentsReturned);
    expect(after.serializedDocumentBytes).toBe(before.serializedDocumentBytes);
    expect(after.calls).toBe(before.calls);
    expect(after.writes).toBe(0);
    expect(after.reads.filter(read => read.table === "spectraOperations")).toEqual([
      expect.objectContaining({ index: "by_run_execution_status", operation: "collect", documentsReturned: 2, postIndexFilter: true }),
    ]);
  });

  it("derives mandatory archive approval despite a false model flag", async () => {
    const f = await fixture();
    expect(await f.actor.action(prepare, f.attempt)).toMatchObject({ approvalReasons: ["Archive the selected artifact"] });
    expect(await f.operation()).toMatchObject({ requiresConfirmation: true, output: { artifactWriteScope: { kind: "archive" } } });
    await f.executing();
    await expect(f.actor.mutation(archive, f.args)).rejects.toThrow("APPROVAL_SCOPE_REQUIRED");
    expect(await f.artifact()).toMatchObject({ status: "active" });
  });

  it("archives the exact accepted target and replays a lost result after human restoration", async () => {
    const f = await fixture();
    await f.approved();
    const result = await f.actor.mutation(archive, f.args);
    expect(result).toEqual({ artifactId: f.ids.artifactId });
    expect(await f.artifact()).toMatchObject({ status: "archived" });
    await f.actor.mutation(api.spectraOperations.markFailed, { operationId: f.ids.operationId, executionId: f.attempt.executionId, error: "Reply lost" });
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { status: "active" }));
    expect(await f.actor.mutation(archive, f.args)).toEqual(result);
    expect(await f.artifact()).toMatchObject({ status: "active" });
  });

  describe("Allow after the artifact was re-saved underneath (F08)", () => {
    const allowNative = async (resave: (f: Awaited<ReturnType<typeof fixture>>) => Promise<unknown>) => {
      const f = await fixture("artifact.update");
      const binding = { format: "docx", sourcePayloadHash: "a".repeat(64), semanticDigest: "b".repeat(64), identityStable: false };
      await f.t.run(async ctx => {
        await ctx.db.patch(f.ids.artifactId, { nativeFormat: "docx", content: { ...body("Authored explanation"), nativeBinding: binding } });
        await ctx.db.patch(f.ids.operationId, { input: { artifactId: f.ids.artifactId, blueprintKey: "document", content: body("Updated explanation") } });
        await ctx.db.insert("workReplicas", { accountId: f.ids.accountId, workId: f.ids.artifactId, kind: "local", nativeFormat: "docx", revision: "native-before", state: "current", updatedAt: Date.now() });
        await ctx.db.insert("syncPolicies", { accountId: f.ids.accountId, scopeKind: "account", scopeId: String(f.ids.accountId), ...POLICY_PRESETS.both, createdAt: Date.now(), updatedAt: Date.now() });
      });
      await f.actor.mutation(api.spectraHarness.recordToolOperations, { ...f.attempt, toolCallId: "native-edit", operationIds: [f.ids.operationId] });
      await f.pending();
      await f.t.run(async ctx => {
        const row = await ctx.db.query("spectraHarnessStates").withIndex("by_run", q => q.eq("runId", f.ids.runId)).unique();
        await ctx.db.patch(row!._id, { pending: { kind: "approval", toolCallId: "native-edit", question: "Change the file?", category: "bridge_files" } });
        await ctx.db.patch(f.ids.runId, { approval: { status: "pending", executionId: f.attempt.executionId, reasons: ["Change the file?"], requestedAt: Date.now() } });
      });
      await resave(f);
      await f.actor.mutation(api.spectraHarness.answer, { ...f.attempt, toolCallId: "native-edit", answer: { kind: "approval", allowed: true } });
      await f.t.run(ctx => ctx.db.patch(f.ids.runId, { status: "running" }));
      // The run prepares the edit again on the work as it is now.
      await f.actor.action(prepare, { ...f.attempt, operationId: f.ids.operationId });
      return f;
    };

    it("applies the allowed edit when Bridge only re-saved the artifact", async () => {
      const f = await allowNative(f => f.t.run(async ctx => {
        const artifact = (await ctx.db.get(f.ids.artifactId))!;
        await ctx.db.patch(f.ids.artifactId, { liveStateVectorHash: "resaved", content: { ...artifact.content,
          nativeBinding: { ...artifact.content.nativeBinding, sourcePayloadHash: "c".repeat(64), identityStable: true } } });
      }));
      await expect(f.actor.mutation(api.spectraHarness.ensureApproved, { ...f.attempt, toolCallId: "native-edit" })).resolves.toBeNull();
      const output = (await f.operation())!.output;
      expect(output.approvedArtifactScope).toBe(output.pendingArtifactScope);
      expect(output.allowedArtifactIntent).toBeUndefined();
    });

    it("does not carry the Allow over to work someone changed", async () => {
      const f = await allowNative(f => f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { content: body("New human work") })));
      await expect(f.actor.mutation(api.spectraHarness.ensureApproved, { ...f.attempt, toolCallId: "native-edit" })).rejects.toThrow("AI_APPROVAL_WORK_CHANGED");
      expect((await f.operation())!.output.approvedArtifactScope).toBeUndefined();
    });
  });

  it("does not accept content changed after the preview", async () => {
    const f = await fixture();
    await f.pending();
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { content: body("New human work") }));
    await expect(f.actor.mutation(api.spectraRuns.claimConfirmation, f.attempt)).rejects.toThrow("APPROVAL_SCOPE_CHANGED");
    expect(await f.artifact()).toMatchObject({ status: "active", content: body("New human work") });
  });

  it("cannot refresh pending scope with a repeated awaiting-confirmation update", async () => {
    const f = await fixture();
    await f.pending();
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { content: body("Unseen revision") }));
    await f.actor.mutation(api.spectraRuns.updateStatus, { ...f.attempt, status: "awaiting_confirmation", approvalReasons: ["Clear selected artifact"] });
    await expect(f.actor.mutation(api.spectraRuns.claimConfirmation, f.attempt)).rejects.toThrow("APPROVAL_SCOPE_CHANGED");
  });

  it("does not archive content or operation input changed after acceptance", async () => {
    const f = await fixture();
    await f.approved();
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { title: "Newly named human work" }));
    await expect(f.actor.mutation(archive, f.args)).rejects.toThrow("APPROVAL_SCOPE_CHANGED");
    expect(await f.artifact()).toMatchObject({ status: "active" });
  });

  it("rejects a changed operation even if its target remains the same", async () => {
    const f = await fixture();
    await f.pending();
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, { input: { artifactId: f.ids.artifactId, reason: "Unseen input" } }));
    await expect(f.actor.mutation(api.spectraRuns.claimConfirmation, f.attempt)).rejects.toThrow("APPROVAL_SCOPE_CHANGED");
  });

  it("denies foreign actors and stale attempts at prepare and effect", async () => {
    const f = await fixture();
    await expect(f.other.action(prepare, f.attempt)).rejects.toThrow("NOT_OWNED");
    await f.approved();
    await expect(f.other.mutation(archive, f.args)).rejects.toThrow("NOT_OWNED");
    await f.t.run(ctx => ctx.db.patch(f.ids.runId, { executionId: "new-attempt" }));
    await expect(f.actor.mutation(archive, f.args)).rejects.toThrow("SUPERSEDED");
    expect(await f.artifact()).toMatchObject({ status: "active" });
  });

  it("denies current target authority revoked after acceptance", async () => {
    const f = await fixture();
    await f.approved();
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { ownerAccountId: f.ids.otherAccountId }));
    await expect(f.actor.mutation(archive, f.args)).rejects.toThrow();
    expect(await f.artifact()).toMatchObject({ status: "active" });
  });

  it.each(["cancelled", "failed", "completed"] as const)("prevents a first effect after run becomes %s", async status => {
    const f = await fixture();
    await f.approved();
    await f.t.run(ctx => ctx.db.patch(f.ids.runId, { status }));
    await expect(f.actor.mutation(archive, f.args)).rejects.toThrow("NOT_ACTIVE");
    expect(await f.artifact()).toMatchObject({ status: "active" });
  });

  it("leaves the artifact intact after actual approval rejection", async () => {
    const f = await fixture();
    await f.pending();
    await f.actor.mutation(api.spectraRuns.rejectConfirmation, f.attempt);
    await expect(f.actor.mutation(archive, f.args)).rejects.toThrow("NOT_ACTIVE");
    expect(await f.artifact()).toMatchObject({ status: "active" });
  });

  it("classifies a full-content patch from persisted base before any plan operation runs", async () => {
    const f = await fixture("artifact.update");
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, {
      input: { artifactId: f.ids.artifactId, blueprintKey: "document", contentPatch: { changes: [{ path: "/blocks/id:body/text", value: "" }] } },
    }));
    expect(await f.actor.action(prepare, f.attempt)).toMatchObject({ approvalReasons: ["Clear all authored artifact content"] });
    expect(await f.operation()).toMatchObject({ status: "proposed", requiresConfirmation: true, output: { artifactWriteScope: { kind: "full_content_delete" } } });
    expect(await f.artifact()).toMatchObject({ content: body("Authored explanation") });
  });

  it("allows a substantive replacement without deletion approval", async () => {
    const f = await fixture("artifact.update");
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, { input: { artifactId: f.ids.artifactId, blueprintKey: "document", content: body("New explanation") } }));
    expect(await f.actor.action(prepare, f.attempt)).toEqual({ approvalReasons: [] });
    expect(await f.operation()).toMatchObject({ requiresConfirmation: false, output: { artifactWriteScope: { kind: "update" } } });
  });

  it("detects a cumulative wipe by two same-target patches before either has effects", async () => {
    const initial = { blocks: [{ id: "a", type: "paragraph", text: "A" }, { id: "b", type: "paragraph", text: "B" }] };
    const f = await fixture("artifact.update", initial);
    const secondId = await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.operationId, { input: { artifactId: f.ids.artifactId, blueprintKey: "document", contentPatch: { changes: [{ path: "/blocks/id:a/text", value: "" }] } } });
      return ctx.db.insert("spectraOperations", {
        runId: f.ids.runId, executionId: f.attempt.executionId, actorType: "ai", type: "artifact.update", status: "proposed",
        input: { artifactId: f.ids.artifactId, blueprintKey: "document", contentPatch: { changes: [{ path: "/blocks/id:b/text", value: "" }] } },
        affected: [], requiresConfirmation: false, createdAt: Date.now(),
      });
    });
    expect(await f.actor.action(prepare, f.attempt)).toMatchObject({ approvalReasons: ["Clear all authored artifact content"] });
    expect(await f.operation()).toMatchObject({ status: "proposed", requiresConfirmation: false });
    expect(await f.t.run(ctx => ctx.db.get(secondId))).toMatchObject({ status: "proposed", requiresConfirmation: true,
      output: { artifactWriteScope: { kind: "full_content_delete", baseProducerOperationId: f.ids.operationId } } });
    expect(await f.artifact()).toMatchObject({ content: initial });
  });

  it("archives after an exact preceding update receipt, never before it or after a subsequent human edit", async () => {
    const f = await fixture("artifact.update");
    const next = body("Approved replacement");
    const archiveId = await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.operationId, { input: { artifactId: f.ids.artifactId, blueprintKey: "document", content: next } });
      return ctx.db.insert("spectraOperations", {
        runId: f.ids.runId, executionId: f.attempt.executionId, actorType: "ai", type: "artifact.archive", status: "proposed",
        input: { artifactId: f.ids.artifactId }, affected: [], requiresConfirmation: false, createdAt: Date.now(),
      });
    });
    await f.approved();
    await f.t.run(ctx => ctx.db.patch(archiveId, { status: "executing" }));
    const args = { ...f.args, operationId: archiveId };
    await expect(f.actor.mutation(archive, args)).rejects.toThrow("APPROVAL_SCOPE_CHANGED");
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.artifactId, { content: next });
      const artifact = (await ctx.db.get(f.ids.artifactId))!;
      const operation = (await ctx.db.get(f.ids.operationId))!;
      await ctx.db.patch(operation._id, { output: { ...operation.output, artifactWriteReceipt: {
        scope: await artifactOperationDigest(operation), result: { artifactId: artifact._id },
        sourceContentIdentity: await artifactSourceIdentity(artifact),
        resultContentDigest: operation.output.artifactWriteScope.resultContentDigest,
      } } });
    });
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { content: body("Intervening human work") }));
    await expect(f.actor.mutation(archive, args)).rejects.toThrow("APPROVAL_SCOPE_CHANGED");
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { content: next }));
    expect(await f.actor.mutation(archive, args)).toEqual({ artifactId: f.ids.artifactId });
    expect(await f.artifact()).toMatchObject({ status: "archived" });
  });

  it("hydrates integrity-checked offloaded content before classifying and rejects a changed base at commit", async () => {
    const f = await fixture("artifact.update");
    const json = JSON.stringify({ content: body("Storage-backed authored artifact") });
    await f.t.run(async ctx => {
      const storageId = await ctx.storage.store(new Blob([json]));
      const digest = createHash("sha256").update(json).digest("hex");
      const payloadRef = await ctx.db.insert("collaborationDurablePayloads", {
        artifactId: f.ids.artifactId, accountId: f.ids.accountId, storageId, kind: "projection", digest,
        byteLength: Buffer.byteLength(json), mediaType: "application/json", manifestVersion: 1, policyVersion: 0, status: "active", createdAt: Date.now(),
      });
      await ctx.db.patch(f.ids.artifactId, { content: { spectraContentRef: { version: 1, artifactId: f.ids.artifactId,
        payloadRef, digest, byteLength: Buffer.byteLength(json), path: "content" } } });
    });
    expect(await f.actor.action(prepare, f.attempt)).toMatchObject({ approvalReasons: ["Clear all authored artifact content"] });
    const scope = (await f.operation())!.output.artifactWriteScope;
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { content: body("New physical source") }));
    await expect(f.actor.mutation(commitPreparation, { ...f.attempt, prepared: [{ operationId: f.ids.operationId, scope }] })).rejects.toThrow("PREPARATION_CHANGED");
  });

  it("does not allow completion output to forge or replace authority or effect receipts", async () => {
    const f = await fixture();
    await f.approved();
    const existing = (await f.operation())!.output;
    await f.actor.mutation(api.spectraOperations.markExecuted, {
      operationId: f.ids.operationId, executionId: f.attempt.executionId, affected: [],
      output: { applicationWriteReceipt: { scope: "forged", result: true }, artifactWriteReceipt: { scope: "forged", result: true },
        artifactWriteScope: { kind: "update" }, approvedArtifactScope: "forged", clarificationDraft: { version: 1 }, summary: "Reported" },
    });
    const result = (await f.operation())!.output;
    expect(result.artifactWriteScope).toEqual(existing.artifactWriteScope);
    expect(result.approvedArtifactScope).toEqual(existing.approvedArtifactScope);
    expect(result).not.toHaveProperty("artifactWriteReceipt");
    expect(result).not.toHaveProperty("applicationWriteReceipt");
    expect(result).not.toHaveProperty("clarificationDraft");
    expect(result.summary).toBe("Reported");
  });

  it("cannot mark a parked clarification draft as executed or failed", async () => {
    const f = await fixture();
    await f.executing();
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, { output: { clarificationDraft: { version: 1 } } }));
    await expect(f.actor.mutation(api.spectraOperations.markExecuted, {
      operationId: f.ids.operationId, executionId: f.attempt.executionId, affected: [],
    })).rejects.toThrow("CLARIFICATION_DRAFT_NOT_EXECUTABLE");
    await expect(f.actor.mutation(api.spectraOperations.markFailed, {
      operationId: f.ids.operationId, executionId: f.attempt.executionId, error: "late report",
    })).rejects.toThrow("CLARIFICATION_DRAFT_NOT_EXECUTABLE");
  });

  it("admits exactly the approved content wipe through the shared sink guard", async () => {
    const f = await fixture("artifact.update");
    await f.approved();
    const result = await f.t.run(ctx => assertAiArtifactWriteAdmission(ctx, {
      actorAccountId: f.ids.accountId, artifactId: f.ids.artifactId,
      aiOperation: { ...f.attempt, operationId: f.ids.operationId },
      beforeContent: body("Authored explanation"),
      afterContent: canonicalArtifactWriteContent("document", normalizeAiArtifactWriteContent("document", body(""), "Clear the selected artifact")),
    }));
    expect(result.scope.kind).toBe("full_content_delete");
    expect(result.resultContentDigest).toBe(result.scope.resultContentDigest);
  });

  it("denies an unapproved wipe and a substituted result at the shared sink guard", async () => {
    const f = await fixture("artifact.update");
    await f.actor.action(prepare, f.attempt);
    await f.executing();
    const check = (afterContent: unknown) => f.t.run(ctx => assertAiArtifactWriteAdmission(ctx, {
      actorAccountId: f.ids.accountId, artifactId: f.ids.artifactId,
      aiOperation: { ...f.attempt, operationId: f.ids.operationId },
      beforeContent: body("Authored explanation"), afterContent,
    }));
    await expect(check(body(""))).rejects.toThrow("APPROVAL_SCOPE_REQUIRED");
    await expect(check(body("Unrecorded change"))).rejects.toThrow("RESULT_SCOPE_MISMATCH");
  });

  it("requires new approval when a previously partial patch becomes a complete wipe after concurrent editing", async () => {
    const initial = { blocks: [{ id: "a", type: "paragraph", text: "A" }, { id: "b", type: "paragraph", text: "B" }] };
    const f = await fixture("artifact.update", initial);
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, { input: { artifactId: f.ids.artifactId, blueprintKey: "document",
      contentPatch: { changes: [{ path: "/blocks/id:a/text", value: "" }] } } }));
    expect(await f.actor.action(prepare, f.attempt)).toEqual({ approvalReasons: [] });
    await f.executing();
    const concurrent = { blocks: [{ id: "a", type: "paragraph", text: "A" }, { id: "b", type: "paragraph", text: "" }] };
    await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { content: concurrent }));
    await expect(f.t.run(ctx => assertAiArtifactWriteAdmission(ctx, {
      actorAccountId: f.ids.accountId, artifactId: f.ids.artifactId,
      aiOperation: { ...f.attempt, operationId: f.ids.operationId }, beforeContent: concurrent,
      afterContent: { blocks: [{ id: "a", type: "paragraph", text: "" }, { id: "b", type: "paragraph", text: "" }] },
    }))).rejects.toThrow("APPROVAL_SCOPE_REQUIRED");
  });
});
