import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { mutation } from "./functions";
import type { MutationCtx } from "./_generated/server";
import { findPrimaryNode } from "./orgTreeShared";
import { getAuthenticatedActor } from "./identityShared";
import type { Doc, Id } from "./_generated/dataModel";
import { commandHasNothingToUndo, type RunUndoCounts } from "../shared/run-undo";
import { sameTopicText } from "./spectraMemory";
import { isTerminalRunStatus, requireCurrentExecution } from "./spectraRunLifecycle";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => (value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {});
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

/**
 * The state a write is about to replace, kept beside its receipt. Only what its
 * result cannot give back later: a move needs the old time, a rename the old name.
 */
export async function undoStateFor(ctx: MutationCtx, accountId: Id<"accounts">, command: string, args: Row): Promise<Row | undefined> {
  const calendarItem = async () => {
    const id = ctx.db.normalizeId("calendarItems", String(args.itemId ?? ""));
    const item = id ? await ctx.db.get(id) : null;
    return item?.ownerAccountId === accountId ? item : null;
  };
  switch (command) {
    case "move_calendar_block":
    case "resize_calendar_block": {
      const item = await calendarItem();
      return item ? { startAt: item.startAt, endAt: item.endAt, revision: item.revision } : undefined;
    }
    case "complete_calendar_block": {
      const item = await calendarItem();
      return item ? { revision: item.revision } : undefined;
    }
    case "remove_calendar_event": {
      const item = await calendarItem();
      if (!item) return undefined;
      const itemIds = [String(item._id)];
      if (args.andFollowing === true && item.seriesId) {
        const series = await ctx.db.query("calendarItems")
          .withIndex("by_account_series", (q) => q.eq("ownerAccountId", accountId).eq("seriesId", item.seriesId))
          .take(400);
        for (const other of series)
          if (other._id !== item._id && other.status === "active" && (other.startAt ?? 0) >= (item.startAt ?? 0))
            itemIds.push(String(other._id));
      }
      return { itemIds };
    }
    case "manage_comment": {
      if (args.action !== "edit") return undefined;
      const id = ctx.db.normalizeId("artifactComments", String(args.commentId ?? ""));
      const comment = id ? await ctx.db.get(id) : null;
      return comment ? { body: comment.body } : undefined;
    }
    case "organize_library": {
      const nodes = await Promise.all(strings(args.targetIds).map(async (value) => {
        const id = ctx.db.normalizeId("orgNodes", value);
        return id ? await ctx.db.get(id) : null;
      }));
      if (args.action === "rename") return nodes[0] ? { name: nodes[0].name } : undefined;
      if (args.action === "move")
        return { parents: nodes.flatMap((node) => (node ? [{ nodeId: String(node._id), parentId: node.parentId ?? null }] : [])) };
      return undefined;
    }
    case "pin_library_item": {
      const id = ctx.db.normalizeId("orgNodes", String(args.targetId ?? ""));
      const node = id ? await ctx.db.get(id) : null;
      return node ? { pinned: node.pinned === true } : undefined;
    }
    case "manage_conversation": {
      const id = ctx.db.normalizeId("spectraThreads", String(args.threadId ?? ""));
      const thread = id ? await ctx.db.get(id) : null;
      return thread
        ? { title: thread.title, pinned: Boolean(thread.pinned), workspaceId: thread.workspaceId ?? null, status: thread.status === "archived" ? "archived" : "active" }
        : undefined;
    }
    case "change_spectra_settings": {
      const layer = await ctx.db.query("accountPreferences")
        .withIndex("by_account_scope_key", (q) => q.eq("accountId", accountId).eq("scope", "account").eq("scopeKey", "account"))
        .unique();
      return { values: layer?.values ?? null };
    }
    case "change_sync_policy": {
      const items = await Promise.all(strings(args.targetIds).map(async (itemId) => {
        const existing = await ctx.db.query("syncPolicies")
          .withIndex("by_account_scope", (q) => q.eq("accountId", accountId).eq("scopeKind", "item").eq("scopeId", itemId))
          .unique();
        return { itemId, existed: Boolean(existing) };
      }));
      return { items };
    }
    default:
      return undefined;
  }
}

type Inverse =
  | { kind: keyof RunUndoCounts; name: string; args: Row }
  | { kind: keyof RunUndoCounts; many: Array<{ name: string; args: Row }> };

function inverseFor(command: string, args: Row, result: Row, state: Row, runId: string, operationId: string): Inverse | { left: string } | null {
  const itemId = result.id ?? result.itemId ?? args.itemId;
  switch (command) {
    case "create_calendar_personal_event":
      return { kind: "events", name: "calendar:removePersonalItem", args: { itemId, andFollowing: true } };
    case "schedule_calendar_task":
      return { kind: "events", name: "calendar:removePersonalItem", args: { itemId } };
    case "move_calendar_block":
    case "resize_calendar_block":
      if (typeof state.revision !== "number") return { left: "a calendar block's time" };
      return { kind: "events", name: "calendar:moveWorkBlock", args: { itemId, startAt: state.startAt, endAt: state.endAt, expectedRevision: state.revision + 1 } };
    case "complete_calendar_block":
      if (typeof state.revision !== "number") return { left: "a completed calendar block" };
      return { kind: "events", name: "calendar:completeWorkBlock", args: { itemId, expectedRevision: state.revision + 1, done: false } };
    case "remove_calendar_event":
      return { kind: "events", many: strings(state.itemIds).map((id) => ({ name: "spectraRunUndo:bringBackCalendarItem", args: { itemId: id } })) };
    case "add_comment":
      return { kind: "comments", name: "artifactComments:remove", args: { commentId: result.commentId } };
    case "manage_comment":
      if (args.action === "resolve") return { kind: "comments", name: "artifactComments:setResolved", args: { commentId: args.commentId, resolved: false } };
      if (args.action === "reopen") return { kind: "comments", name: "artifactComments:setResolved", args: { commentId: args.commentId, resolved: true } };
      if (args.action === "edit" && typeof state.body === "string") return { kind: "comments", name: "artifactComments:updateBody", args: { commentId: args.commentId, body: state.body } };
      return { left: "a deleted comment" };
    case "organize_library":
      switch (args.action) {
        case "create_folder":
        case "link":
          return { kind: "library", name: "orgTree:trash", args: { nodeIds: [result.nodeId] } };
        case "create_workspace":
          return { kind: "library", name: "spectraWorkspaces:archive", args: { workspaceId: result } };
        case "rename":
          return typeof state.name === "string"
            ? { kind: "library", name: "orgTree:rename", args: { nodeId: strings(args.targetIds)[0], name: state.name } }
            : { left: "a renamed Library item" };
        case "move":
          return {
            kind: "library",
            many: (Array.isArray(state.parents) ? state.parents : []).map((entry) => {
              const parent = row(entry);
              return { name: "orgTree:move", args: { nodeIds: [parent.nodeId], parentId: parent.parentId ?? null } };
            }),
          };
        default:
          return { left: "a Library change" };
      }
    case "delete_library_items":
      return { kind: "library", name: "orgTree:restore", args: { nodeIds: strings(args.targetIds) } };
    case "restore_library_items":
      return { kind: "library", name: "orgTree:trash", args: { nodeIds: strings(args.targetIds) } };
    case "pin_library_item":
      return { kind: "library", name: "orgTree:setPinned", args: { nodeId: args.targetId, pinned: state.pinned === true } };
    case "manage_conversation":
      return {
        kind: "library",
        name: "spectraThreads:update",
        args: { threadId: args.threadId, title: state.title, pinned: state.pinned, workspaceId: state.workspaceId, status: state.status },
      };
    case "change_spectra_settings":
      return { kind: "settings", name: "spectraRunUndo:restoreSettingsLayer", args: { values: state.values ?? null } };
    case "change_sync_policy":
      return {
        kind: "settings",
        many: (Array.isArray(state.items) ? state.items : [])
          .map(row)
          .filter((item) => item.existed === false)
          .map((item) => ({
            name: "syncPolicy:revert",
            args: { scopeKind: "item", scopeId: item.itemId, idempotencyKey: `undo:${runId}:${operationId}:${String(item.itemId)}`, actorKind: "user" },
          })),
      };
    case "change_sharing":
      if (args.action === "create_public_link") return { kind: "sharing", name: "authority:revokePublicLink", args: { linkId: result.linkId } };
      if (args.action === "invite") return { kind: "sharing", name: "authority:revokePendingInvitation", args: { invitationId: result.invitationId } };
      return { left: "a sharing change" };
    default:
      return commandHasNothingToUndo(command) ? null : { left: command.replaceAll("_", " ") };
  }
}

/** A person's own edit after the run wins: their work is never thrown away by an undo. */
async function editedAfter(ctx: MutationCtx, artifactId: Id<"spectraArtifacts">, cutoff: number) {
  const versions = await ctx.db.query("spectraArtifactVersions")
    .withIndex("by_artifact_created", (q) => q.eq("artifactId", artifactId))
    .order("desc")
    .take(12);
  return versions.some((version) => version.createdAt > cutoff && version.source !== "ai" && version.source !== "restore" && version.source !== "checkpoint");
}

async function trashCreatedWork(ctx: MutationCtx, accountId: Id<"accounts">, artifact: Doc<"spectraArtifacts">) {
  const node = await findPrimaryNode(ctx, accountId, "work", String(artifact._id));
  if (!node) throw new Error("UNDO_WORK_NOT_FILED");
  await ctx.runMutation(makeFunctionReference<"mutation">("orgTree:trash"), { nodeIds: [node._id] });
}

/**
 * What a run wrote to the memory files goes back too, newest first, and only where
 * the text is still what the run left. Anything changed since is the person's now.
 */
async function reverseMemory(ctx: MutationCtx, accountId: Id<"accounts">, runId: string) {
  const changes = await ctx.db.query("spectraMemoryChanges").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
  if (!changes.length) return { reversed: 0, keptAny: false };
  const head = await ctx.db.query("spectraMemoryHeads").withIndex("by_account", (q) => q.eq("accountId", accountId)).unique();
  const now = Date.now();
  let about = head?.about ?? "";
  let preferences = head?.preferences ?? "";
  let topics = head?.topics ?? [];
  let reversed = 0;
  let keptAny = false;
  for (const change of [...changes].reverse()) {
    if (change.accountId !== accountId) continue;
    if (change.file !== "topic") {
      const current = change.file === "about" ? about : preferences;
      if (head && current === change.after) {
        if (change.file === "about") about = String(change.before ?? "");
        else preferences = String(change.before ?? "");
        reversed += 1;
      } else keptAny = true;
    } else {
      const slug = change.slug ?? "";
      const existing = await ctx.db.query("spectraMemoryTopics").withIndex("by_account_slug", (q) => q.eq("accountId", accountId).eq("slug", slug)).unique();
      if (!head || !sameTopicText(existing, change.after)) {
        keptAny = true;
      } else {
        const before = change.before as { title: string; summary: string; content: string } | null;
        if (!before) {
          if (existing) await ctx.db.delete(existing._id);
          topics = topics.filter((entry) => entry.slug !== slug);
        } else {
          if (existing) await ctx.db.patch(existing._id, { ...before, updatedAt: now });
          else await ctx.db.insert("spectraMemoryTopics", { accountId, slug, ...before, updatedAt: now });
          const entry = { slug, title: before.title, summary: before.summary, chars: before.content.length, updatedAt: now };
          topics = [entry, ...topics.filter((candidate) => candidate.slug !== slug)];
        }
        reversed += 1;
      }
    }
    await ctx.db.delete(change._id);
  }
  if (head && reversed) await ctx.db.patch(head._id, { about, preferences, topics, updatedAt: now });
  return { reversed, keptAny };
}

/**
 * Reverses a run's writes, newest first. Each one stands alone: one that no longer
 * applies is reported and the rest still go back. Edited works are restored by the
 * caller through the live document, which is why they are not here.
 */
export const reverseWrites = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    /** Works kept on a computer that were edited since: only Bridge can tell, so the caller says. */
    keepWorks: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerAccountId !== actor.accountId || run.schoolId !== actor.schoolId) throw new Error("AI run not found");
    requireCurrentExecution(run.executionId, args.executionId);
    if (!isTerminalRunStatus(run.status)) throw new Error("Undo is available after Spectra finishes this run.");
    const operations = await ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
    const counts: Partial<RunUndoCounts> = {};
    const count = (kind: keyof RunUndoCounts, by = 1) => { counts[kind] = (counts[kind] ?? 0) + by; };
    const left: string[] = [];
    const kept: string[] = [];
    const trashedWorks: string[] = [];
    for (const operation of [...operations].reverse()) {
      const output = row(operation.output);
      if (output.undoneAt) continue;
      if (operation.type === "artifact.create") {
        if (operation.status !== "executed" && operation.status !== "executing") continue;
        const artifactId = ctx.db.normalizeId("spectraArtifacts", String(output.artifactId ?? operation.pendingArtifactId ?? ""));
        const artifact = artifactId ? await ctx.db.get(artifactId) : null;
        if (!artifact || artifact.createdFrom?.runId !== run._id || artifact.status !== "active") continue;
        if (args.keepWorks?.includes(String(artifact._id)) || (await editedAfter(ctx, artifact._id, operation._creationTime))) {
          kept.push(`You edited "${artifact.title}" after Spectra made it, so it stays.`);
          continue;
        }
        try {
          await trashCreatedWork(ctx, actor.accountId, artifact);
          trashedWorks.push(String(artifact._id));
          count("works");
          await ctx.db.patch(operation._id, { output: { ...output, undoneAt: Date.now() } });
        } catch {
          left.push(`"${artifact.title}"`);
        }
        continue;
      }
      if (operation.type !== "app.command" || operation.status !== "executed") continue;
      const input = row(operation.input);
      const command = String(input.command ?? "");
      const receipt = row(output.applicationWriteReceipt);
      const inverse = inverseFor(command, row(input.args), row(receipt.result), row(output.undoState), String(run._id), String(operation._id));
      // A workspace's id is the whole of its create result, not a field of it.
      if (inverse && "name" in inverse && inverse.name === "spectraWorkspaces:archive") inverse.args.workspaceId = receipt.result;
      if (!inverse) continue;
      if ("left" in inverse) {
        left.push(inverse.left);
        continue;
      }
      const steps = "many" in inverse ? inverse.many : [inverse];
      let reversed = 0;
      for (const step of steps) {
        try {
          await ctx.runMutation(makeFunctionReference<"mutation">(step.name), step.args as never);
          reversed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          kept.push(/GESTURE_CONFLICT|REVISION/.test(message)
            ? "You changed a calendar block after Spectra moved it, so it stays where you put it."
            : `Spectra could not put back ${command.replaceAll("_", " ")}.`);
        }
      }
      if (reversed) {
        count(inverse.kind, command === "remove_calendar_event" ? 1 : "many" in inverse ? reversed : 1);
        await ctx.db.patch(operation._id, { output: { ...output, undoneAt: Date.now() } });
      }
    }
    const memory = await reverseMemory(ctx, actor.accountId, String(run._id));
    if (memory.reversed) count("memory");
    if (memory.keptAny) kept.push("Spectra's memory changed after this, so it stays as it is.");
    return { counts, left: [...new Set(left)], kept: [...new Set(kept)], trashedWorks };
  },
});

/** A conversational Undo has its own committed effect, even though restored versions belong to the prior run. */
export const recordReversal = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string(), previousRunId: v.id("spectraAiRuns"), previousExecutionId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    const [run, previous] = await Promise.all([ctx.db.get(args.runId), ctx.db.get(args.previousRunId)]);
    if (!actor || !run || !previous || run.ownerAccountId !== actor.accountId || previous.ownerAccountId !== actor.accountId ||
        run.schoolId !== actor.schoolId || previous.schoolId !== actor.schoolId || !run.threadId || run.threadId !== previous.threadId ||
        previous._creationTime >= run._creationTime) throw new Error("AI run not found");
    requireCurrentExecution(run.executionId, args.executionId);
    requireCurrentExecution(previous.executionId, args.previousExecutionId);
    if (run.status !== "running" || !isTerminalRunStatus(previous.status)) throw new Error("This run attempt is no longer active.");
    const cards = await ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", previous._id)).collect();
    const undone = cards.find((card) => card.actions.some((action) => action.key === "undone") && row(card.provenance).undoneByRunId === run._id);
    if (!undone) throw new Error("The previous run has no committed reversal.");
    const operations = await ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", run._id)).collect();
    const existing = operations.find((operation) => operation.executionId === args.executionId && operation.type === "run.revert" && row(operation.input).runId === previous._id);
    if (existing) return { operationId: existing._id };
    const operationId = await ctx.db.insert("spectraOperations", {
      runId: run._id, executionId: args.executionId, actorType: "ai", type: "run.revert", status: "executed",
      input: { runId: previous._id, executionId: args.previousExecutionId }, output: { summary: undone.summary },
      affected: [{ type: "run", id: String(previous._id) }], requiresConfirmation: false, createdAt: Date.now(), executedAt: Date.now(),
    });
    return { operationId };
  },
});

export const bringBackCalendarItem = mutation({
  args: { itemId: v.id("calendarItems") },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const item = await ctx.db.get(args.itemId);
    if (!item || item.ownerAccountId !== actor.accountId || item.status !== "removed") return { restored: false };
    await ctx.db.patch(item._id, { status: "active", revision: item.revision + 1, updatedAt: Date.now() });
    return { restored: true };
  },
});

export const restoreSettingsLayer = mutation({
  args: { values: v.any() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const layer = await ctx.db.query("accountPreferences")
      .withIndex("by_account_scope_key", (q) => q.eq("accountId", actor.accountId).eq("scope", "account").eq("scopeKey", "account"))
      .unique();
    if (!layer) return { restored: false };
    if (args.values === null) await ctx.db.delete(layer._id);
    else await ctx.db.patch(layer._id, { values: args.values, updatedAt: Date.now() });
    return { restored: true };
  },
});
