import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getAuthenticatedAccount, type AuthenticatedActor } from "./identityShared";
import { ARTIFACT_SUMMARY_READ_MODEL_VERSION } from "./orgTreeShared";
import { CATALOG_MIGRATION_KEY } from "./catalogPages";
import { openCatalogCursor, sealCatalogCursor } from "./catalogCursor";
import { normalizeWorkspaceView } from "../shared/workspace-view";
import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspaceCapability } from "./spectraShared";

// Unsorted grant/placement streams must finish before any ordered emission.
export const GRAPH_BATCH = 8;
export const GRAPH_LIMIT = 24;
export const GRAPH_READ_ROWS = 256;
const MAX_RESTARTS = 3;
type Summary = Doc<"spectraArtifactSummaries">;
type Workspace = Doc<"spectraWorkspaces">;
type Source = Summary | Workspace;
type Key = { time: number; id: string };
type Proof =
  | { kind: "owner" }
  | { kind: "direct"; grantId: Id<"accessGrants"> }
  | { kind: "inherited"; grantId: Id<"accessGrants">; workspaceId: Id<"spectraWorkspaces">; nodeId: Id<"orgNodes"> };
type Entry = { key: Key; proof: Proof; stamp: string };
type State = {
  version: 1;
  scope: string;
  stage: number;
  native: string | null;
  after?: Key;
  best: Entry[];
  ownedCount: number;
  restarts: number;
  workspace?: { id: Id<"spectraWorkspaces">; grantId: Id<"accessGrants">; native: string | null };
};
export type ArtifactGraphArgs = {
  cursor?: string;
  limit?: number;
  search?: string;
  status?: Summary["status"];
  blueprintKey?: string;
  placement?: "all" | "shared";
};
export type WorkspaceGraphArgs = { cursor?: string; limit?: number; search?: string; includeArchived?: boolean };
type Args = ArtifactGraphArgs & WorkspaceGraphArgs & { kind: "artifacts" | "workspaces"; agentCards?: boolean };

/** Reserve worst-case returned rows BEFORE every database operation, including
 * failed/empty proofs. unique reserves two (duplicate detection); no collect,
 * body fallback, full audience helper or post-index filter is permitted here.
 * This is a row/call bound, not a bound on bytes in variable-sized documents.
 */
class Budget {
  rows = 0;
  calls = 0;
  paginations = 0;
  async read<T>(rows: number, operation: () => Promise<T>, pagination = false): Promise<T> {
    if (this.rows + rows > GRAPH_READ_ROWS || (pagination && this.paginations))
      throw new Error("CATALOG_GRAPH_BUDGET_EXCEEDED");
    this.rows += rows;
    this.calls++;
    if (pagination) this.paginations++;
    return operation();
  }
}

async function actorFor(ctx: QueryCtx, budget: Budget): Promise<AuthenticatedActor> {
  // Same verified account and membership rules as requireSpectraActor, but
  // detect the >1 membership invariant with two rows instead of collect().
  const account = await budget.read(2, () => getAuthenticatedAccount(ctx));
  if (!account) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  const memberships = await budget.read(2, () => ctx.db.query("schoolMemberships")
    .withIndex("by_account_status", q => q.eq("accountId", account._id).eq("status", "active")).take(2));
  if (memberships.length > 1)
    throw new Error("IDENTITY_INVARIANT: An account cannot have more than one active school membership.");
  const membership = memberships[0];
  const school = membership ? await budget.read(1, () => ctx.db.get(membership.schoolId)) : null;
  if (!membership || !school || school.status !== "active")
    throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return { ...account, accountId: account._id, schoolId: school._id, schoolRole: membership.role, membershipId: membership._id };
}

function compare(a: Key, b: Key) {
  return b.time - a.time || (a.id === b.id ? 0 : a.id > b.id ? -1 : 1);
}
function keyFor(row: Source): Key {
  return "artifactId" in row ? { time: row.updatedAt, id: row.artifactId } : { time: row.lastActivityAt, id: row._id };
}
function grantMatches(grant: Doc<"accessGrants">, actor: AuthenticatedActor, type: "artifact" | "agent" | "workspace", id: string, accountOnly = false) {
  return grant.resourceId === id && grant.resourceType === type && grant.source === "direct" &&
    !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > Date.now()) &&
    ((grant.principalType === "account" && grant.principalId === actor.accountId) ||
      (!accountOnly && grant.principalType === "school" && grant.principalId === actor.schoolId));
}
function matches(row: Source, actor: AuthenticatedActor, args: Args, search: string, after?: Key) {
  if (after && compare(keyFor(row), after) <= 0) return false;
  if ("artifactId" in row) {
    if (row.status === "deleted" || row.status !== (args.status ?? "active") || row.blueprintKey === "thread_reference" ||
      (args.blueprintKey && row.blueprintKey !== args.blueprintKey) ||
      (args.placement === "shared" && row.ownerAccountId === actor.accountId)) return false;
    if (row.readModelVersion !== ARTIFACT_SUMMARY_READ_MODEL_VERSION)
      throw new Error("CATALOG_READ_MODEL_REQUIRED: Library metadata needs its bounded migration.");
    const p = row.projection as Record<string, unknown>;
    const maySearchBody = row.blueprintKey !== "timetable" && (row.blueprintKey !== "quiz" || row.ownerAccountId === actor.accountId);
    return !search || `${p.title ?? ""}\n${p.summary ?? ""}\n${row.blueprintKey}\n${Array.isArray(p.tags) ? p.tags.join(" ") : ""}\n${maySearchBody ? row.searchText : ""}`.toLowerCase().includes(search);
  }
  return (args.includeArchived || row.status === "active") &&
    (!search || `${row.title}\n${row.description ?? ""}`.toLowerCase().includes(search));
}
async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes).slice(0, 16), b => b.toString(16).padStart(2, "0")).join("");
}
function authorityFacts(row: Source) {
  return [keyFor(row), row.ownerAccountId, row.schoolId, row.status, "artifactId" in row ? row.blueprintKey : "workspace"];
}
function grantFacts(grant: Doc<"accessGrants">) {
  return [grant.resourceType, grant.resourceId, grant.principalType, grant.principalId, grant.source, grant.revokedAt, grant.expiresAt, grant.level];
}
async function sourceFor(ctx: QueryCtx, budget: Budget, kind: Args["kind"], id: string): Promise<Source | null> {
  if (kind === "workspaces") {
    const workspaceId = ctx.db.normalizeId("spectraWorkspaces", id);
    return workspaceId ? budget.read(1, () => ctx.db.get(workspaceId)) : null;
  }
  const artifactId = ctx.db.normalizeId("spectraArtifacts", id);
  return artifactId ? budget.read(2, () => ctx.db.query("spectraArtifactSummaries")
    .withIndex("by_artifact", q => q.eq("artifactId", artifactId)).unique()) : null;
}

async function proofStamp(ctx: QueryCtx, budget: Budget, actor: AuthenticatedActor, row: Source, proof: Proof,
  loaded?: { grant?: Doc<"accessGrants">; workspace?: Workspace; node?: Doc<"orgNodes"> }) {
  if (proof.kind === "owner") return row.ownerAccountId === actor.accountId && row.schoolId === actor.schoolId
    ? digest(authorityFacts(row)) : null;
  const grant = loaded?.grant ?? await budget.read(1, () => ctx.db.get(proof.grantId));
  if (!grant) return null;
  if (proof.kind === "direct") {
    const type = "artifactId" in row ? row.blueprintKey === "agent" ? "agent" : "artifact" : "workspace";
    const foreign = Boolean(row.schoolId && row.schoolId !== actor.schoolId);
    return grantMatches(grant, actor, type, keyFor(row).id, foreign)
      ? digest([authorityFacts(row), grantFacts(grant)]) : null;
  }
  if (!("artifactId" in row) || (row.schoolId && row.schoolId !== actor.schoolId) ||
    !grantMatches(grant, actor, "workspace", proof.workspaceId)) return null;
  const workspace = loaded?.workspace ?? await budget.read(1, () => ctx.db.get(proof.workspaceId));
  if (!workspace || workspace.status !== "active" || workspace.schoolId !== actor.schoolId) return null;
  const node = loaded?.node ?? await budget.read(1, () => ctx.db.get(proof.nodeId));
  if (!node || node.kind !== "work" || node.sourceId !== row.artifactId || node.deletedAt !== undefined ||
    node.workspaceContextId !== workspace._id || !(node.accessProjection === true ||
      (node.accessProjection === undefined && row.ownerAccountId === workspace.ownerAccountId))) return null;
  const override = await budget.read(2, () => ctx.db.query("artifactAccessOverrides")
    .withIndex("by_artifact_account", q => q.eq("artifactId", row.artifactId).eq("accountId", actor.accountId)).unique());
  if (override?.effect === "deny") return null;
  // restrict/read preserves discovery; direct invitations remain independent.
  return digest([authorityFacts(row), grantFacts(grant), workspace.ownerAccountId, workspace.schoolId, workspace.status,
    node.sourceId, node.workspaceContextId, node.deletedAt, node.accessProjection, override?.effect, override?.maxLevel]);
}

function initial(scope: string, after?: Key, restarts = 0): State {
  return { version: 1, scope, stage: 0, native: null, after, best: [], ownedCount: 0, restarts };
}
async function decode(cursor: string | undefined, scope: string, maxStage: number, limit: number): Promise<State> {
  if (!cursor) return initial(scope);
  try {
    const s = await openCatalogCursor(cursor, scope) as State;
    const validKey = (k: Key) => k && Number.isFinite(k.time) && typeof k.id === "string" && k.id.length <= 100;
    if (!s || s.version !== 1 || s.scope !== scope || !Number.isInteger(s.stage) || s.stage < 0 || s.stage > maxStage ||
      (s.native !== null && typeof s.native !== "string") || (s.after && !validKey(s.after)) ||
      !Number.isInteger(s.ownedCount) || s.ownedCount < 0 || !Number.isInteger(s.restarts) || s.restarts < 0 || s.restarts > MAX_RESTARTS ||
      !Array.isArray(s.best) || s.best.length > limit + 1 || new Set(s.best.map(e => e.key.id)).size !== s.best.length ||
      s.best.some(e => !validKey(e.key) || !/^[0-9a-f]{32}$/u.test(e.stamp) || !e.proof ||
        !["owner", "direct", "inherited"].includes(e.proof.kind) ||
        (e.proof.kind !== "owner" && typeof e.proof.grantId !== "string") ||
        (e.proof.kind === "inherited" && (typeof e.proof.workspaceId !== "string" || typeof e.proof.nodeId !== "string"))) ||
      (s.workspace && (typeof s.workspace.id !== "string" || typeof s.workspace.grantId !== "string" ||
        (s.workspace.native !== null && typeof s.workspace.native !== "string")))) throw new Error();
    return s;
  } catch {
    throw new Error("CATALOG_CURSOR_INVALID: Restart this search.");
  }
}

/** The owner's own workspace is shared while an invitation they sent is
 * accepted or pending. One newest row per status on the exact index prefix:
 * revoked, declined and expired history is never read. */
async function sharedByOwner(ctx: QueryCtx, budget: Budget, actor: AuthenticatedActor, row: Source) {
  if ("artifactId" in row || row.ownerAccountId !== actor.accountId) return false;
  for (const status of ["accepted", "pending"] as const) {
    const invitation = await budget.read(1, () => ctx.db.query("shareInvitations").withIndex("by_resource_inviter_status", q =>
      q.eq("resourceType", "workspace").eq("resourceId", row._id).eq("inviterAccountId", row.ownerAccountId).eq("status", status))
      .order("desc").first());
    if (invitation && (!invitation.expiresAt || invitation.expiresAt > Date.now())) return true;
  }
  return false;
}

function project(row: Source, actor: AuthenticatedActor, sharedOwned = false): Record<string, unknown> {
  const owned = row.ownerAccountId === actor.accountId;
  const ownership = { ownership: owned ? "owned" : "shared", ...(owned && !sharedOwned ? {} : { isShared: true }) };
  if ("artifactId" in row) return { ...row.projection, ...ownership };
  return { _id: row._id, _creationTime: row._creationTime, ownerAccountId: row.ownerAccountId, schoolId: row.schoolId,
    title: row.title.slice(0, 200), description: row.description?.slice(0, 2_000), icon: row.icon, color: row.color,
    status: row.status, defaultView: normalizeWorkspaceView(row.defaultView), starterKey: row.starterKey,
    createdAt: row.createdAt, updatedAt: row.updatedAt, lastActivityAt: row.lastActivityAt, ...ownership };
}

async function graphPage(ctx: QueryCtx, args: Args) {
  const budget = new Budget();
  const actor = await actorFor(ctx, budget);
  const limit = args.limit ?? GRAPH_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > GRAPH_LIMIT) throw new Error("CATALOG_LIMIT_INVALID");
  const search = args.search?.trim().toLowerCase() ?? "";
  if (search.length > 200) throw new Error("CATALOG_SEARCH_TOO_LONG");
  if (args.placement && !["all", "shared"].includes(args.placement)) throw new Error("CATALOG_GRAPH_PLACEMENT_UNSUPPORTED");
  if (args.kind === "artifacts") {
    const migration = await budget.read(2, () => ctx.db.query("spectraReadModelMigrations")
      .withIndex("by_key", q => q.eq("key", CATALOG_MIGRATION_KEY)).unique());
    if (migration?.state !== "complete" || migration.version !== ARTIFACT_SUMMARY_READ_MODEL_VERSION)
      throw new Error("CATALOG_READ_MODEL_REQUIRED: Library metadata needs its bounded migration.");
  }
  const types = args.kind === "artifacts" ? ["artifact", "agent", "workspace"] as const : ["workspace"] as const;
  const streams = (["account", "school"] as const).flatMap(principal => types.map(type => ({ principal, type })));
  const maxStage = streams.length + 1;
  const scope = JSON.stringify(["actor-graph-v1", actor.accountId, actor.schoolId, actor.membershipId, args.kind,
    limit, search, args.status ?? "active", args.blueprintKey ?? null, args.placement ?? "all", args.includeArchived === true, args.agentCards === true]);
  let state = await decode(args.cursor, scope, maxStage, limit);
  const consider = async (row: Source | null, proof: Proof, loaded?: Parameters<typeof proofStamp>[5]) => {
    if (!row || !matches(row, actor, args, search, state.after)) return false;
    const stamp = await proofStamp(ctx, budget, actor, row, proof, loaded);
    if (!stamp) return false;
    const key = keyFor(row);
    // Keep only K+1 distinct canonical IDs, never an unbounded seen set.
    state.best = [...state.best.filter(e => e.key.id !== key.id), { key, proof, stamp }]
      .sort((a, b) => compare(a.key, b.key)).slice(0, limit + 1);
    return true;
  };
  const diagnostics = () => ({ reservedRows: budget.rows, readCalls: budget.calls, nativePaginations: budget.paginations });
  const progress = async (phase: "scanning" | "restarted") => {
    const continueCursor = await sealCatalogCursor(state, scope);
    if (continueCursor.length > 16_384) throw new Error("CATALOG_GRAPH_CURSOR_TOO_LARGE");
    return { items: [] as Array<Record<string, unknown>>, isDone: false, continueCursor,
      phase: phase === "scanning" && state.stage === maxStage && !state.workspace ? "revalidating" as const : phase,
      budget: diagnostics() };
  };

  if (state.workspace) {
    const current = state.workspace;
    const grant = await budget.read(1, () => ctx.db.get(current.grantId));
    const workspace = await budget.read(1, () => ctx.db.get(current.id));
    if (!grant || !workspace || !grantMatches(grant, actor, "workspace", workspace._id) ||
      workspace.status !== "active" || workspace.schoolId !== actor.schoolId) {
      delete state.workspace;
    } else {
      const page = await budget.read(GRAPH_BATCH, () => ctx.db.query("orgNodes")
        .withIndex("by_workspace_context_live_kind_activity", q => q.eq("workspaceContextId", current.id)
          .eq("deletedAt", undefined).eq("kind", "work"))
          .order("desc").paginate({ numItems: GRAPH_BATCH, cursor: current.native, maximumRowsRead: GRAPH_BATCH }), true);
      for (const node of page.page) {
        if (!node.sourceId) continue;
        const row = await sourceFor(ctx, budget, "artifacts", node.sourceId);
        await consider(row, { kind: "inherited", grantId: grant._id, workspaceId: workspace._id, nodeId: node._id }, { grant, workspace, node });
      }
      if (page.isDone) delete state.workspace;
      else current.native = page.continueCursor;
    }
    return progress("scanning");
  }

  // Shared-only discovery never emits an owned row; skip that stream outright.
  if (state.stage === 0 && args.kind === "artifacts" && args.placement === "shared") state.stage = 1;
  if (state.stage === 0) {
    const page = args.kind === "artifacts"
      ? await budget.read(GRAPH_BATCH, () => ctx.db.query("spectraArtifactSummaries")
        .withIndex("by_account_status_updated_id", q => {
          const prefix = q.eq("ownerAccountId", actor.accountId).eq("status", args.status ?? "active");
          return state.after ? prefix.lte("updatedAt", state.after.time) : prefix;
        }).order("desc").paginate({ numItems: GRAPH_BATCH, cursor: state.native, maximumRowsRead: GRAPH_BATCH }), true)
      : await budget.read(GRAPH_BATCH, () => (args.includeArchived
        ? ctx.db.query("spectraWorkspaces").withIndex("by_account_activity", q => q.eq("ownerAccountId", actor.accountId))
        : ctx.db.query("spectraWorkspaces").withIndex("by_account_status_activity", q => q.eq("ownerAccountId", actor.accountId).eq("status", "active")))
        .order("desc").paginate({ numItems: GRAPH_BATCH, cursor: state.native, maximumRowsRead: GRAPH_BATCH }), true);
    for (const row of page.page) if (await consider(row, { kind: "owner" })) state.ownedCount++;
    // Workspace index ties use creation order, not final workspace ID order.
    // Only the artifact owned index supports this early stop.
    if (page.isDone || (args.kind === "artifacts" && state.ownedCount >= limit + 1)) {
      state.stage++;
      state.native = null;
    } else state.native = page.continueCursor;
    return progress("scanning");
  }

  if (state.stage < maxStage) {
    const stream = streams[state.stage - 1]!;
    // One workspace edge at a time bounds the nested continuation. Duplicate
    // workspace grants may rescan nodes; measure this real maintenance tradeoff.
    const size = stream.type === "workspace" && args.kind === "artifacts" ? 1 : GRAPH_BATCH;
    const page = await budget.read(size, () => ctx.db.query("accessGrants")
      .withIndex("by_principal_resource_source", q => q.eq("principalType", stream.principal)
        .eq("principalId", stream.principal === "account" ? actor.accountId : actor.schoolId)
        .eq("resourceType", stream.type).eq("source", "direct"))
      .paginate({ numItems: size, cursor: state.native, maximumRowsRead: size }), true);
    for (const grant of page.page) {
      if (!grantMatches(grant, actor, stream.type, grant.resourceId)) continue;
      if (stream.type === "workspace" && args.kind === "artifacts") {
        const row = await sourceFor(ctx, budget, "workspaces", grant.resourceId);
        if (row && !("artifactId" in row) && row.status === "active" && row.schoolId === actor.schoolId)
          state.workspace = { id: row._id, grantId: grant._id, native: null };
      } else {
        await consider(await sourceFor(ctx, budget, args.kind, grant.resourceId), { kind: "direct", grantId: grant._id }, { grant });
      }
    }
    if (page.isDone) { state.stage++; state.native = null; }
    else state.native = page.continueCursor;
    return progress("scanning");
  }

  // Revalidate ALL retained candidates, including the lookahead, in one query
  // snapshot. No allow result or projection from a previous request is trusted.
  const rows: Source[] = [];
  for (const entry of state.best) {
    const row = await sourceFor(ctx, budget, args.kind, entry.key.id);
    const stamp = row && matches(row, actor, args, search, state.after)
      ? await proofStamp(ctx, budget, actor, row, entry.proof) : null;
    if (!row || stamp !== entry.stamp || compare(keyFor(row), entry.key) !== 0) {
      if (state.restarts >= MAX_RESTARTS) throw new Error("CATALOG_CHANGED_RESTART: Refresh this search after changes settle.");
      state = initial(scope, state.after, state.restarts + 1);
      return progress("restarted");
    }
    rows.push(row);
  }
  const isDone = rows.length <= limit;
  const emitted = rows.slice(0, limit);
  const items = [];
  for (const row of emitted) {
    const projected = project(row, actor, await sharedByOwner(ctx, budget, actor, row));
    if (args.agentCards && "artifactId" in row) {
      const owner = await budget.read(1, () => ctx.db.get(row.ownerAccountId));
      // Legacy absent rollout is published. Neither creation order nor an
      // arbitrary history slice establishes the latest published number.
      const releases = [];
      for (const rollout of [undefined, "published"] as const) {
        releases.push(await budget.read(1, () => ctx.db.query("agentReleases")
          .withIndex("by_agent_status_rollout_number", q => q.eq("agentId", row.artifactId)
            .eq("status", "published").eq("rollout", rollout)).order("desc").first()));
      }
      const release = releases.filter((item) => item !== null).sort((a, b) => b.releaseNumber - a.releaseNumber)[0];
      items.push({ ...projected, owner: owner ? { name: owner.name, avatarUrl: owner.avatarUrl } : undefined,
        agentRelease: release ? { versionId: release.versionId, releaseNumber: release.releaseNumber, publishedAt: release.publishedAt } : null,
        // Absence of list placement data is not proof that an agent is unplaced.
        // The selected action hydrates current detail before choosing add/open.
        placementsComplete: false });
    } else items.push(projected);
  }
  return { items, isDone,
    continueCursor: isDone ? null : await sealCatalogCursor(initial(scope, keyFor(emitted.at(-1)!)), scope),
    phase: "ready" as const, budget: diagnostics() };
}

export const artifactGraphPage = (ctx: QueryCtx, args: ArtifactGraphArgs) => graphPage(ctx, { ...args, kind: "artifacts" });
export const workspaceGraphPage = (ctx: QueryCtx, args: WorkspaceGraphArgs) => graphPage(ctx, { ...args, kind: "workspaces" });

const pageArgs = { cursor: v.optional(v.string()), limit: v.optional(v.number()), search: v.optional(v.string()) };
export const listWorkspaces = query({
  args: { ...pageArgs, includeArchived: v.optional(v.boolean()) },
  handler: workspaceGraphPage,
});
export const listArtifacts = query({
  args: { ...pageArgs, status: v.optional(v.union(v.literal("active"), v.literal("archived"), v.literal("deleted"))),
    blueprintKey: v.optional(v.string()), placement: v.optional(v.union(v.literal("all"), v.literal("shared"))) },
  handler: artifactGraphPage,
});
export const agentGraphPage = (ctx: QueryCtx, args: { cursor?: string }) => graphPage(ctx, {
  ...args, kind: "artifacts", blueprintKey: "agent", limit: 8, agentCards: true,
});
export const listAgents = query({ args: { cursor: v.optional(v.string()) }, handler: agentGraphPage });
export const identity = query({ args: {}, handler: async (ctx) => {
  try {
    const actor = await actorFor(ctx, new Budget());
    return { accountId: actor.accountId, schoolId: actor.schoolId, membershipId: actor.membershipId };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("AUTH_NO_SCHOOL")) return null;
    throw error;
  }
} });
export const workspaceMetadata = query({
  args: { workspaceId: v.id("spectraWorkspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { actor, workspace } = await requireWorkspaceCapability(ctx, workspaceId, "read");
    return { workspace: workspace.status === "active"
      ? project(workspace, actor, await sharedByOwner(ctx, new Budget(), actor, workspace)) : null };
  },
});
