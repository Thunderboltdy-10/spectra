import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireSpectraActor } from "./spectraShared";
import { hasDirectReadGrant } from "./authorityShared";
import { ARTIFACT_SUMMARY_READ_MODEL_VERSION, sharesWithWorkspace } from "./orgTreeShared";
import { sealCatalogCursor, openCatalogCursor } from "./catalogCursor";
import { normalizeWorkspaceView } from "../shared/workspace-view";

// A raw candidate budget is not a promised number of visible results. A page
// may be empty and nonfinal. No counts are inferred from a partial scan.
export const CATALOG_CANDIDATES = 24;
export const CATALOG_PLACEMENTS = 8;
export const CATALOG_MIGRATION_KEY = "catalog-artifact-summaries";
type Key = { updatedAt: number; artifactId: Id<"spectraArtifacts"> };
type Cursor = {
  scope: string;
  after?: Key;
  pending?: { key: Key; nodes: string | null };
  native?: string;
};
type ArtifactArgs = {
  scope?: "school" | "owned";
  cursor?: string;
  limit?: number;
  search?: string;
  status?: Doc<"spectraArtifactSummaries">["status"];
  blueprintKey?: string;
  placement?: "all" | "shared" | "inbox" | "workspace";
};

async function decode(
  cursor: string | undefined,
  scope: string,
): Promise<Cursor> {
  if (!cursor) return { scope };
  try {
    if (cursor.length > 16_384) throw new Error();
    const value = (await openCatalogCursor(cursor, scope)) as Cursor;
    const validKey = (key: Key | undefined) =>
      !key ||
      (Number.isFinite(key.updatedAt) && typeof key.artifactId === "string");
    if (
      value.scope !== scope ||
      !validKey(value.after) ||
      !validKey(value.pending?.key) ||
      (value.pending &&
        value.pending.nodes !== null &&
        typeof value.pending.nodes !== "string") ||
      (value.native !== undefined && typeof value.native !== "string")
    )
      throw new Error();
    return value;
  } catch {
    throw new Error("CATALOG_CURSOR_INVALID: Restart this search.");
  }
}

function limitFor(limit?: number) {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
    throw new Error("CATALOG_LIMIT_INVALID");
  return Math.min(limit ?? CATALOG_CANDIDATES, CATALOG_CANDIDATES);
}

export async function artifactPage(ctx: QueryCtx, args: ArtifactArgs) {
  const actor = await requireSpectraActor(ctx);
  const migration = await ctx.db
    .query("spectraReadModelMigrations")
    .withIndex("by_key", (q) => q.eq("key", CATALOG_MIGRATION_KEY))
    .unique();
  if (
    migration?.state !== "complete" ||
    migration.version !== ARTIFACT_SUMMARY_READ_MODEL_VERSION
  )
    throw new Error(
      "CATALOG_READ_MODEL_REQUIRED: Library metadata needs its bounded migration.",
    );
  const limit = limitFor(args.limit);
  const status = args.status ?? "active";
  const placement = args.placement ?? "all";
  const candidateScope = args.scope ?? "school";
  const search = args.search?.trim().toLowerCase() ?? "";
  if (search.length > 200) throw new Error("CATALOG_SEARCH_TOO_LONG");
  const scope = JSON.stringify([
    "artifacts-v1",
    actor.accountId,
    actor.schoolId,
    candidateScope,
    status,
    args.blueprintKey ?? null,
    placement,
    search,
  ]);
  const cursor = await decode(args.cursor, scope);
  const index = () => ctx.db.query("spectraArtifactSummaries");
  const readRange = (take: number, anchor?: Key, tied = false) => {
    if (candidateScope === "owned") {
      return index()
        .withIndex("by_account_status_updated_id", (q) => {
          const prefix = q
            .eq("ownerAccountId", actor.accountId)
            .eq("status", status);
          return !anchor
            ? prefix
            : tied
              ? prefix
                  .eq("updatedAt", anchor.updatedAt)
                  .lt("artifactId", anchor.artifactId)
              : prefix.lt("updatedAt", anchor.updatedAt);
        })
        .order("desc")
        .take(take);
    }
    return index()
      .withIndex("by_school_status_updated_id", (q) => {
        const prefix = q.eq("schoolId", actor.schoolId).eq("status", status);
        return !anchor
          ? prefix
          : tied
            ? prefix
                .eq("updatedAt", anchor.updatedAt)
                .lt("artifactId", anchor.artifactId)
            : prefix.lt("updatedAt", anchor.updatedAt);
      })
      .order("desc")
      .take(take);
  };
  let candidates: Doc<"spectraArtifactSummaries">[];
  let done = false;
  if (cursor.pending) {
    const row = await index()
      .withIndex("by_artifact", (q) =>
        q.eq("artifactId", cursor.pending!.key.artifactId),
      )
      .unique();
    candidates = row ? [row] : [];
  } else if (cursor.after) {
    const after = cursor.after;
    const tied = await readRange(limit + 1, after, true);
    const older =
      tied.length > limit
        ? []
        : await readRange(limit + 1 - tied.length, after);
    candidates = [...tied, ...older];
    done = candidates.length <= limit;
  } else {
    candidates = await readRange(limit + 1);
    done = candidates.length <= limit;
  }
  candidates = candidates.slice(0, limit);
  const items: Array<Record<string, unknown>> = [];
  let after = cursor.pending?.key ?? cursor.after;
  let pending: Cursor["pending"];
  let consumed = 0;
  let placementReadsRemaining = CATALOG_PLACEMENTS;
  const workspaceProofs = new Map<
    string,
    Promise<{
      workspace: Doc<"spectraWorkspaces">;
      visible: boolean;
      projects: boolean;
    } | null>
  >();
  const workspaceProof = (workspaceId: Id<"spectraWorkspaces">) => {
    const existing = workspaceProofs.get(workspaceId);
    if (existing) return existing;
    const proof = (async () => {
      const workspace = await ctx.db.get(workspaceId);
      if (
        !workspace ||
        workspace.status !== "active" ||
        workspace.schoolId !== actor.schoolId
      )
        return null;
      const projects = await hasDirectReadGrant(
        ctx,
        actor,
        "workspace",
        workspaceId,
      );
      return {
        workspace,
        projects,
        visible: workspace.ownerAccountId === actor.accountId || projects,
      };
    })();
    workspaceProofs.set(workspaceId, proof);
    return proof;
  };

  for (const row of candidates) {
    const key = cursor.pending?.key ?? {
      updatedAt: row.updatedAt,
      artifactId: row.artifactId,
    };
    const previousAfter = after;
    consumed++;
    after = key;
    const owned = row.ownerAccountId === actor.accountId;
    if (
      row.schoolId !== actor.schoolId ||
      (candidateScope === "owned" && !owned) ||
      row.status !== status ||
      row.blueprintKey === "thread_reference" ||
      (args.blueprintKey && row.blueprintKey !== args.blueprintKey) ||
      (placement === "shared" && owned)
    )
      continue;
    if (row.readModelVersion !== ARTIFACT_SUMMARY_READ_MODEL_VERSION)
      throw new Error(
        "CATALOG_READ_MODEL_REQUIRED: Library metadata needs its bounded migration.",
      );
    const projection = row.projection as Record<string, unknown>;
    // A shared quiz must not become an answer-search oracle.
    const maySearchBody =
      row.blueprintKey !== "timetable" &&
      (row.blueprintKey !== "quiz" || owned);
    const text = `${projection.title ?? ""}\n${projection.summary ?? ""}\n${row.blueprintKey}\n${Array.isArray(projection.tags) ? projection.tags.join(" ") : ""}\n${maySearchBody ? row.searchText : ""}`;
    if (search && !text.toLowerCase().includes(search)) continue;
    const direct =
      owned ||
      (await hasDirectReadGrant(
        ctx,
        actor,
        row.blueprintKey === "agent" ? "agent" : "artifact",
        row.artifactId,
      ));
    const emit = (visiblePlacement?: {
      workspaceId: string;
      workspaceTitle: string;
      nodeId: string;
      pinned: boolean;
    }) => {
      items.push({
        ...projection,
        ownership: owned ? "owned" : "shared",
        ...(owned ? {} : { isShared: true }),
        ...(visiblePlacement
          ? {
              placements: [visiblePlacement],
              placementsComplete: false,
              placementStatus: "workspace",
            }
          : placement === "inbox"
            ? {
                placements: [],
                placementsComplete: true,
                placementStatus: "inbox",
              }
            : {}),
      });
    };
    if (direct && (placement === "all" || placement === "shared")) {
      emit();
      continue;
    }
    const override = owned
      ? null
      : await ctx.db
          .query("artifactAccessOverrides")
          .withIndex("by_artifact_account", (q) =>
            q.eq("artifactId", row.artifactId).eq("accountId", actor.accountId),
          )
          .unique();
    if (!direct && override?.effect === "deny") continue;
    const placements = () => ctx.db
      .query("orgNodes")
      .withIndex("by_kind_source_live", (q) =>
        q
          .eq("kind", "work")
          .eq("sourceId", row.artifactId)
          .eq("deletedAt", undefined),
      );
    const inspectPlacements = async (nodes: Doc<"orgNodes">[]) => {
      for (const node of nodes) {
        if (!node.workspaceContextId) continue;
        const proof = await workspaceProof(node.workspaceContextId);
        if (!proof?.visible) continue;
        if (placement === "inbox") return true;
        const inherited =
          override?.effect !== "deny" &&
          proof.projects &&
          sharesWithWorkspace(node);
        if (direct || inherited) {
          emit({
            workspaceId: proof.workspace._id,
            workspaceTitle: proof.workspace.title.slice(0, 200),
            nodeId: node._id,
            pinned: node.pinned === true,
          });
          return true;
        }
      }
      return false;
    };
    if (!cursor.pending) {
      // A two-row prefix proves an empty/single-placement set is complete
      // without consuming the query's one native pagination call. Charge all
      // returned rows, including probes, to the same global placement budget.
      if (placementReadsRemaining < 2) {
        consumed--;
        after = previousAfter;
        break;
      }
      const prefix = await placements().take(2);
      placementReadsRemaining -= prefix.length;
      if (await inspectPlacements(prefix)) continue;
      if (prefix.length < 2) {
        if (direct && placement === "inbox") emit();
        continue;
      }
      if (placementReadsRemaining === 0) {
        pending = { key, nodes: null };
        break;
      }
    }
    // A genuinely larger placement set uses the remaining budget and retains
    // the native cursor (including tied creation times). The prefix may be
    // reread here; those repeated reads are included in the eight-row budget.
    const nodes = await placements().paginate({
      numItems: placementReadsRemaining,
      cursor: cursor.pending?.nodes ?? null,
    });
    const resolved = await inspectPlacements(nodes.page);
    if (!resolved && !nodes.isDone)
      pending = { key, nodes: nodes.continueCursor };
    else if (!resolved && direct && placement === "inbox") emit();
    // Do not issue a second database paginate call.
    break;
  }
  const isDone = !pending && done && consumed === candidates.length;
  return {
    scope: candidateScope,
    items,
    isDone,
    continueCursor: isDone
      ? null
      : await sealCatalogCursor(
          { scope, after, pending } satisfies Cursor,
          scope,
        ),
  };
}

export async function workspacePage(
  ctx: QueryCtx,
  args: {
    cursor?: string;
    limit?: number;
    includeArchived?: boolean;
    search?: string;
  },
) {
  const actor = await requireSpectraActor(ctx);
  const limit = limitFor(args.limit);
  const search = args.search?.trim().toLowerCase() ?? "";
  if (search.length > 200) throw new Error("CATALOG_SEARCH_TOO_LONG");
  const scope = JSON.stringify([
    "workspaces-v1",
    actor.accountId,
    actor.schoolId,
    args.includeArchived === true,
    search,
  ]);
  const cursor = await decode(args.cursor, scope);
  const source = args.includeArchived
    ? ctx.db
        .query("spectraWorkspaces")
        .withIndex("by_school_activity", (q) =>
          q.eq("schoolId", actor.schoolId),
        )
    : ctx.db
        .query("spectraWorkspaces")
        .withIndex("by_school_status_activity", (q) =>
          q.eq("schoolId", actor.schoolId).eq("status", "active"),
        );
  const page = await source
    .order("desc")
    .paginate({ numItems: limit, cursor: cursor.native ?? null });
  const items: Array<Record<string, unknown>> = [];
  for (const workspace of page.page) {
    if (
      (!args.includeArchived && workspace.status !== "active") ||
      (search &&
        !`${workspace.title}\n${workspace.description ?? ""}`
          .toLowerCase()
          .includes(search))
    )
      continue;
    const owned = workspace.ownerAccountId === actor.accountId;
    if (
      !owned &&
      !(await hasDirectReadGrant(ctx, actor, "workspace", workspace._id))
    )
      continue;
    items.push({
      _id: workspace._id,
      _creationTime: workspace._creationTime,
      ownerAccountId: workspace.ownerAccountId,
      schoolId: workspace.schoolId,
      title: workspace.title.slice(0, 200),
      description: workspace.description?.slice(0, 2_000),
      icon: workspace.icon,
      color: workspace.color,
      status: workspace.status,
      defaultView: normalizeWorkspaceView(workspace.defaultView),
      starterKey: workspace.starterKey,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      lastActivityAt: workspace.lastActivityAt,
      ownership: owned ? "owned" : "shared",
      ...(owned ? {} : { isShared: true }),
    });
  }
  return {
    items,
    isDone: page.isDone,
    continueCursor: page.isDone
      ? null
      : await sealCatalogCursor(
          { scope, native: page.continueCursor } satisfies Cursor,
          scope,
        ),
  };
}
