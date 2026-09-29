import { mutation, query } from "./functions";
import { v } from "convex/values";
import { evaluateAccessForActor } from "./authorityShared";
import { getActiveMembership, getAuthenticatedActor, type AuthenticatedActor } from "./identityShared";
import { requireArtifactCapability } from "./spectraShared";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { isSensitiveQuizRegion } from "./quizPrivacy";

const anchor = v.object({
  regionId: v.string(),
  semanticAnchor: v.optional(v.any()),
  relativePosition: v.optional(v.bytes()),
  geometry: v.optional(v.any()),
  fallbackExcerpt: v.optional(v.string()),
});

async function validateMentions(
  ctx: Parameters<typeof requireArtifactCapability>[0],
  artifactId: Parameters<typeof requireArtifactCapability>[1],
  accountIds: Id<"accounts">[],
) {
  const artifact = await ctx.db.get(artifactId);
  if (!artifact) throw new Error("ARTIFACT_NOT_FOUND");
  for (const accountId of accountIds) {
    const account = await ctx.db.get(accountId);
    if (!account || account.status !== "active")
      throw new Error(
        "COMMENT_MENTION_UNAVAILABLE: A mentioned collaborator is unavailable.",
      );
    const membership = await getActiveMembership(ctx, account._id);
    if (!membership || membership.schoolId !== artifact.schoolId)
      throw new Error(
        "COMMENT_MENTION_SCHOOL_BOUNDARY: Mentions must stay within the artifact school.",
      );
    const decision = await evaluateAccessForActor(
      ctx,
      {
        ...account,
        accountId: account._id,
        schoolId: membership.schoolId,
        schoolRole: membership.role,
        membershipId: membership._id,
      },
      artifact.blueprintKey === "agent" ? "agent" : "artifact",
      artifactId,
    );
    if (!decision.allowed || !decision.capabilities.includes("read"))
      throw new Error(
        "COMMENT_MENTION_NO_ACCESS: Share the artifact before mentioning this person.",
      );
  }
}

export const list = query({
  args: {
    artifactId: v.id("spectraArtifacts"),
    includeResolved: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { artifact, decision } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "read",
    );
    const statuses = args.includeResolved
      ? (["open", "resolved", "orphaned"] as const)
      : (["open", "orphaned"] as const);
    const limit = Math.max(1, Math.min(args.limit ?? 100, 200));
    const rows = (
      await Promise.all(
        statuses.map((status) =>
          ctx.db
            .query("artifactComments")
            .withIndex("by_artifact_status", (q) =>
              q.eq("artifactId", args.artifactId).eq("status", status),
            )
            .order("desc")
            .take(limit),
        ),
      )
    ).flat();
    const recent = rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
    const selectedById = new Map(
      recent.map((comment) => [comment._id, comment]),
    );
    let frontier = recent.flatMap((comment) =>
      comment.parentCommentId ? [comment.parentCommentId] : [],
    );
    // Preserve the complete visible reply chain even when a parent is resolved
    // or deleted. Removing a parent must never make its surviving replies vanish.
    for (let depth = 0; depth < 12 && frontier.length > 0; depth += 1) {
      const parents = await Promise.all(
        [...new Set(frontier)]
          .filter((id) => !selectedById.has(id))
          .map((id) => ctx.db.get(id)),
      );
      frontier = [];
      for (const parent of parents) {
        if (!parent || parent.artifactId !== args.artifactId) continue;
        selectedById.set(parent._id, parent);
        if (parent.parentCommentId) frontier.push(parent.parentCommentId);
      }
    }
    const selected = [...selectedById.values()]
      .filter(
        (comment) =>
          artifact.blueprintKey !== "quiz" ||
          decision.level === "modify" ||
          !isSensitiveQuizRegion(comment.anchor.regionId),
      )
      .sort((a, b) => a.createdAt - b.createdAt);
    const accountIds = [
      ...new Set(
        selected.flatMap((comment) => [
          comment.authorAccountId,
          ...comment.mentionedAccountIds,
        ]),
      ),
    ];
    const accounts = new Map(
      (
        await Promise.all(
          accountIds.map(async (accountId) => {
            const account = await ctx.db.get(accountId);
            return account ? ([accountId, account] as const) : null;
          }),
        )
      ).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    );
    return selected.map((comment) => {
      const author = accounts.get(comment.authorAccountId);
      return {
        ...comment,
        anchor: {
          ...comment.anchor,
          semanticAnchor: comment.anchor.semanticAnchor ?? {
            workId: String(artifact._id),
            workType: artifact.blueprintKey,
            kind: comment.anchor.regionId === "work:root" ? "work:root" : "semantic_region",
            path: comment.anchor.regionId === "work:root" ? ["work", "root"] : ["region", comment.anchor.regionId],
            stableIds: comment.anchor.regionId === "work:root" ? { workId: String(artifact._id) } : { regionId: comment.anchor.regionId },
            fallbackExcerpt: comment.anchor.fallbackExcerpt,
            schemaVersion: 1,
          },
        },
        author: author
          ? {
              accountId: author._id,
              name: comment.authorDisplayName ?? author.name,
              avatarUrl: author.avatarUrl,
              kind: comment.authorKind ?? "human",
            }
          : null,
        mentions: comment.mentionedAccountIds
          .map((accountId) => {
            const account = accounts.get(accountId);
            return account
              ? {
                  accountId: account._id,
                  name: account.name,
                  avatarUrl: account.avatarUrl,
                }
              : null;
          })
          .filter((entry): entry is NonNullable<typeof entry> =>
            Boolean(entry),
          ),
      };
    });
  },
});

export const notificationPreference = query({
  args: { artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const { actor } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "read",
    );
    const preference = await ctx.db
      .query("artifactCommentPreferences")
      .withIndex("by_artifact_account", (q) =>
        q.eq("artifactId", args.artifactId).eq("accountId", actor.accountId),
      )
      .unique();
    return { mode: preference?.mode ?? ("mentions_replies" as const) };
  },
});

export const setNotificationPreference = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    mode: v.union(
      v.literal("all"),
      v.literal("mentions_replies"),
      v.literal("off"),
    ),
  },
  handler: async (ctx, args) => {
    const { actor } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "read",
    );
    const existing = await ctx.db
      .query("artifactCommentPreferences")
      .withIndex("by_artifact_account", (q) =>
        q.eq("artifactId", args.artifactId).eq("accountId", actor.accountId),
      )
      .unique();
    const value = {
      artifactId: args.artifactId,
      accountId: actor.accountId,
      mode: args.mode,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("artifactCommentPreferences", value);
    return { mode: args.mode };
  },
});

export async function loadArtifactCommentNotifications(
  ctx: QueryCtx,
  actor: AuthenticatedActor,
  args: { limit?: number; unreadOnly?: boolean },
) {
  const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
  const rows = await ctx.db
    .query("artifactCommentNotifications")
    .withIndex("by_recipient_created", (q) =>
      q.eq("recipientAccountId", actor.accountId),
    )
    .order("desc")
    .take(limit * 3);
  const visible = [];
  for (const notification of rows) {
    if (args.unreadOnly && notification.readAt) continue;
    const [comment, artifact] = await Promise.all([
      ctx.db.get(notification.commentId),
      ctx.db.get(notification.artifactId),
    ]);
    if (!comment || !artifact || comment.status === "deleted") continue;
    const decision = await evaluateAccessForActor(
      ctx,
      actor,
      artifact.blueprintKey === "agent" ? "agent" : "artifact",
      notification.artifactId,
    );
    if (!decision.allowed) continue;
    if (
      artifact.blueprintKey === "quiz" &&
      decision.level !== "modify" &&
      isSensitiveQuizRegion(comment.anchor.regionId)
    ) {
      continue;
    }
    const author = await ctx.db.get(comment.authorAccountId);
    visible.push({
      ...notification,
      artifact: {
        artifactId: artifact._id,
        title: artifact.title,
        blueprintKey: artifact.blueprintKey,
      },
      comment: {
        body: comment.body.slice(0, 240),
        regionId: comment.anchor.regionId,
      },
      author: author
        ? {
            accountId: author._id,
            name: comment.authorDisplayName ?? author.name,
            avatarUrl: author.avatarUrl,
            kind: comment.authorKind ?? "human",
          }
        : null,
    });
    if (visible.length >= limit) break;
  }
  return visible;
}

export const listNotifications = query({
  args: { limit: v.optional(v.number()), unreadOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error(
        "AUTH_NO_SCHOOL: An active school membership is required.",
      );
    return loadArtifactCommentNotifications(ctx, actor, args);
  },
});

export const markNotificationsRead = mutation({
  args: { notificationIds: v.array(v.id("artifactCommentNotifications")) },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error(
        "AUTH_NO_SCHOOL: An active school membership is required.",
      );
    const now = Date.now();
    let updated = 0;
    for (const notificationId of [...new Set(args.notificationIds)].slice(
      0,
      100,
    )) {
      const notification = await ctx.db.get(notificationId);
      if (
        !notification ||
        notification.recipientAccountId !== actor.accountId ||
        notification.readAt
      )
        continue;
      await ctx.db.patch(notification._id, { readAt: now });
      updated += 1;
    }
    return { updated };
  },
});

export const create = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    parentCommentId: v.optional(v.id("artifactComments")),
    body: v.string(),
    anchor,
    mentionedAccountIds: v.array(v.id("accounts")),
    aiRunId: v.optional(v.id("spectraAiRuns")),
    aiExecutionId: v.optional(v.string()),
    aiOperationId: v.optional(v.id("spectraOperations")),
  },
  handler: async (ctx, args) => {
    const { actor, artifact, decision } = await requireArtifactCapability(
      ctx,
      args.artifactId,
      "comment",
    );
    const normalizeCommentBody = (value: string) => value
      .replace(/\u0000/g, "")
      .trim()
      .slice(0, 20_000);
    const body = normalizeCommentBody(args.body);
    if (!body)
      throw new Error("COMMENT_BODY_REQUIRED: Write a comment before posting.");
    const regionId = args.anchor.regionId.trim().slice(0, 240);
    if (!regionId)
      throw new Error(
        "COMMENT_ANCHOR_REQUIRED: Select a semantic region for this comment.",
      );
    if (
      artifact.blueprintKey === "quiz" &&
      decision.level !== "modify" &&
      isSensitiveQuizRegion(regionId)
    ) {
      throw new Error(
        "COMMENT_REGION_PRIVATE: Answer keys and author feedback are not visible in read-only quiz access.",
      );
    }
    const aiAttribution = Boolean(
      args.aiRunId || args.aiExecutionId || args.aiOperationId,
    );
    let authorDisplayName: string | undefined;
    if (aiAttribution) {
      if (!args.aiRunId || !args.aiExecutionId || !args.aiOperationId)
        throw new Error("AI_COMMENT_ATTRIBUTION_INCOMPLETE");
      const [run, operation] = await Promise.all([
        ctx.db.get(args.aiRunId),
        ctx.db.get(args.aiOperationId),
      ]);
      const operationInput = operation?.input as
        | { command?: unknown; args?: Record<string, unknown> }
        | undefined;
      const operationArgs = operationInput?.args;
      const requestedAnchor = operationArgs?.anchor as
        | { regionId?: unknown; fallbackExcerpt?: unknown }
        | undefined;
      if (
        !run ||
        run.ownerAccountId !== actor.accountId ||
        run.schoolId !== actor.schoolId ||
        run.status !== "running" ||
        run.executionId !== args.aiExecutionId ||
        operation?.runId !== run._id ||
        operation.executionId !== args.aiExecutionId ||
        operation.actorType !== "ai" ||
        operation.type !== "app.command" ||
        operation.status !== "executing" ||
        operationInput?.command !== "add_comment" ||
        operationArgs?.artifactId !== args.artifactId ||
        typeof operationArgs?.body !== "string" ||
        normalizeCommentBody(operationArgs.body) !== body ||
        operationArgs?.parentCommentId !== args.parentCommentId ||
        requestedAnchor?.regionId !== regionId ||
        (typeof requestedAnchor?.fallbackExcerpt === "string" &&
          requestedAnchor.fallbackExcerpt.trim().slice(0, 500) !==
            args.anchor.fallbackExcerpt?.trim().slice(0, 500))
      ) {
        throw new Error("AI_COMMENT_OPERATION_NOT_ACTIVE");
      }
      authorDisplayName = `${actor.name?.trim().slice(0, 160) || "Spectra"}'s AI`;
    }
    const mentionedAccountIds = [...new Set(args.mentionedAccountIds)].slice(
      0,
      50,
    );
    await validateMentions(ctx, args.artifactId, mentionedAccountIds);
    let parentAuthorAccountId: Id<"accounts"> | undefined;
    if (args.parentCommentId) {
      const parent = await ctx.db.get(args.parentCommentId);
      if (
        !parent ||
        parent.artifactId !== args.artifactId ||
        parent.status === "deleted"
      )
        throw new Error(
          "COMMENT_PARENT_UNAVAILABLE: The parent comment no longer exists.",
        );
      parentAuthorAccountId = parent.authorAccountId;
    }
    const now = Date.now();
    const commentId = await ctx.db.insert("artifactComments", {
      artifactId: args.artifactId,
      schoolId: artifact.schoolId,
      parentCommentId: args.parentCommentId,
      authorAccountId: actor.accountId,
      ...(aiAttribution
        ? { authorKind: "ai" as const, authorDisplayName }
        : { authorKind: "human" as const }),
      body,
      anchor: {
        regionId,
        semanticAnchor: args.anchor.semanticAnchor ?? {
          workId: String(artifact._id),
          workType: artifact.blueprintKey,
          kind: regionId === "work:root" ? "work:root" : "semantic_region",
          path: regionId === "work:root" ? ["work", "root"] : ["region", regionId],
          stableIds: regionId === "work:root" ? { workId: String(artifact._id) } : { regionId },
          fallbackExcerpt: args.anchor.fallbackExcerpt?.trim().slice(0, 500),
          schemaVersion: 1,
        },
        relativePosition: args.anchor.relativePosition,
        geometry: args.anchor.geometry,
        fallbackExcerpt: args.anchor.fallbackExcerpt?.trim().slice(0, 500),
      },
      mentionedAccountIds,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });

    const delivery = new Map<
      Id<"accounts">,
      "mention" | "reply" | "all_comments"
    >();
    const allSubscribers = await ctx.db
      .query("artifactCommentPreferences")
      .withIndex("by_artifact_mode", (q) =>
        q.eq("artifactId", args.artifactId).eq("mode", "all"),
      )
      .collect();
    for (const preference of allSubscribers)
      delivery.set(preference.accountId, "all_comments");
    if (parentAuthorAccountId) delivery.set(parentAuthorAccountId, "reply");
    for (const accountId of mentionedAccountIds)
      delivery.set(accountId, "mention");
    delivery.delete(actor.accountId);
    for (const [recipientAccountId, kind] of delivery) {
      const preference = await ctx.db
        .query("artifactCommentPreferences")
        .withIndex("by_artifact_account", (q) =>
          q
            .eq("artifactId", args.artifactId)
            .eq("accountId", recipientAccountId),
        )
        .unique();
      if (
        preference?.mode === "off" ||
        (kind === "all_comments" && preference?.mode !== "all")
      )
        continue;
      const account = await ctx.db.get(recipientAccountId);
      const membership = account
        ? await getActiveMembership(ctx, account._id)
        : null;
      if (!account || !membership || membership.schoolId !== artifact.schoolId)
        continue;
      const decision = await evaluateAccessForActor(
        ctx,
        {
          ...account,
          accountId: account._id,
          schoolId: membership.schoolId,
          schoolRole: membership.role,
          membershipId: membership._id,
        },
        artifact.blueprintKey === "agent" ? "agent" : "artifact",
        args.artifactId,
      );
      if (!decision.allowed) continue;
      await ctx.db.insert("artifactCommentNotifications", {
        artifactId: args.artifactId,
        commentId,
        recipientAccountId,
        kind,
        createdAt: now,
      });
    }
    return { commentId };
  },
});

export const updateBody = mutation({
  args: { commentId: v.id("artifactComments"), body: v.string() },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.status === "deleted")
      throw new Error("COMMENT_NOT_FOUND");
    const { actor } = await requireArtifactCapability(
      ctx,
      comment.artifactId,
      "comment",
    );
    if (comment.authorAccountId !== actor.accountId)
      throw new Error(
        "COMMENT_AUTHOR_REQUIRED: Only the author can edit this comment.",
      );
    const body = args.body
      .replace(/\u0000/g, "")
      .trim()
      .slice(0, 20_000);
    if (!body)
      throw new Error("COMMENT_BODY_REQUIRED: A comment cannot be empty.");
    await ctx.db.patch(comment._id, { body, updatedAt: Date.now() });
    return { commentId: comment._id };
  },
});

export const setResolved = mutation({
  args: { commentId: v.id("artifactComments"), resolved: v.boolean() },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.status === "deleted")
      throw new Error("COMMENT_NOT_FOUND");
    const { actor } = await requireArtifactCapability(
      ctx,
      comment.artifactId,
      "comment",
    );
    const now = Date.now();
    await ctx.db.patch(
      comment._id,
      args.resolved
        ? {
            status: "resolved",
            resolvedAt: now,
            resolvedByAccountId: actor.accountId,
            updatedAt: now,
          }
        : {
            status: "open",
            resolvedAt: undefined,
            resolvedByAccountId: undefined,
            updatedAt: now,
          },
    );
    return {
      commentId: comment._id,
      status: args.resolved ? ("resolved" as const) : ("open" as const),
    };
  },
});

export const reanchor = mutation({
  args: { commentId: v.id("artifactComments"), anchor },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.status === "deleted")
      throw new Error("COMMENT_NOT_FOUND");
    const { artifact } = await requireArtifactCapability(ctx, comment.artifactId, "comment");
    const regionId = args.anchor.regionId.trim().slice(0, 240);
    if (!regionId) throw new Error("COMMENT_ANCHOR_REQUIRED");
    await ctx.db.patch(comment._id, {
      anchor: {
        regionId,
        semanticAnchor: args.anchor.semanticAnchor ?? {
          workId: String(artifact._id),
          workType: artifact.blueprintKey,
          kind: regionId === "work:root" ? "work:root" : "semantic_region",
          path: regionId === "work:root" ? ["work", "root"] : ["region", regionId],
          stableIds: regionId === "work:root" ? { workId: String(artifact._id) } : { regionId },
          fallbackExcerpt: args.anchor.fallbackExcerpt?.trim().slice(0, 500),
          schemaVersion: 1,
        },
        relativePosition: args.anchor.relativePosition,
        geometry: args.anchor.geometry,
        fallbackExcerpt: args.anchor.fallbackExcerpt?.trim().slice(0, 500),
      },
      status: comment.status === "orphaned" ? "open" : comment.status,
      updatedAt: Date.now(),
    });
    return { commentId: comment._id };
  },
});

export const remove = mutation({
  args: { commentId: v.id("artifactComments") },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.status === "deleted") return { removed: false };
    const { actor } = await requireArtifactCapability(
      ctx,
      comment.artifactId,
      "comment",
    );
    if (comment.authorAccountId !== actor.accountId)
      throw new Error(
        "COMMENT_AUTHOR_REQUIRED: Only the author can remove this comment.",
      );
    await ctx.db.patch(comment._id, {
      body: "",
      mentionedAccountIds: [],
      status: "deleted",
      updatedAt: Date.now(),
    });
    return { removed: true };
  },
});
