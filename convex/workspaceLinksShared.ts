import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { AuthenticatedActor } from "./identityShared";
import { appendOrderKey, findPrimaryNode } from "./orgTreeShared";

/*
 * Linked workspaces. A workspace someone shares with you (a teacher's
 * "Physics 11") can show inside one of your own (your ManageBac class) instead
 * of standing beside it as a second Physics. The link is only where it shows:
 * access is still the share's grant, and only the works its author chose to
 * share with the workspace appear. Unlinking puts it back on its own.
 */

export async function linkOf(
  ctx: Pick<QueryCtx, "db">,
  accountId: Id<"accounts">,
  linkedWorkspaceId: Id<"spectraWorkspaces">,
) {
  return ctx.db
    .query("workspaceLinks")
    .withIndex("by_account_linked", (q) =>
      q.eq("accountId", accountId).eq("linkedWorkspaceId", linkedWorkspaceId),
    )
    .first();
}

/** The shared workspace's own place at the top of the Library, when it is not shown inside another. */
async function pointerNode(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  workspaceId: Id<"spectraWorkspaces">,
) {
  const node = await findPrimaryNode(ctx, accountId, "workspace", workspaceId);
  return node && node.deletedAt === undefined ? node : null;
}

async function placePointer(
  ctx: MutationCtx,
  actor: AuthenticatedActor,
  workspace: Doc<"spectraWorkspaces">,
) {
  if (await pointerNode(ctx, actor.accountId, workspace._id)) return;
  const now = Date.now();
  await ctx.db.insert("orgNodes", {
    accountId: actor.accountId,
    schoolId: actor.schoolId,
    parentId: null,
    kind: "workspace",
    name: workspace.title,
    sourceId: workspace._id,
    typeKey: "workspace",
    activityAt: now,
    orderKey: await appendOrderKey(ctx, actor.accountId, null),
    workspaceContextId: workspace._id,
    placedByAccountId: actor.accountId,
    childCount: 0,
    createdAt: now,
    updatedAt: now,
  });
}

/** Show `linked` inside the actor's own `workspaceId`; one place per shared workspace. */
export async function linkWorkspace(
  ctx: MutationCtx,
  actor: AuthenticatedActor,
  workspaceId: Id<"spectraWorkspaces">,
  linked: Doc<"spectraWorkspaces">,
) {
  const existing = await linkOf(ctx, actor.accountId, linked._id);
  if (existing) {
    if (existing.workspaceId !== workspaceId)
      await ctx.db.patch(existing._id, { workspaceId });
  } else {
    await ctx.db.insert("workspaceLinks", {
      accountId: actor.accountId,
      schoolId: actor.schoolId,
      workspaceId,
      linkedWorkspaceId: linked._id,
      createdAt: Date.now(),
    });
  }
  // Its own place goes, unless the actor has filed something inside it.
  const pointer = await pointerNode(ctx, actor.accountId, linked._id);
  if (pointer && !(pointer.childCount ?? 0)) await ctx.db.delete(pointer._id);
}

export async function unlinkWorkspace(
  ctx: MutationCtx,
  actor: AuthenticatedActor,
  linked: Doc<"spectraWorkspaces">,
  keepPlace: boolean,
) {
  const rows = await ctx.db
    .query("workspaceLinks")
    .withIndex("by_account_linked", (q) =>
      q.eq("accountId", actor.accountId).eq("linkedWorkspaceId", linked._id),
    )
    .collect();
  await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
  if (keepPlace) await placePointer(ctx, actor, linked);
}

/** The actor's own ManageBac class workspace for the same class, if there is one. */
async function sameClassWorkspace(
  ctx: MutationCtx,
  actor: AuthenticatedActor,
  shared: Doc<"spectraWorkspaces">,
) {
  const providerClassId = shared.sourceContext?.providerClassId;
  if (!providerClassId) return null;
  const own = await ctx.db
    .query("spectraWorkspaces")
    .withIndex("by_account_starter", (q) =>
      q.eq("ownerAccountId", actor.accountId).eq("starterKey", "managebac-class"),
    )
    .collect();
  return (
    own.find(
      (workspace) =>
        workspace.status === "active" &&
        workspace.sourceContext?.providerClassId === providerClassId,
    ) ?? null
  );
}

/**
 * Where an accepted shared workspace shows: inside the actor's own class when
 * it is the same class, otherwise as its own place. Accepting again keeps
 * whatever the actor chose since.
 */
export async function placeSharedWorkspace(
  ctx: MutationCtx,
  actor: AuthenticatedActor,
  workspaceId: Id<"spectraWorkspaces">,
) {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace) return null;
  const existing = await linkOf(ctx, actor.accountId, workspace._id);
  if (existing) return existing.workspaceId;
  if (await pointerNode(ctx, actor.accountId, workspace._id)) return null;
  const own = await sameClassWorkspace(ctx, actor, workspace);
  if (own) {
    await linkWorkspace(ctx, actor, own._id, workspace);
    return own._id;
  }
  await placePointer(ctx, actor, workspace);
  return null;
}
