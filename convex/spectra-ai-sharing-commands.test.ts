/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const execute = makeFunctionReference<"mutation">("spectraApplicationWrites:execute");
const owner = { subject: "ai-share-owner", email: "ai-share-owner@example.test", emailVerified: true };
const tokenHash = createHash("sha256").update("server-derived-token").digest("hex");

async function seed() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Sharing", slug: `ai-sharing-${crypto.randomUUID()}`, verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accounts = [];
    for (const name of ["ai-share-owner", "ai-share-friend"]) {
      const accountId = await ctx.db.insert("accounts", { clerkId: name, email: `${name}@example.test`, emailVerified: true, name, status: "active", createdAt: now, updatedAt: now });
      await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
      accounts.push(accountId);
    }
    const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accounts[0]!, schoolId, blueprintKey: "document", title: "Essay", content: { blocks: [] }, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now });
    const runId = await ctx.db.insert("spectraAiRuns", { ownerAccountId: accounts[0]!, schoolId, sourceSurface: "artifact", artifactId, status: "running", phase: "planning", userPrompt: "Share it.", executionId: "share-attempt", createdAt: now, updatedAt: now });
    return { artifactId, runId, friendId: accounts[1]! };
  });
  const user = t.withIdentity(owner);
  /** Record the step, have the user approve it, and run it as the harness does. */
  let attempt = 0;
  const run = async (args: Record<string, unknown>, derived?: { publicLinkTokenHash: string }) => {
    const executionId = `share-attempt-${++attempt}`;
    const input = { resourceType: "artifact", resourceId: ids.artifactId, ...args };
    const operationId = await t.run(async (ctx) => {
      await ctx.db.patch(ids.runId, { status: "running", phase: "planning", approval: undefined, executionId });
      return ctx.db.insert("spectraOperations", {
        runId: ids.runId, executionId, actorType: "ai", type: "app.command", status: "proposed",
        input: { command: "change_sharing", args: input }, affected: [], requiresConfirmation: true, createdAt: Date.now(),
      });
    });
    await user.mutation(api.spectraRuns.updateStatus, { runId: ids.runId, executionId, status: "awaiting_confirmation", approvalReasons: ["Share"] });
    await user.mutation(api.spectraRuns.claimConfirmation, { runId: ids.runId, executionId });
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.runId, { status: "running", phase: "applying" });
      await ctx.db.patch(operationId, { status: "executing" });
    });
    try {
      const result = await user.mutation(execute, { runId: ids.runId, executionId, operationId, expectedCommand: "change_sharing", expectedArgs: input, ...(derived ? { derived } : {}) });
      await t.run((ctx) => ctx.db.patch(operationId, { status: "executed" }));
      return { result, operationId };
    } catch (error) {
      await t.run((ctx) => ctx.db.patch(operationId, { status: "failed" }));
      throw error;
    }
  };
  return { t, ids, user, run };
}

describe("Spectra AI sharing and publishing commands", () => {
  it("makes a public link from a server-derived hash and keeps only the link id in the receipt", async () => {
    const { t, ids, user, run } = await seed();
    await expect(run({ action: "create_public_link" })).rejects.toThrow("AI_PUBLIC_LINK_TOKEN_REQUIRED");
    const { result, operationId } = await run({ action: "create_public_link", expiresInDays: 7 }, { publicLinkTokenHash: tokenHash });
    expect(result).toMatchObject({ level: "read", linkId: expect.any(String) });
    const link = await t.run((ctx) => ctx.db.query("publicLinks").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique());
    expect(link).toMatchObject({ resourceId: ids.artifactId, level: "read" });
    expect(link!.expiresAt! - Date.now()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    const operation = await t.run((ctx) => ctx.db.get(operationId));
    expect(JSON.stringify(operation)).not.toContain(tokenHash);

    // Share names the step that made it, so the owner can copy it again later
    // (a scheduled run finishes with nobody there to see the notice).
    const userHash = createHash("sha256").update("user-made-token").digest("hex");
    await user.mutation(api.authority.createPublicLink, { resourceType: "artifact", resourceId: ids.artifactId, tokenHash: userHash });
    const listed = await user.query(api.authority.listPublicLinks, { resourceType: "artifact", resourceId: ids.artifactId });
    expect(listed.find((entry) => entry.linkId === link!._id)?.madeBySpectra).toEqual({ runId: ids.runId, operationId });
    expect(listed.filter((entry) => "madeBySpectra" in entry)).toHaveLength(1);

    await run({ action: "revoke_public_link", linkId: link!._id });
    expect((await t.run((ctx) => ctx.db.get(link!._id)))?.revokedAt).toEqual(expect.any(Number));
  });

  it("withdraws a pending invitation through the share dialog's mutation", async () => {
    const { t, ids, user, run } = await seed();
    await user.mutation(api.authority.invite, { resourceType: "artifact", resourceId: ids.artifactId, inviteeAccountId: ids.friendId, level: "read" });
    const invitation = await t.run((ctx) => ctx.db.query("shareInvitations").collect().then((rows) => rows[0]!));
    expect(invitation.status).toBe("pending");
    await run({ action: "withdraw_invitation", invitationId: invitation._id });
    expect((await t.run((ctx) => ctx.db.get(invitation._id)))?.status).toBe("revoked");
  });

  it.each([
    ["a public link", "change_sharing", { resourceType: "artifact", action: "create_public_link" }],
    ["a code build", "publish_code", { action: "publish" }],
  ] as const)("asks for %s under publishing outside Spectra, not under sharing", async (_label, command, extra) => {
    const { t, ids, user } = await seed();
    const executionId = "share-attempt";
    const args = { ...extra, ...(command === "change_sharing" ? { resourceId: ids.artifactId } : { artifactId: ids.artifactId }) };
    const operationId = await t.run((ctx) => ctx.db.insert("spectraOperations", {
      runId: ids.runId, executionId, actorType: "ai", type: "app.command", status: "proposed", requiresConfirmation: true, affected: [], createdAt: Date.now(),
      input: { command, args },
    }));
    await user.mutation(api.spectraHarness.recordToolOperations, { runId: ids.runId, executionId, toolCallId: "call-link", operationIds: [operationId] });
    const allow = (categories: string[]) => user.mutation(api.accountPreferences.writeLayer, { scope: "account", scopeKey: "account", values: { ai: { permissionAllow: categories } } });
    await allow(["sharing"]);
    await expect(user.mutation(api.spectraHarness.ensureApproved, { runId: ids.runId, executionId, toolCallId: "call-link" })).rejects.toThrow("AI_PERMISSION_REQUIRED");
    await allow(["external_send"]);
    await user.mutation(api.spectraHarness.ensureApproved, { runId: ids.runId, executionId, toolCallId: "call-link" });
    expect((await t.run((ctx) => ctx.db.get(ids.runId)))?.approval?.status).toBe("accepted");
  });

  it.each([
    ["manage_comment", { action: "delete", commentId: "c1" }, "permanent_delete"],
    ["set_school_sync_mode", { kind: "grades", mode: "off" }, "managebac"],
    ["manage_class_workspaces", { action: "create", recordIds: ["r1"] }, "managebac"],
    ["control_device", { action: "remove_folder", grantId: "g1" }, "settings"],
  ] as const)("lets \"Always allow\" stand in for asking before %s %j only under %s", async (command, args, category) => {
    const { t, ids, user } = await seed();
    const executionId = "share-attempt";
    const operationId = await t.run((ctx) => ctx.db.insert("spectraOperations", {
      runId: ids.runId, executionId, actorType: "ai", type: "app.command", status: "proposed", requiresConfirmation: true, affected: [], createdAt: Date.now(),
      input: { command, args: { artifactId: ids.artifactId, ...args } },
    }));
    await user.mutation(api.spectraHarness.recordToolOperations, { runId: ids.runId, executionId, toolCallId: "call-ask", operationIds: [operationId] });
    const allow = (categories: string[]) => user.mutation(api.accountPreferences.writeLayer, { scope: "account", scopeKey: "account", values: { ai: { permissionAllow: categories } } });
    await allow(["sharing"]);
    await expect(user.mutation(api.spectraHarness.ensureApproved, { runId: ids.runId, executionId, toolCallId: "call-ask" })).rejects.toThrow("AI_PERMISSION_REQUIRED");
    await allow([category]);
    await user.mutation(api.spectraHarness.ensureApproved, { runId: ids.runId, executionId, toolCallId: "call-ask" });
    expect((await t.run((ctx) => ctx.db.get(ids.runId)))?.approval?.status).toBe("accepted");
  });
});

describe("Spectra AI answering invitations", () => {
  it("accepts and declines an invitation sent to the user only with their approval", async () => {
    const { t, ids } = await seed();
    // Accepting files the shared work in the user's Library tree.
    for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"]) aggregateTest.register(t, name);
    const friend = t.withIdentity({ subject: "ai-share-friend", email: "ai-share-friend@example.test", emailVerified: true });
    const { runId, accept, decline } = await t.run(async (ctx) => {
      const now = Date.now();
      const artifact = (await ctx.db.get(ids.artifactId))!;
      const schoolId = artifact.schoolId!;
      const invite = () => ctx.db.insert("shareInvitations", {
        schoolId, resourceType: "artifact", resourceId: ids.artifactId, inviterAccountId: artifact.ownerAccountId,
        inviteeAccountId: ids.friendId, level: "modify", status: "pending", createdAt: now, updatedAt: now,
      });
      const runId = await ctx.db.insert("spectraAiRuns", { ownerAccountId: ids.friendId, schoolId, sourceSurface: "chat", status: "running", phase: "planning", userPrompt: "Accept Ana's invite.", executionId: "answer-0", createdAt: now, updatedAt: now });
      return { runId, accept: await invite(), decline: await invite() };
    });
    let attempt = 0;
    const answer = async (args: Record<string, unknown>, asks: boolean) => {
      const executionId = `answer-${++attempt}`;
      const operationId = await t.run(async (ctx) => {
        await ctx.db.patch(runId, { status: "running", phase: "planning", approval: undefined, executionId });
        return ctx.db.insert("spectraOperations", {
          runId, executionId, actorType: "ai", type: "app.command", status: "proposed",
          input: { command: "respond_share_invitation", args }, affected: [], requiresConfirmation: asks, createdAt: Date.now(),
        });
      });
      if (asks) {
        await friend.mutation(api.spectraRuns.updateStatus, { runId, executionId, status: "awaiting_confirmation", approvalReasons: ["Accept"] });
        await friend.mutation(api.spectraRuns.claimConfirmation, { runId, executionId });
      }
      await t.run(async (ctx) => {
        await ctx.db.patch(runId, { status: "running", phase: "applying" });
        await ctx.db.patch(operationId, { status: "executing" });
      });
      return friend.mutation(execute, { runId, executionId, operationId, expectedCommand: "respond_share_invitation", expectedArgs: args });
    };

    await expect(answer({ invitationId: accept, response: "accept" }, false)).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_REQUIRED");
    expect(await answer({ invitationId: accept, response: "accept" }, true)).toMatchObject({ level: "modify", resourceId: ids.artifactId });
    expect(await answer({ invitationId: decline, response: "decline" }, true)).toMatchObject({ status: "declined" });
    const rows = await t.run(async (ctx) => [await ctx.db.get(accept), await ctx.db.get(decline)]);
    expect(rows.map((row) => row?.status)).toEqual(["accepted", "declined"]);
    expect(rows[0]?.grantId).toBeTruthy();
  });
});
