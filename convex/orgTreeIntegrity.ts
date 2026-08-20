import { internalQuery } from "./_generated/server";
import { internalMutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  GENERAL_STARTER_KEY,
  ensureWorkspaceNode,
  isContainerKind,
  typeKeyFor,
  type OrgNode,
} from "./orgTreeShared";

/**
 * Tree integrity (ARCHITECTURE-STORAGE §11.1).
 *
 * Every organizational read in the product trusts four things about `orgNodes`:
 * one primary placement per live source, every parent present and a container,
 * no cycles, and `workspaceContextId` equal to the nearest workspace ancestor.
 * Nothing enforces those across rows at write time, so they are checked here —
 * `verify` reports, `restampContexts` repairs the one kind of drift that can be
 * derived from the tree itself.
 *
 * This ran as the acceptance gate for the migration off `spectraWorkspaceItems`
 * and stays as the corpus check for every later change to tree writes.
 */

/**
 * The workspace a node belongs to, read from the tree rather than from the row:
 * a workspace node is its own context, everything else inherits the nearest
 * workspace above it, and a node with no workspace ancestor has none.
 */
function expectedContext(
  node: OrgNode,
  byId: Map<string, OrgNode>,
): Id<"spectraWorkspaces"> | undefined {
  if (node.kind === "workspace" && node.sourceId)
    return node.sourceId as Id<"spectraWorkspaces">;
  let current = node.parentId ? byId.get(node.parentId) : undefined;
  for (let depth = 0; depth < 64 && current; depth += 1) {
    if (current.kind === "workspace" && current.sourceId)
      return current.sourceId as Id<"spectraWorkspaces">;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return undefined;
}

export const verify = internalQuery({
  args: {},
  handler: async (ctx) => {
    const nodes: OrgNode[] = await ctx.db.query("orgNodes").collect();
    const byId = new Map(nodes.map((node) => [node._id as string, node]));
    const live = nodes.filter((node) => node.deletedAt === undefined);

    const duplicates: string[] = [];
    const seen = new Map<string, number>();
    for (const node of live) {
      if (node.kind !== "work" && node.kind !== "thread") continue;
      const key = `${node.accountId}:${node.kind}:${node.sourceId}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [key, count] of seen) if (count > 1) duplicates.push(key);

    const orphans = nodes
      .filter((node) => node.parentId && !byId.has(node.parentId))
      .map((node) => node._id);

    const leafParents = nodes
      .filter(
        (node) =>
          node.parentId &&
          byId.has(node.parentId) &&
          !isContainerKind(byId.get(node.parentId)!.kind),
      )
      .map((node) => node._id);

    const cycles: string[] = [];
    for (const node of nodes) {
      let current = node.parentId;
      for (let depth = 0; depth < 64; depth += 1) {
        if (!current) break;
        if (current === node._id) {
          cycles.push(node._id);
          break;
        }
        current = byId.get(current)?.parentId ?? null;
      }
    }

    const contextMismatches = nodes
      .filter(
        (node) =>
          (node.workspaceContextId ?? undefined) !==
          expectedContext(node, byId),
      )
      .map((node) => node._id);

    const brokenLinks = live
      .filter(
        (node) =>
          node.kind === "link" && (!node.sourceId || !byId.has(node.sourceId)),
      )
      .map((node) => node._id);

    /* The board's columns are index ranges on these two fields, so a live row
       missing `typeKey` is not ordered oddly — it is absent from every type
       column. That makes this a correctness check, not a tidiness one. */
    const missingTypeKey = live
      .filter((node) => node.typeKey === undefined)
      .map((node) => node._id);
    const missingActivityAt = live
      .filter((node) => node.activityAt === undefined)
      .map((node) => node._id);
    const wrongTypeKey = live
      .filter(
        (node) =>
          node.kind !== "work" &&
          node.kind !== "link" &&
          node.typeKey !== undefined &&
          node.typeKey !== node.kind,
      )
      .map((node) => node._id);

    const artifacts: Doc<"spectraArtifacts">[] = await ctx.db
      .query("spectraArtifacts")
      .collect();
    const threads: Doc<"spectraThreads">[] = await ctx.db
      .query("spectraThreads")
      .collect();
    const liveArtifacts = artifacts.filter((row) => row.status !== "deleted");
    const liveThreads = threads.filter((row) => row.status !== "deleted");
    const workNodeKeys = new Set(
      live
        .filter((node) => node.kind === "work")
        .map((node) => `${node.accountId}:${node.sourceId}`),
    );
    const threadNodeKeys = new Set(
      live
        .filter((node) => node.kind === "thread")
        .map((node) => `${node.accountId}:${node.sourceId}`),
    );
    const unplacedArtifacts = liveArtifacts
      .filter(
        (row) => !workNodeKeys.has(`${row.ownerAccountId}:${row._id}`),
      )
      .map((row) => row._id);
    const unplacedThreads = liveThreads
      .filter(
        (row) => !threadNodeKeys.has(`${row.ownerAccountId}:${row._id}`),
      )
      .map((row) => row._id);

    const generals = (
      await ctx.db.query("spectraWorkspaces").collect()
    ).filter((row) => row.starterKey === GENERAL_STARTER_KEY);

    /**
     * A workspace with no node is a place that exists and cannot be reached: it
     * shows in the workspace switcher but not in the Library, not on the board,
     * and nothing can be filed into it through the tree. Every creation path
     * calls `ensureWorkspaceNode`, so this only ever catches rows written before
     * the tree existed or by a path that forgot — which is precisely why it is
     * checked here and not trusted.
     */
    const workspaceNodeKeys = new Set(
      live
        .filter((node) => node.kind === "workspace")
        .map((node) => `${node.accountId}:${node.sourceId}`),
    );
    const unplacedWorkspaces = (
      await ctx.db.query("spectraWorkspaces").collect()
    )
      .filter(
        (row) =>
          row.status === "active" &&
          !workspaceNodeKeys.has(`${row.ownerAccountId}:${row._id}`),
      )
      .map((row) => row._id);

    const contextlessWork = live
      .filter(
        (node) =>
          (node.kind === "work" || node.kind === "thread") &&
          node.workspaceContextId === undefined,
      )
      .map((node) => node._id);

    const pass =
      duplicates.length === 0 &&
      orphans.length === 0 &&
      leafParents.length === 0 &&
      cycles.length === 0 &&
      contextMismatches.length === 0 &&
      brokenLinks.length === 0 &&
      unplacedArtifacts.length === 0 &&
      unplacedThreads.length === 0 &&
      unplacedWorkspaces.length === 0 &&
      contextlessWork.length === 0 &&
      missingTypeKey.length === 0 &&
      missingActivityAt.length === 0 &&
      wrongTypeKey.length === 0;

    return {
      pass,
      totals: {
        nodes: nodes.length,
        live: live.length,
        trashed: nodes.length - live.length,
        workNodes: live.filter((node) => node.kind === "work").length,
        threadNodes: live.filter((node) => node.kind === "thread").length,
        folderNodes: live.filter((node) => node.kind === "folder").length,
        workspaceNodes: live.filter((node) => node.kind === "workspace").length,
        linkNodes: live.filter((node) => node.kind === "link").length,
        liveArtifacts: liveArtifacts.length,
        liveThreads: liveThreads.length,
        generalWorkspaces: generals.length,
      },
      failures: {
        duplicatePrimaries: duplicates.slice(0, 20),
        duplicateCount: duplicates.length,
        orphans: orphans.slice(0, 20),
        orphanCount: orphans.length,
        leafParents: leafParents.slice(0, 20),
        cycles: cycles.slice(0, 20),
        contextMismatches: contextMismatches.slice(0, 20),
        contextMismatchCount: contextMismatches.length,
        brokenLinks: brokenLinks.slice(0, 20),
        unplacedArtifacts: unplacedArtifacts.slice(0, 20),
        unplacedArtifactCount: unplacedArtifacts.length,
        unplacedThreads: unplacedThreads.slice(0, 20),
        unplacedThreadCount: unplacedThreads.length,
        unplacedWorkspaces: unplacedWorkspaces.slice(0, 20),
        unplacedWorkspaceCount: unplacedWorkspaces.length,
        contextlessWork: contextlessWork.slice(0, 20),
        contextlessWorkCount: contextlessWork.length,
        missingTypeKey: missingTypeKey.slice(0, 20),
        missingTypeKeyCount: missingTypeKey.length,
        missingActivityAt: missingActivityAt.slice(0, 20),
        missingActivityAtCount: missingActivityAt.length,
        wrongTypeKey: wrongTypeKey.slice(0, 20),
        wrongTypeKeyCount: wrongTypeKey.length,
      },
    };
  },
});

/** Repair pass for `workspaceContextId` drift, if verify ever reports it. */
export const restampContexts = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const nodes: OrgNode[] = await ctx.db.query("orgNodes").collect();
    const byId = new Map(nodes.map((node) => [node._id as string, node]));
    const limit = Math.min(args.limit ?? 500, 2000);
    let patched = 0;
    for (const node of nodes) {
      if (patched >= limit) break;
      const expected = expectedContext(node, byId);
      if ((node.workspaceContextId ?? undefined) === expected) continue;
      await ctx.db.patch(node._id, {
        workspaceContextId: expected,
        updatedAt: Date.now(),
      });
      patched += 1;
    }
    return { patched };
  },
});

/**
 * Backfill for the board's two denormalized facets, `typeKey` and `activityAt`.
 *
 * Every write path sets them now (`orgTreeShared`), so this exists for rows
 * written before they did. It matters more than most backfills: the board's
 * columns are index ranges keyed on these fields, and a row missing `typeKey` is
 * not merely ordered oddly — it is *absent* from every type column. So this runs
 * to completion before the windowed board is trusted, and `verify` reports what
 * is left.
 *
 * Paged and idempotent: pass the returned cursor back until `done`.
 */
export const backfillBoardFacets = internalMutation({
  args: { cursor: v.optional(v.string()), batch: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batch = Math.min(Math.max(args.batch ?? 400, 1), 2000);
    const result = await ctx.db.query("orgNodes").paginate({
      cursor: args.cursor ?? null,
      numItems: batch,
    });
    let patched = 0;
    for (const node of result.page) {
      const patch: Record<string, unknown> = {};
      if (node.typeKey === undefined) {
        if (node.kind === "work" && node.sourceId) {
          const artifactId = ctx.db.normalizeId(
            "spectraArtifacts",
            node.sourceId,
          );
          const artifact = artifactId ? await ctx.db.get(artifactId) : null;
          patch.typeKey = typeKeyFor("work", artifact?.blueprintKey);
        } else if (node.kind === "link" && node.sourceId) {
          const targetId = ctx.db.normalizeId("orgNodes", node.sourceId);
          const target = targetId ? await ctx.db.get(targetId) : null;
          patch.typeKey =
            target?.typeKey ?? typeKeyFor(target?.kind ?? "link");
        } else {
          patch.typeKey = typeKeyFor(node.kind);
        }
      }
      /* Seeded from the source's own recency where there is one, because that is
         what the field means and what the card already displays. */
      if (node.activityAt === undefined) {
        let activity = node.updatedAt;
        if (node.kind === "work" && node.sourceId) {
          const artifactId = ctx.db.normalizeId(
            "spectraArtifacts",
            node.sourceId,
          );
          const artifact = artifactId ? await ctx.db.get(artifactId) : null;
          if (artifact) activity = artifact.updatedAt;
        } else if (node.kind === "thread" && node.sourceId) {
          const threadId = ctx.db.normalizeId("spectraThreads", node.sourceId);
          const thread = threadId ? await ctx.db.get(threadId) : null;
          if (thread) activity = thread.updatedAt;
        }
        patch.activityAt = activity;
      }
      if (Object.keys(patch).length === 0) continue;
      /* No `updatedAt` bump: nothing about the placement changed, and stamping it
         would make every row look freshly moved. */
      await ctx.db.patch(node._id, patch);
      patched += 1;
    }
    return {
      patched,
      scanned: result.page.length,
      done: result.isDone,
      cursor: result.isDone ? null : result.continueCursor,
    };
  },
});

/**
 * Repair pass for workspaces that have no node. Every creation path places one
 * now, so this exists for rows written before the tree — and as the answer to
 * `verify`'s `unplacedWorkspaces`, which is how such a row is ever noticed.
 */
export const placeOrphanWorkspaces = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const nodes: OrgNode[] = await ctx.db.query("orgNodes").collect();
    const placed = new Set(
      nodes
        .filter((node) => node.kind === "workspace" && node.deletedAt === undefined)
        .map((node) => `${node.accountId}:${node.sourceId}`),
    );
    const workspaces = await ctx.db.query("spectraWorkspaces").collect();
    const limit = Math.min(args.limit ?? 500, 2000);
    const created: string[] = [];
    for (const workspace of workspaces) {
      if (created.length >= limit) break;
      if (workspace.status !== "active") continue;
      if (placed.has(`${workspace.ownerAccountId}:${workspace._id}`)) continue;
      await ensureWorkspaceNode(ctx, workspace);
      created.push(workspace.title);
    }
    return { created: created.length, titles: created.slice(0, 20) };
  },
});
