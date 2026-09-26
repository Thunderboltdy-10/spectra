/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const execute = makeFunctionReference<"mutation">("spectraApplicationWrites:execute");
const command = "change_spectra_settings";
const commandArgs = { patch: { appearance: { density: "compact" } } };

async function fixture() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "AI scope fixture", slug: "ai-scope", verifiedDomains: [], status: "active",
      timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accounts = [];
    for (const name of ["scope-owner", "scope-other"]) {
      const accountId = await ctx.db.insert("accounts", {
        clerkId: name, email: name + "@example.test", emailVerified: true, name, status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        schoolId, accountId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
      });
      accounts.push(accountId);
    }
    const runId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId: accounts[0], schoolId, sourceSurface: "workspace", userPrompt: "Use compact appearance",
      status: "running", phase: "planning", executionId: "scope-attempt-1",
      createdAt: now, updatedAt: now,
    });
    const operationId = await ctx.db.insert("spectraOperations", {
      runId, executionId: "scope-attempt-1", actorType: "ai", type: "app.command",
      status: "proposed", input: { command, args: commandArgs }, affected: [], requiresConfirmation: true, createdAt: now,
    });
    return { runId, operationId, accountId: accounts[0], otherAccountId: accounts[1], schoolId };
  });
  const actor = t.withIdentity({ subject: "scope-owner", email: "scope-owner@example.test", emailVerified: true });
  const other = t.withIdentity({ subject: "scope-other", email: "scope-other@example.test", emailVerified: true });
  const args = { runId: ids.runId, operationId: ids.operationId, executionId: "scope-attempt-1", expectedCommand: command, expectedArgs: commandArgs };
  const preferences = () => t.run(ctx => ctx.db.query("accountPreferences").collect());
  return { t, actor, other, ids, args, preferences };
}

async function startExecution(f: Awaited<ReturnType<typeof fixture>>, approve = true) {
  if (approve) {
    const run = await f.t.run(ctx => ctx.db.get(f.ids.runId));
    if (run?.approval?.status !== "pending") await f.actor.mutation(api.spectraRuns.updateStatus, {
      runId: f.ids.runId, executionId: f.args.executionId,
      status: "awaiting_confirmation", approvalReasons: ["Change account preferences"],
    });
    await f.actor.mutation(api.spectraRuns.claimConfirmation, {
      runId: f.ids.runId, executionId: f.args.executionId,
    });
  }
  await f.t.run(async ctx => {
    await ctx.db.patch(f.ids.runId, { status: "running", phase: "applying" });
    await ctx.db.patch(f.ids.operationId, { status: "executing" });
  });
}

describe("Independent AI operation and approval scope security", () => {
  it("cannot reopen an acknowledged operation for another write", async () => {
    const f = await fixture();
    await startExecution(f);
    await f.actor.mutation(execute, f.args);
    await f.actor.mutation(api.spectraOperations.markExecuted, {
      operationId: f.ids.operationId, executionId: f.args.executionId, affected: [], output: { summary: "Saved" },
    });
    const before = await f.t.run(ctx => ctx.db.get(f.ids.operationId));
    await expect(f.actor.mutation(api.spectraOperations.reopenForCurrentStateRetry, {
      operationId: f.ids.operationId, executionId: f.args.executionId,
    })).rejects.toThrow("AI_OPERATION_ALREADY_EXECUTED");
    expect(await f.t.run(ctx => ctx.db.get(f.ids.operationId))).toEqual(before);
  });

  async function deletionFixture() {
    const f = await fixture();
    const root = await f.actor.mutation(api.orgTree.createFolder, { name: "Approved folder" });
    const child = await f.actor.mutation(api.orgTree.createFolder, { name: "Approved child", parentId: root.nodeId });
    const targetArgs = { targetIds: [root.nodeId], localFileCount: 0 };
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.operationId, { input: { command: "delete_library_items", args: targetArgs } });
      await ctx.db.patch(f.ids.runId, { status: "running", approval: undefined });
    });
    await f.actor.mutation(api.spectraRuns.updateStatus, {
      runId: f.ids.runId, executionId: f.args.executionId,
      status: "awaiting_confirmation", approvalReasons: ["Delete the approved folder and its child"],
    });
    return { ...f, root, child, deletionArgs: { ...f.args, expectedCommand: "delete_library_items", expectedArgs: { targetIds: [root.nodeId] } } };
  }

  it("does not accept a folder deletion after an unseen child arrives in the pending preview", async () => {
    const f = await deletionFixture();
    const unseen = await f.actor.mutation(api.orgTree.createFolder, { name: "Unseen child", parentId: f.root.nodeId });
    await expect(f.actor.mutation(api.spectraRuns.claimConfirmation, {
      runId: f.ids.runId, executionId: f.args.executionId,
    })).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_CHANGED");
    expect(await f.t.run(ctx => ctx.db.get(unseen.nodeId))).not.toHaveProperty("deletedAt");
  });

  it("does not delete a child substituted after acceptance even when counts stay equal", async () => {
    const f = await deletionFixture();
    await startExecution(f);
    await f.actor.mutation(api.orgTree.move, { nodeIds: [f.child.nodeId], parentId: null });
    const unseen = await f.actor.mutation(api.orgTree.createFolder, { name: "Substituted child", parentId: f.root.nodeId });
    await expect(f.actor.mutation(execute, f.deletionArgs)).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_REQUIRED");
    for (const id of [f.root.nodeId, f.child.nodeId, unseen.nodeId])
      expect(await f.t.run(ctx => ctx.db.get(id))).not.toHaveProperty("deletedAt");
  });

  it("cannot renew an unseen subtree through a repeated pending status update", async () => {
    const f = await deletionFixture();
    await f.actor.mutation(api.orgTree.createFolder, { name: "Unseen child", parentId: f.root.nodeId });
    await f.actor.mutation(api.spectraRuns.updateStatus, {
      runId: f.ids.runId, executionId: f.args.executionId,
      status: "awaiting_confirmation", approvalReasons: ["Delete the approved folder and its child"],
    });
    await expect(f.actor.mutation(api.spectraRuns.claimConfirmation, {
      runId: f.ids.runId, executionId: f.args.executionId,
    })).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_CHANGED");
  });

  it("deletes exactly the approved subtree and recovers its receipt after a lost reply", async () => {
    const f = await deletionFixture();
    await startExecution(f);
    const result = await f.actor.mutation(execute, f.deletionArgs);
    expect(result).toMatchObject({ trashed: [{ trashed: 2 }] });
    await f.actor.mutation(api.spectraOperations.markFailed, {
      operationId: f.ids.operationId, executionId: f.args.executionId, error: "Reply lost",
    });
    await f.actor.mutation(api.orgTree.restore, { nodeIds: [f.root.nodeId] });
    expect(await f.actor.mutation(execute, f.deletionArgs)).toEqual(result);
    for (const id of [f.root.nodeId, f.child.nodeId])
      expect(await f.t.run(ctx => ctx.db.get(id))).not.toHaveProperty("deletedAt");
  });

  it("does not approve replacement command arguments added after the preview", async () => {
    const f = await fixture();
    await f.actor.mutation(api.spectraRuns.updateStatus, {
      runId: f.ids.runId, executionId: f.args.executionId,
      status: "awaiting_confirmation", approvalReasons: ["Use compact appearance"],
    });
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, {
      input: { command, args: { patch: { appearance: { density: "comfortable" } } } },
    }));
    await expect(f.actor.mutation(api.spectraRuns.claimConfirmation, {
      runId: f.ids.runId, executionId: f.args.executionId,
    })).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_CHANGED");
    expect(await f.preferences()).toEqual([]);
  });

  it("cannot copy approval to a second concurrent run of the same user", async () => {
    const f = await fixture();
    await startExecution(f);
    const other = await f.t.run(async ctx => {
      const run = (await ctx.db.get(f.ids.runId))!;
      const operation = (await ctx.db.get(f.ids.operationId))!;
      const runId = await ctx.db.insert("spectraAiRuns", {
        ownerAccountId: run.ownerAccountId, schoolId: run.schoolId, sourceSurface: run.sourceSurface,
        userPrompt: run.userPrompt, status: run.status, executionId: run.executionId,
        approval: run.approval, createdAt: Date.now(), updatedAt: Date.now(),
      });
      const operationId = await ctx.db.insert("spectraOperations", {
        runId, executionId: operation.executionId, actorType: "ai", type: operation.type,
        status: "executing", input: operation.input, output: operation.output,
        affected: [], requiresConfirmation: true, createdAt: Date.now(),
      });
      return { runId, operationId };
    });
    await expect(f.actor.mutation(execute, { ...f.args, ...other }))
      .rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_REQUIRED");
    expect(await f.preferences()).toEqual([]);
    expect(await f.actor.mutation(execute, f.args)).toEqual(expect.any(String));
  });

  it("requires a fresh preview for legacy unbound pending approvals", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.ids.runId, {
      status: "awaiting_confirmation",
      approval: { executionId: f.args.executionId, status: "pending", reasons: ["Change settings"], requestedAt: Date.now() },
    }));
    await expect(f.actor.mutation(api.spectraRuns.claimConfirmation, {
      runId: f.ids.runId, executionId: f.args.executionId,
    })).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_CHANGED");
    expect(await f.preferences()).toEqual([]);
  });

  it("approves a corrected plan without reviving cancelled operations from the same attempt", async () => {
    const f = await fixture();
    await f.actor.mutation(api.spectraOperations.cancelPending, {
      runId: f.ids.runId, executionId: f.args.executionId,
    });
    const { operationIds } = await f.actor.mutation(api.spectraOperations.recordPlan, {
      runId: f.ids.runId, executionId: f.args.executionId,
      operations: [{ type: "app.command", input: { command, args: commandArgs }, requiresConfirmation: true }],
    });
    const corrected = { ...f, ids: { ...f.ids, operationId: operationIds[0] }, args: { ...f.args, operationId: operationIds[0] } };
    await startExecution(corrected);
    expect(await f.actor.mutation(execute, corrected.args)).toEqual(expect.any(String));
    expect((await f.t.run(ctx => ctx.db.get(f.ids.operationId)))?.status).toBe("cancelled");
    expect(await f.preferences()).toHaveLength(1);
  });

  it("rejects a substituted connected-file path even when the replica count is unchanged", async () => {
    const f = await fixture();
    const root = await f.actor.mutation(api.orgTree.createFolder, { name: "Connected subtree" });
    const replicaId = await f.t.run(async ctx => {
      const now = Date.now();
      const workId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: f.ids.accountId, schoolId: f.ids.schoolId, blueprintKey: "document",
        title: "Connected fixture", content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("orgNodes", {
        accountId: f.ids.accountId, schoolId: f.ids.schoolId, parentId: root.nodeId,
        kind: "work", sourceId: workId, name: "Connected fixture", orderKey: "a", createdAt: now, updatedAt: now,
      });
      const replicaId = await ctx.db.insert("workReplicas", {
        workId, accountId: f.ids.accountId, kind: "local", localResourceId: "original-file",
        relativePath: "disposable/original.docx", nativeFormat: "docx", revision: "fixture-v1", state: "current", updatedAt: now,
      });
      await ctx.db.patch(f.ids.operationId, {
        input: { command: "delete_library_items", args: { targetIds: [root.nodeId], localFileCount: 1 } },
      });
      return replicaId;
    });
    await startExecution(f);
    await f.t.run(ctx => ctx.db.patch(replicaId, { localResourceId: "other-file", relativePath: "disposable/other.docx" }));
    await expect(f.actor.mutation(execute, {
      ...f.args, expectedCommand: "delete_library_items", expectedArgs: { targetIds: [root.nodeId] },
    })).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_REQUIRED");
    expect(await f.t.run(ctx => ctx.db.get(root.nodeId))).not.toHaveProperty("deletedAt");
    expect(await f.t.run(ctx => ctx.db.query("bridgeFsRequests").collect())).toEqual([]);
  });

  it("does not show approval with a stale understated local-file consequence", async () => {
    const f = await fixture();
    const root = await f.actor.mutation(api.orgTree.createFolder, { name: "New connection" });
    await f.t.run(async ctx => {
      const now = Date.now();
      const workId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: f.ids.accountId, schoolId: f.ids.schoolId, blueprintKey: "document", title: "New connection",
        content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("orgNodes", {
        accountId: f.ids.accountId, schoolId: f.ids.schoolId, parentId: root.nodeId,
        kind: "work", sourceId: workId, name: "New connection", orderKey: "a", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("workReplicas", {
        workId, accountId: f.ids.accountId, kind: "local", relativePath: "disposable/new.docx",
        nativeFormat: "docx", revision: "fixture-v1", state: "current", updatedAt: now,
      });
      await ctx.db.patch(f.ids.operationId, {
        input: { command: "delete_library_items", args: { targetIds: [root.nodeId], localFileCount: 0 } },
      });
    });
    await expect(f.actor.mutation(api.spectraRuns.updateStatus, {
      runId: f.ids.runId, executionId: f.args.executionId,
      status: "awaiting_confirmation", approvalReasons: ["Delete zero local files"],
    })).rejects.toThrow("AI_APPLICATION_LOCAL_EFFECT_CHANGED");
    expect((await f.t.run(ctx => ctx.db.get(f.ids.runId)))?.approval).toBeUndefined();
  });

  it("leaves all targets intact after rejecting the scoped deletion", async () => {
    const f = await deletionFixture();
    await f.actor.mutation(api.spectraRuns.rejectConfirmation, {
      runId: f.ids.runId, executionId: f.args.executionId,
    });
    await expect(f.actor.mutation(execute, f.deletionArgs)).rejects.toThrow("AI_APPLICATION_OPERATION_NOT_ACTIVE");
    for (const id of [f.root.nodeId, f.child.nodeId])
      expect(await f.t.run(ctx => ctx.db.get(id))).not.toHaveProperty("deletedAt");
  });

  it("rejects a subtree beyond the approval bound instead of binding a truncated list", async () => {
    const f = await fixture();
    const root = await f.actor.mutation(api.orgTree.createFolder, { name: "Large subtree" });
    await f.t.run(async ctx => {
      for (let i = 0; i < 1_000; i += 1) await ctx.db.insert("orgNodes", {
        accountId: f.ids.accountId, schoolId: f.ids.schoolId, parentId: root.nodeId,
        kind: "folder", name: `Child ${i}`, orderKey: String(i), createdAt: Date.now(), updatedAt: Date.now(),
      });
      await ctx.db.patch(f.ids.operationId, {
        input: { command: "delete_library_items", args: { targetIds: [root.nodeId], localFileCount: 0 } },
      });
    });
    await expect(f.actor.mutation(api.spectraRuns.updateStatus, {
      runId: f.ids.runId, executionId: f.args.executionId,
      status: "awaiting_confirmation", approvalReasons: ["Delete large subtree"],
    })).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_TOO_LARGE");
    expect((await f.t.run(ctx => ctx.db.get(f.ids.runId)))?.approval).toBeUndefined();
    expect(await f.t.run(ctx => ctx.db.query("orgNodes").filter(q => q.neq(q.field("deletedAt"), undefined)).collect())).toEqual([]);
  });

  it("executes the exact confirmed operation and persists an atomic receipt", async () => {
    const f = await fixture();
    await startExecution(f);
    const result = await f.actor.mutation(execute, f.args);
    expect(typeof result).toBe("string");
    expect(await f.preferences()).toEqual([expect.objectContaining({
      accountId: f.ids.accountId, scope: "account", scopeKey: "account",
      values: expect.objectContaining({ appearance: expect.objectContaining({ density: "compact" }) }),
    })]);
    const operation = await f.t.run(ctx => ctx.db.get(f.ids.operationId));
    expect(operation?.output).toMatchObject({
      applicationWriteReceipt: { scope: expect.any(String), result },
    });
  });

  it.each(["command", "arguments"] as const)("rejects changed caller %s before writing", async changed => {
    const f = await fixture();
    await startExecution(f);
    await expect(f.actor.mutation(execute, {
      ...f.args,
      ...(changed === "command" ? { expectedCommand: "delete_library_items" } : {
        expectedArgs: { patch: { appearance: { density: "comfortable" } } },
      }),
    })).rejects.toThrow("AI_APPLICATION_OPERATION_SCOPE_MISMATCH");
    expect(await f.preferences()).toEqual([]);
  });

  it("does not let a changed persisted operation borrow an earlier exact approval", async () => {
    const f = await fixture();
    await startExecution(f);
    const changedArgs = { patch: { appearance: { density: "comfortable" } } };
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, { input: { command, args: changedArgs } }));
    await expect(f.actor.mutation(execute, { ...f.args, expectedArgs: changedArgs }))
      .rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_REQUIRED");
    expect(await f.preferences()).toEqual([]);
  });

  it("cannot bypass mandatory settings approval with requiresConfirmation=false", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, { requiresConfirmation: false }));
    await startExecution(f, false);
    await expect(f.actor.mutation(execute, f.args)).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_REQUIRED");
    expect(await f.preferences()).toEqual([]);
  });

  it("rechecks target ownership after approval before deleting a Library node", async () => {
    const f = await fixture();
    const folder = await f.actor.mutation(api.orgTree.createFolder, { name: "Owned at approval" });
    const targetArgs = { targetIds: [folder.nodeId], localFileCount: 0 };
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, { input: { command: "delete_library_items", args: targetArgs } }));
    await startExecution(f);
    await f.t.run(ctx => ctx.db.patch(folder.nodeId, { accountId: f.ids.otherAccountId }));
    await expect(f.actor.mutation(execute, {
      ...f.args, expectedCommand: "delete_library_items", expectedArgs: { targetIds: [folder.nodeId] },
    })).rejects.toThrow();
    expect(await f.t.run(ctx => ctx.db.get(folder.nodeId))).not.toHaveProperty("deletedAt");
  });

  it.each(["executed", "stale"] as const)("binds a derived target to its %s same-run creation receipt", async producerState => {
    const f = await fixture();
    const seeded = await f.t.run(async ctx => {
      const now = Date.now();
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: f.ids.accountId, schoolId: f.ids.schoolId, blueprintKey: "document", title: "Derived fixture",
        content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now,
      });
      const grantId = await ctx.db.insert("accessGrants", {
        schoolId: f.ids.schoolId, resourceType: "artifact", resourceId: artifactId,
        principalType: "account", principalId: f.ids.otherAccountId, level: "read", capabilities: ["read"],
        source: "direct", createdByAccountId: f.ids.accountId, createdAt: now, updatedAt: now,
      });
      await ctx.db.patch(f.ids.operationId, {
        type: "artifact.create", input: {}, requiresConfirmation: false,
      });
      const consumerArgs = { resourceType: "artifact", resourceId: "@created:0", action: "revoke", grantId };
      const consumerId = await ctx.db.insert("spectraOperations", {
        runId: f.ids.runId, executionId: f.args.executionId, actorType: "ai", type: "app.command", status: "proposed",
        input: { command: "change_sharing", args: consumerArgs }, affected: [], requiresConfirmation: true, createdAt: now,
      });
      return { artifactId, grantId, consumerArgs, consumerId };
    });
    await startExecution({ ...f, ids: { ...f.ids, operationId: seeded.consumerId } });
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, {
      status: "executed", output: { artifactId: seeded.artifactId },
      ...(producerState === "stale" ? { executionId: "old-attempt" } : {}),
    }));
    const input = { ...f.args, operationId: seeded.consumerId, expectedCommand: "change_sharing", expectedArgs: { ...seeded.consumerArgs, resourceId: seeded.artifactId } };
    if (producerState === "stale") {
      await expect(f.actor.mutation(execute, input)).rejects.toThrow("AI_APPLICATION_DEPENDENCY_NOT_EXECUTED");
      expect(await f.t.run(ctx => ctx.db.get(seeded.grantId))).not.toHaveProperty("revokedAt");
    } else {
      expect(await f.actor.mutation(execute, input)).toMatchObject({ grantId: seeded.grantId });
      expect(await f.t.run(ctx => ctx.db.get(seeded.grantId))).toHaveProperty("revokedAt");
    }
  });

  it.each(["missing", "pending", "rejected", "wrong-attempt", "unbound"] as const)(
    "rejects %s approval even with an executing operation", async approval => {
      const f = await fixture();
      await startExecution(f);
      await f.t.run(async ctx => {
        const run = (await ctx.db.get(f.ids.runId))!;
        if (approval === "missing") await ctx.db.patch(run._id, { approval: undefined });
        else if (approval === "unbound") await ctx.db.patch(f.ids.operationId, { output: {} });
        else await ctx.db.patch(run._id, {
          approval: {
            ...run.approval!,
            status: approval === "wrong-attempt" ? "accepted" : approval,
            executionId: approval === "wrong-attempt" ? "old-attempt" : f.args.executionId,
          },
        });
      });
      await expect(f.actor.mutation(execute, f.args)).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_REQUIRED");
      expect(await f.preferences()).toEqual([]);
    },
  );

  it("rejects another authenticated actor before exposing a result", async () => {
    const f = await fixture();
    await startExecution(f);
    await expect(f.other.mutation(execute, f.args)).rejects.toThrow("AI_APPLICATION_OPERATION_NOT_OWNED");
    expect(await f.preferences()).toEqual([]);
  });

  it.each(["cancelled", "failed"] as const)("does not write for a %s run", async status => {
    const f = await fixture();
    await startExecution(f);
    await f.t.run(ctx => ctx.db.patch(f.ids.runId, { status }));
    await expect(f.actor.mutation(execute, f.args)).rejects.toThrow("AI_APPLICATION_OPERATION_NOT_ACTIVE");
    expect(await f.preferences()).toEqual([]);
  });

  it("rejects an operation from a superseded attempt", async () => {
    const f = await fixture();
    await startExecution(f);
    await f.t.run(ctx => ctx.db.patch(f.ids.runId, { executionId: "scope-attempt-2" }));
    await expect(f.actor.mutation(execute, f.args)).rejects.toThrow("AI_APPLICATION_ATTEMPT_SUPERSEDED");
    expect(await f.preferences()).toEqual([]);
  });

  it("does not write with an unclaimed operation", async () => {
    const f = await fixture();
    await startExecution(f);
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, { status: "proposed" }));
    await expect(f.actor.mutation(execute, f.args)).rejects.toThrow("AI_APPLICATION_OPERATION_NOT_ACTIVE");
    expect(await f.preferences()).toEqual([]);
  });

  it("replays the committed receipt after completion and Stop without repeating the effect", async () => {
    const f = await fixture();
    await startExecution(f);
    const result = await f.actor.mutation(execute, f.args);
    await f.actor.mutation(api.spectraOperations.markExecuted, {
      operationId: f.ids.operationId, executionId: f.args.executionId, output: { canonicalSaved: true }, affected: [],
    });
    // A later manual preference is independent of the saved AI receipt.
    await f.actor.mutation(api.accountPreferences.writeLayer, {
      scope: "account", scopeKey: "account", values: { appearance: { density: "comfortable" } },
    });
    await f.t.run(ctx => ctx.db.patch(f.ids.runId, { status: "cancelled" }));
    expect(await f.actor.mutation(execute, f.args)).toEqual(result);
    expect(await f.preferences()).toEqual([expect.objectContaining({
      values: expect.objectContaining({ appearance: expect.objectContaining({ density: "comfortable" }) }),
    })]);
    await expect(f.other.mutation(execute, f.args)).rejects.toThrow("AI_APPLICATION_OPERATION_NOT_OWNED");
  });

  it("does not repeat the effect if a failed receipt status later retries", async () => {
    const f = await fixture();
    await startExecution(f);
    const result = await f.actor.mutation(execute, f.args);
    await f.actor.mutation(api.spectraOperations.markFailed, {
      operationId: f.ids.operationId, executionId: f.args.executionId, error: "Reply lost after committed write",
    });
    await f.actor.mutation(api.accountPreferences.writeLayer, {
      scope: "account", scopeKey: "account", values: { appearance: { density: "comfortable" } },
    });
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, { status: "executing" }));
    expect(await f.actor.mutation(execute, f.args)).toEqual(result);
    expect(await f.preferences()).toEqual([expect.objectContaining({
      values: expect.objectContaining({ appearance: expect.objectContaining({ density: "comfortable" }) }),
    })]);
  });

  it("preserves an already committed application receipt when failure reporting arrives", async () => {
    const f = await fixture();
    await startExecution(f);
    const receipt = await f.t.run(async ctx => {
      const operation = (await ctx.db.get(f.ids.operationId))!;
      const output = operation.output as Record<string, unknown>;
      const committed = { scope: output.approvedApplicationScope, result: "saved-fixture-result" };
      await ctx.db.patch(operation._id, { output: { ...output, applicationWriteReceipt: committed } });
      return committed;
    });
    await f.actor.mutation(api.spectraOperations.markFailed, {
      operationId: f.ids.operationId, executionId: f.args.executionId, error: "Reply lost after commit",
    });
    expect((await f.t.run(ctx => ctx.db.get(f.ids.operationId)))?.output)
      .toMatchObject({ applicationWriteReceipt: receipt });
  });

  it("does not duplicate an unconfirmed folder action after committed-write failure reporting", async () => {
    const f = await fixture();
    const folderArgs = { action: "create_folder", targetIds: [], name: "Scope fixture folder" };
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, {
      input: { command: "organize_library", args: folderArgs }, requiresConfirmation: false,
    }));
    await startExecution(f, false);
    const input = { ...f.args, expectedCommand: "organize_library", expectedArgs: folderArgs };
    await f.actor.mutation(execute, input);
    await f.actor.mutation(api.spectraOperations.markFailed, {
      operationId: f.ids.operationId, executionId: f.args.executionId, error: "Reply lost after folder commit",
    });
    await f.t.run(ctx => ctx.db.patch(f.ids.operationId, { status: "executing" }));
    await f.actor.mutation(execute, input);
    const folders = await f.t.run(ctx => ctx.db.query("orgNodes").collect());
    expect(folders.filter(node => node.kind === "folder" && node.name === folderArgs.name)).toHaveLength(1);
  });
});

