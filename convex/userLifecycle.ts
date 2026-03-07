import type { Doc, Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

type PurgeSummary = {
  blocked: {
    packs: Array<{ id: Id<"packs">; name: string }>;
    agents: Array<{ id: Id<"agents">; name: string; visibility: string }>;
  };
  deleted: Record<string, number>;
  reassignedInvitationCount: number;
  preservedAuditLogStrategy: "detached";
};

function increment(summary: PurgeSummary, key: string, amount = 1) {
  summary.deleted[key] = (summary.deleted[key] ?? 0) + amount;
}

async function deleteRows(ctx: MutationCtx, ids: Iterable<Id<TableNames>>) {
  let deleted = 0;
  for (const id of ids) {
    await ctx.db.delete(id);
    deleted += 1;
  }
  return deleted;
}

async function deleteStorageIfPresent(ctx: MutationCtx, storageId: Id<"_storage"> | undefined) {
  if (!storageId) return;
  await ctx.storage.delete(storageId).catch(() => {});
}

export async function purgeUserData(
  ctx: MutationCtx,
  args: {
    actor: Doc<"users">;
    target: Doc<"users">;
  },
): Promise<PurgeSummary> {
  const { actor, target } = args;
  const summary: PurgeSummary = {
    blocked: {
      packs: [],
      agents: [],
    },
    deleted: {},
    reassignedInvitationCount: 0,
    preservedAuditLogStrategy: "detached",
  };

  const [ownedPacks, ownedAgents] = await Promise.all([
    ctx.db
      .query("packs")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", target._id))
      .collect(),
    ctx.db
      .query("agents")
      .withIndex("by_creator", (q) => q.eq("creatorUserId", target._id))
      .collect(),
  ]);

  if (ownedPacks.length > 0 || ownedAgents.length > 0) {
    summary.blocked.packs = ownedPacks.map((pack) => ({ id: pack._id, name: pack.name }));
    summary.blocked.agents = ownedAgents.map((agent) => ({
      id: agent._id,
      name: agent.name,
      visibility: agent.visibility,
    }));
    const blockingBits = [
      ownedPacks.length > 0 ? `${ownedPacks.length} pack(s)` : null,
      ownedAgents.length > 0 ? `${ownedAgents.length} agent(s)` : null,
    ].filter(Boolean);
    throw new Error(
      `Cannot permanently delete this user while they still own ${blockingBits.join(" and ")}. Reassign or delete those assets first.`,
    );
  }

  const [
    userMemoryRows,
    studentAnalyticsRows,
    weeklySummaryRows,
    nudgeRows,
    achievementRows,
    streakRows,
    studyTimerRows,
    ownBookmarkRows,
    notificationRows,
    flashcardProgressRows,
    quizResultRows,
    quizSessionRows,
    flashcardDeckRows,
    userSpendingRows,
    personalSoulRows,
    generatedImages,
    usageEvents,
    chats,
    personalResources,
    feedbackRows,
    invitationsByEmail,
    orgInvitations,
  ] = await Promise.all([
    ctx.db.query("userMemory").withIndex("by_user", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("studentAnalytics").withIndex("by_user_day", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("weeklySummaries").withIndex("by_user", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("nudges").withIndex("by_user", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("achievements").withIndex("by_user", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("userStreaks").withIndex("by_user", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("studyTimers").withIndex("by_user", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("messageBookmarks").withIndex("by_user", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("notifications").withIndex("by_user", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("flashcardProgress").withIndex("by_user", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("quizResults").withIndex("by_user_submitted", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("quizSessions").withIndex("by_user", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("flashcardDecks").withIndex("by_user_updated", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("userSpending").withIndex("by_user_month", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("userSoulPreferences").withIndex("by_user", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("generatedImages").withIndex("by_user", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("usageEvents").withIndex("by_user_day", (q) => q.eq("userId", target._id)).collect(),
    ctx.db.query("chats").withIndex("by_owner", (q) => q.eq("ownerUserId", target._id)).collect(),
    ctx.db
      .query("resources")
      .withIndex("by_owner_scope", (q) => q.eq("ownerUserId", target._id).eq("scope", "personal"))
      .collect(),
    ctx.db.query("feedback").collect(),
    ctx.db.query("schoolInvitations").withIndex("by_email", (q) => q.eq("email", target.email)).collect(),
    ctx.db.query("schoolInvitations").withIndex("by_org", (q) => q.eq("orgId", target.orgId)).collect(),
  ]);

  const chatIds = new Set(chats.map((chat) => String(chat._id)));
  const chatMessages = (
    await Promise.all(
      chats.map((chat) => ctx.db.query("messages").withIndex("by_chat", (q) => q.eq("chatId", chat._id)).collect()),
    )
  ).flat();
  const messageIds = new Set(chatMessages.map((message) => String(message._id)));

  const chatBookmarkRows = (
    await Promise.all(
      chats.map((chat) => ctx.db.query("messageBookmarks").withIndex("by_chat", (q) => q.eq("chatId", chat._id)).collect()),
    )
  ).flat();

  const chatBranchRows = (await ctx.db.query("chatBranches").collect()).filter((branch) =>
    chatIds.has(String(branch.originalChatId))
    || chatIds.has(String(branch.branchChatId))
    || messageIds.has(String(branch.parentMessageId))
  );

  const personalResourceChunks = (
    await Promise.all(
      personalResources.map((resource) =>
        ctx.db.query("chunks").withIndex("by_resource", (q) => q.eq("resourceId", resource._id)).collect()
      ),
    )
  ).flat();

  const invitationRowsToDelete = invitationsByEmail.filter((invitation) => invitation.orgId === target.orgId);
  const invitationRowsToReassign = orgInvitations.filter((invitation) => invitation.invitedBy === target._id);
  for (const invitation of invitationRowsToReassign) {
    if (invitation.invitedBy === target._id) {
      await ctx.db.patch(invitation._id, {
        invitedBy: actor._id,
      });
      summary.reassignedInvitationCount += 1;
    }
  }

  for (const image of generatedImages) {
    await deleteStorageIfPresent(ctx, image.storageId);
    if (image.thumbnailStorageId && image.thumbnailStorageId !== image.storageId) {
      await deleteStorageIfPresent(ctx, image.thumbnailStorageId);
    }
  }

  for (const resource of personalResources) {
    await deleteStorageIfPresent(ctx, resource.storageId);
  }

  for (const feedback of feedbackRows) {
    if (feedback.userId === target.clerkId) {
      await deleteStorageIfPresent(ctx, feedback.screenshotStorageId);
    }
  }

  increment(summary, "userMemory", await deleteRows(ctx, userMemoryRows.map((row) => row._id)));
  increment(summary, "studentAnalytics", await deleteRows(ctx, studentAnalyticsRows.map((row) => row._id)));
  increment(summary, "weeklySummaries", await deleteRows(ctx, weeklySummaryRows.map((row) => row._id)));
  increment(summary, "nudges", await deleteRows(ctx, nudgeRows.map((row) => row._id)));
  increment(summary, "achievements", await deleteRows(ctx, achievementRows.map((row) => row._id)));
  increment(summary, "userStreaks", await deleteRows(ctx, streakRows.map((row) => row._id)));
  increment(summary, "studyTimers", await deleteRows(ctx, studyTimerRows.map((row) => row._id)));
  increment(summary, "notifications", await deleteRows(ctx, notificationRows.map((row) => row._id)));
  increment(summary, "flashcardProgress", await deleteRows(ctx, flashcardProgressRows.map((row) => row._id)));
  increment(summary, "quizResults", await deleteRows(ctx, quizResultRows.map((row) => row._id)));
  increment(summary, "quizSessions", await deleteRows(ctx, quizSessionRows.map((row) => row._id)));
  increment(summary, "flashcardDecks", await deleteRows(ctx, flashcardDeckRows.map((row) => row._id)));
  increment(summary, "userSpending", await deleteRows(ctx, userSpendingRows.map((row) => row._id)));
  increment(summary, "userSoulPreferences", await deleteRows(ctx, personalSoulRows.map((row) => row._id)));
  increment(summary, "generatedImages", await deleteRows(ctx, generatedImages.map((row) => row._id)));
  increment(summary, "usageEvents", await deleteRows(ctx, usageEvents.map((row) => row._id)));
  increment(summary, "feedback", await deleteRows(
    ctx,
    feedbackRows.filter((row) => row.userId === target.clerkId).map((row) => row._id),
  ));

  const bookmarkIds = new Set<string>();
  const bookmarkDeleteIds: Array<Id<"messageBookmarks">> = [];
  for (const bookmark of [...ownBookmarkRows, ...chatBookmarkRows]) {
    if (bookmarkIds.has(String(bookmark._id))) continue;
    bookmarkIds.add(String(bookmark._id));
    bookmarkDeleteIds.push(bookmark._id);
  }
  increment(summary, "messageBookmarks", await deleteRows(ctx, bookmarkDeleteIds));

  increment(summary, "chatBranches", await deleteRows(ctx, chatBranchRows.map((row) => row._id)));
  increment(summary, "chunks", await deleteRows(ctx, personalResourceChunks.map((row) => row._id)));
  increment(summary, "resources", await deleteRows(ctx, personalResources.map((row) => row._id)));
  increment(summary, "messages", await deleteRows(ctx, chatMessages.map((row) => row._id)));
  increment(summary, "chats", await deleteRows(ctx, chats.map((row) => row._id)));
  increment(summary, "schoolInvitations", await deleteRows(ctx, invitationRowsToDelete.map((row) => row._id)));

  if (target.userStreakId) {
    await ctx.db.patch(target._id, { userStreakId: undefined });
  }
  await ctx.db.delete(target._id);
  increment(summary, "users", 1);

  return summary;
}
