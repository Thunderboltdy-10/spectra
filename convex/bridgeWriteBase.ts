import type { WithoutSystemFields } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import { storedFidelityMap } from "../shared/fidelity-map-storage";

/*
 * A Bridge write carries the document Spectra had when it asked for the
 * write, so the acknowledgement can record it as the next merge base. That
 * body can be megabytes, and write requests are read in batches by every
 * claim, scan and conflict check. It lives beside the request instead, read
 * once at acknowledgement and dropped when the request is finished.
 * Requests written before this keep their inline body and are read as-is.
 */

type Fields = WithoutSystemFields<Doc<"bridgeWriteRequests">>;

export type WriteRequestBase = {
  projectionBaseContent?: unknown;
  projectionBaseTextIndex?: string;
  projectionBaseFidelityMap?: unknown;
};

const TERMINAL = new Set(["verified", "failed", "conflicted"]);

export async function insertWriteRequest(db: DatabaseWriter, fields: Fields): Promise<Id<"bridgeWriteRequests">> {
  const { projectionBaseContent, projectionBaseTextIndex, projectionBaseFidelityMap, ...light } = fields;
  const requestId = await db.insert("bridgeWriteRequests", light);
  if (projectionBaseContent !== undefined || projectionBaseTextIndex !== undefined || projectionBaseFidelityMap !== undefined)
    await db.insert("bridgeWriteBases", {
      requestId,
      content: projectionBaseContent,
      textIndex: projectionBaseTextIndex,
      fidelityMap: projectionBaseFidelityMap === undefined ? undefined : storedFidelityMap(projectionBaseFidelityMap),
      createdAt: fields.createdAt,
    });
  return requestId;
}

function hasInline(request: Doc<"bridgeWriteRequests">) {
  return request.projectionBaseContent !== undefined ||
    request.projectionBaseTextIndex !== undefined ||
    request.projectionBaseFidelityMap !== undefined;
}

export async function writeRequestBase(db: DatabaseReader, request: Doc<"bridgeWriteRequests">): Promise<WriteRequestBase> {
  if (hasInline(request)) return {
    projectionBaseContent: request.projectionBaseContent,
    projectionBaseTextIndex: request.projectionBaseTextIndex,
    projectionBaseFidelityMap: request.projectionBaseFidelityMap,
  };
  const row = await db.query("bridgeWriteBases").withIndex("by_request", (q) => q.eq("requestId", request._id)).unique();
  return row ? {
    projectionBaseContent: row.content,
    projectionBaseTextIndex: row.textIndex,
    projectionBaseFidelityMap: row.fidelityMap,
  } : {};
}

/** Frees a finished request's body (sidecar or inline). Returns whether there was one. */
export async function dropWriteRequestBase(db: DatabaseWriter, request: Doc<"bridgeWriteRequests">) {
  const row = await db.query("bridgeWriteBases").withIndex("by_request", (q) => q.eq("requestId", request._id)).unique();
  if (row) await db.delete(row._id);
  if (hasInline(request))
    await db.patch(request._id, { projectionBaseContent: undefined, projectionBaseTextIndex: undefined, projectionBaseFidelityMap: undefined });
  return Boolean(row) || hasInline(request);
}

export function isFinishedWriteRequest(request: Pick<Doc<"bridgeWriteRequests">, "state">) {
  return TERMINAL.has(request.state);
}

/** A finished request's body is freed within the hour, however it finished. */
const FINISHED_GRACE_MS = 60 * 60_000;

export const sweepFinishedBases = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("bridgeWriteBases")
      .withIndex("by_created", (q) => q.lt("createdAt", Date.now() - FINISHED_GRACE_MS))
      .take(100);
    let freed = 0;
    for (const row of rows) {
      const request = await ctx.db.get(row.requestId);
      if (request && !isFinishedWriteRequest(request)) continue;
      await ctx.db.delete(row._id);
      freed += 1;
    }
    return { freed };
  },
});

/** One-time move of bodies written inline before the sidecar; finished requests just drop theirs. */
export const moveInlineBasesMigration = internalMutation({
  args: {},
  handler: async (ctx) => {
    const key = "write-request-base-sidecar-v1";
    let migration = await ctx.db.query("replicaTruthMigrations").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (migration?.state === "complete") return { state: "complete" as const, moved: 0 };
    const now = Date.now();
    if (!migration) {
      const id = await ctx.db.insert("replicaTruthMigrations", { key, state: "running", scanned: 0, repaired: 0, conflicts: 0, createdAt: now, updatedAt: now });
      migration = await ctx.db.get(id);
    }
    if (!migration) throw new Error("WRITE_BASE_MIGRATION_MISSING");
    const page = await ctx.db.query("bridgeWriteRequests").paginate({ cursor: migration.cursor ?? null, numItems: 20 });
    let moved = 0;
    for (const request of page.page) {
      if (!hasInline(request)) continue;
      if (!isFinishedWriteRequest(request)) {
        const existing = await ctx.db.query("bridgeWriteBases").withIndex("by_request", (q) => q.eq("requestId", request._id)).unique();
        if (!existing) await ctx.db.insert("bridgeWriteBases", {
          requestId: request._id,
          content: request.projectionBaseContent,
          textIndex: request.projectionBaseTextIndex,
          fidelityMap: request.projectionBaseFidelityMap === undefined ? undefined : storedFidelityMap(request.projectionBaseFidelityMap),
          createdAt: request.createdAt,
        });
      }
      await ctx.db.patch(request._id, { projectionBaseContent: undefined, projectionBaseTextIndex: undefined, projectionBaseFidelityMap: undefined });
      moved += 1;
    }
    await ctx.db.patch(migration._id, {
      state: page.isDone ? "complete" : "running",
      cursor: page.isDone ? undefined : page.continueCursor,
      scanned: migration.scanned + page.page.length,
      repaired: migration.repaired + moved,
      updatedAt: Date.now(),
    });
    if (!page.isDone) await ctx.scheduler.runAfter(2_000, internal.bridgeWriteBase.moveInlineBasesMigration, {});
    return { state: page.isDone ? "complete" as const : "running" as const, moved };
  },
});
