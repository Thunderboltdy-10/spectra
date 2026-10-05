/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/*
 * The application commands that closed the AI reach gaps: each runs through
 * spectraApplicationWrites:execute into the same mutation the user's own
 * control calls, and replays its receipt instead of writing twice.
 */

const modules = import.meta.glob("./**/*.ts");
const execute = makeFunctionReference<"mutation">("spectraApplicationWrites:execute");

async function fixture() {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"])
    aggregateTest.register(t, name);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "AI reach", slug: "ai-reach", verifiedDomains: [], status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: "ai-reach", email: "reach@example.test", emailVerified: true, name: "Reach student", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { schoolId, accountId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const runId = await ctx.db.insert("spectraAiRuns", { ownerAccountId: accountId, schoolId, sourceSurface: "chat", userPrompt: "Tidy up", status: "running", phase: "applying", executionId: "attempt", createdAt: now, updatedAt: now });
    return { schoolId, accountId, runId };
  });
  const actor = t.withIdentity({ subject: "ai-reach", email: "reach@example.test", emailVerified: true });
  const operation = async (command: string, args: Record<string, unknown>) => {
    const operationId = await t.run((ctx) => ctx.db.insert("spectraOperations", { runId: ids.runId, executionId: "attempt", actorType: "ai", type: "app.command", status: "executing", requiresConfirmation: false, input: { command, args }, affected: [], createdAt: Date.now() }));
    return { runId: ids.runId, executionId: "attempt", operationId, expectedCommand: command, expectedArgs: args };
  };
  return { t, ids, actor, operation };
}

describe("AI reach through application commands", () => {
  it("restores trashed items and pins one, as the library's own controls do", async () => {
    const f = await fixture();
    const folder = await f.actor.mutation(api.orgTree.createFolder, { name: "Sources" }) as { nodeId: Id<"orgNodes"> };
    await f.actor.mutation(api.orgTree.trash, { nodeIds: [folder.nodeId] });
    expect((await f.t.run((ctx) => ctx.db.get(folder.nodeId)))?.deletedAt).toBeDefined();

    const restore = await f.operation("restore_library_items", { targetIds: [folder.nodeId] });
    const restored = await f.actor.mutation(execute, restore);
    expect(await f.actor.mutation(execute, restore)).toEqual(restored);
    expect((await f.t.run((ctx) => ctx.db.get(folder.nodeId)))?.deletedAt).toBeUndefined();

    await f.actor.mutation(execute, await f.operation("pin_library_item", { targetId: folder.nodeId, pinned: true }));
    expect((await f.t.run((ctx) => ctx.db.get(folder.nodeId)))?.pinned).toBe(true);
  });

  it("creates a workspace", async () => {
    const f = await fixture();
    const workspaceId = await f.actor.mutation(execute, await f.operation("organize_library", { action: "create_workspace", name: "Physics" })) as Id<"spectraWorkspaces">;
    expect((await f.t.run((ctx) => ctx.db.get(workspaceId)))?.title).toBe("Physics");
  });

  it("renames, pins and archives a conversation", async () => {
    const f = await fixture();
    const threadId = await f.actor.mutation(api.spectraThreads.create, { origin: "chat" }) as Id<"spectraThreads">;
    await f.actor.mutation(execute, await f.operation("manage_conversation", { threadId, title: "Biology revision", pinned: true, archived: true }));
    expect(await f.t.run((ctx) => ctx.db.get(threadId))).toMatchObject({ title: "Biology revision", pinned: true, status: "archived" });
  });

  it("completes a work block and removes an event with the calendar's revision checks", async () => {
    const f = await fixture();
    const base = { ownerAccountId: f.ids.accountId, schoolId: f.ids.schoolId, allDay: false, timezone: "Europe/Madrid", timePrecision: "exact" as const, status: "active" as const, sourceLocked: false, linkedArtifactIds: [], revision: 3, createdBy: "human" as const, createdAt: Date.now(), updatedAt: Date.now(), startAt: 1_000, endAt: 2_000 };
    const blockId = await f.t.run((ctx) => ctx.db.insert("calendarItems", { ...base, kind: "scheduled_work_block", title: "Revise" }));
    const eventId = await f.t.run((ctx) => ctx.db.insert("calendarItems", { ...base, kind: "personal_event", title: "Football" }));

    await expect(f.actor.mutation(execute, await f.operation("complete_calendar_block", { itemId: blockId, expectedRevision: 2 }))).rejects.toThrow("CALENDAR_GESTURE_CONFLICT");
    await f.actor.mutation(execute, await f.operation("complete_calendar_block", { itemId: blockId, expectedRevision: 3 }));
    await f.actor.mutation(execute, await f.operation("remove_calendar_event", { itemId: eventId }));
    const items = await f.t.run(async (ctx) => [await ctx.db.get(blockId), await ctx.db.get(eventId)]);
    expect(items.map((item) => item?.status)).toEqual(["completed", "removed"]);
  });

  it("asks before changing what syncs from school or the class workspaces", async () => {
    const f = await fixture();
    await expect(f.actor.mutation(execute, await f.operation("set_school_sync_mode", { kind: "grades", mode: "manual" }))).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_REQUIRED");
    await expect(f.actor.mutation(execute, await f.operation("manage_class_workspaces", { action: "create", recordIds: ["record"] }))).rejects.toThrow("AI_APPLICATION_APPROVAL_SCOPE_REQUIRED");
  });
});
