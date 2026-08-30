import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { evaluateAccessForActor } from "./authorityShared";
import { getAuthenticatedActor } from "./identityShared";
import { requireArtifactCapability } from "./spectraShared";
import { loadVersionAfter } from "./artifactSnapshots";
import {
  projectArtifactForAccess,
  projectQuizSnapshotForLearner,
  projectTimetableSnapshot,
} from "./quizPrivacy";
import {
  artifactEmbedContainerTypeValidator,
  artifactEmbedContextPolicyValidator,
  artifactEmbedInteractionValidator,
  artifactEmbedModeValidator,
  artifactEmbedVersionPolicyValidator,
  type ArtifactEmbedReference,
} from "../shared/artifact-embed";
import { sheetCellEntries } from "../shared/sheet-cells";

type EmbedCtx = QueryCtx | MutationCtx;
type EmbedActor = NonNullable<
  Awaited<ReturnType<typeof getAuthenticatedActor>>
>;

async function actor(ctx: EmbedCtx) {
  const value = await getAuthenticatedActor(ctx);
  if (!value)
    throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return value;
}

async function requireContainer(
  ctx: EmbedCtx,
  actorValue: EmbedActor,
  type: "artifact" | "thread",
  id: string,
  capability: "read" | "modify",
) {
  if (type === "artifact") {
    const artifactId = ctx.db.normalizeId("spectraArtifacts", id);
    if (!artifactId) throw new Error("EMBED_CONTAINER_NOT_FOUND");
    const result = await requireArtifactCapability(ctx, artifactId, capability);
    return {
      schoolId: result.artifact.schoolId,
      container: result.artifact,
      canConfigure: result.capabilities.includes("modify"),
    };
  }
  const threadId = ctx.db.normalizeId("spectraThreads", id);
  const thread = threadId ? await ctx.db.get(threadId) : null;
  if (
    !thread ||
    thread.status === "deleted" ||
    thread.ownerAccountId !== actorValue.accountId ||
    thread.schoolId !== actorValue.schoolId
  )
    throw new Error("EMBED_CONTAINER_NOT_FOUND");
  return { schoolId: thread.schoolId, container: thread, canConfigure: true };
}

async function sourceDecision(
  ctx: EmbedCtx,
  actorValue: EmbedActor,
  sourceArtifactId: Id<"spectraArtifacts">,
) {
  const source = await ctx.db.get(sourceArtifactId);
  if (!source) return { source: null, decision: null };
  const decision = await evaluateAccessForActor(
    ctx,
    actorValue,
    source.blueprintKey === "agent" ? "agent" : "artifact",
    source._id,
  );
  return { source, decision };
}

function sheetPoint(address: string) {
  const match = address
    .trim()
    .toUpperCase()
    .match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  let column = 0;
  for (const character of match[1]!)
    column = column * 26 + character.charCodeAt(0) - 64;
  return { row: Number(match[2]), column };
}

function sheetsRangeProjection(content: unknown, rangeValue?: string) {
  const workbook =
    content && typeof content === "object" && !Array.isArray(content)
      ? (content as Record<string, unknown>)
      : {};
  const sheets = Array.isArray(workbook.sheets)
    ? workbook.sheets.filter((value): value is Record<string, unknown> =>
        Boolean(value && typeof value === "object" && !Array.isArray(value)),
      )
    : [];
  const range = rangeValue?.trim() || "A1:J30";
  const [sheetName, boundsText] = range.includes("!")
    ? range.split("!", 2)
    : [undefined, range];
  const sheet =
    sheets.find((candidate) => String(candidate.name ?? "") === sheetName) ??
    sheets.find(
      (candidate) => String(candidate.id ?? "") === workbook.activeSheetId,
    ) ??
    sheets[0];
  const bounds = (boundsText || "A1:J30").split(":", 2);
  const start = sheetPoint(bounds[0] || "A1");
  const end = sheetPoint(bounds[1] || bounds[0] || "J30");
  const selected: Record<string, unknown> = {};
  if (start && end)
    for (const [address, value] of sheetCellEntries(sheet?.cells)) {
      const point = sheetPoint(address);
      if (
        !point ||
        point.row < Math.min(start.row, end.row) ||
        point.row > Math.max(start.row, end.row) ||
        point.column < Math.min(start.column, end.column) ||
        point.column > Math.max(start.column, end.column)
      )
        continue;
      selected[address] = value;
      if (Object.keys(selected).length >= 1_000) break;
    }
  return {
    sheetId: sheet?.id,
    sheetName: sheet?.name,
    range,
    cells: selected,
  };
}

async function codeRuntimeResources(
  ctx: QueryCtx,
  actorValue: EmbedActor,
  source: Doc<"spectraArtifacts">,
  content: unknown,
) {
  if (
    source.blueprintKey !== "code" ||
    !content ||
    typeof content !== "object" ||
    Array.isArray(content)
  )
    return undefined;
  const rawBindings = (content as Record<string, unknown>).resourceBindings;
  const bindings = Array.isArray(rawBindings) ? rawBindings : [];
  const resources: Record<string, unknown> = {};
  let bytes = 0;
  for (const raw of bindings.slice(0, 30)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const binding = raw as Record<string, unknown>;
    if (
      typeof binding.id !== "string" ||
      typeof binding.artifactId !== "string"
    )
      continue;
    const targetId = ctx.db.normalizeId("spectraArtifacts", binding.artifactId);
    const target = targetId ? await ctx.db.get(targetId) : null;
    if (
      !target ||
      target.status !== "active" ||
      target.schoolId !== actorValue.schoolId
    )
      continue;
    const targetDecision = await evaluateAccessForActor(
      ctx,
      actorValue,
      target.blueprintKey === "agent" ? "agent" : "artifact",
      target._id,
    );
    if (
      !targetDecision.allowed ||
      !targetDecision.capabilities.includes("read")
    )
      continue;
    const value =
      binding.kind === "sheets_range" && target.blueprintKey === "sheets"
        ? {
            artifactId: target._id,
            title: target.title,
            blueprintKey: target.blueprintKey,
            ...sheetsRangeProjection(
              target.content,
              typeof binding.range === "string" ? binding.range : undefined,
            ),
          }
        : {
            artifactId: target._id,
            title: target.title,
            blueprintKey: target.blueprintKey,
            content: projectArtifactForAccess(target, targetDecision.level)
              .content,
          };
    const encoded = JSON.stringify(value);
    if (bytes + encoded.length > 180_000) continue;
    resources[binding.id] = value;
    bytes += encoded.length;
  }
  return Object.keys(resources).length ? resources : undefined;
}

async function projection(
  ctx: QueryCtx,
  actorValue: EmbedActor,
  embed: Doc<"artifactEmbeds">,
  canConfigure: boolean,
) {
  const { source, decision } = await sourceDecision(
    ctx,
    actorValue,
    embed.sourceArtifactId,
  );
  const safe: ArtifactEmbedReference & { canConfigure: boolean } = {
    embedId: embed._id,
    containerType: embed.containerType,
    containerId: embed.containerId,
    containerRegionId: embed.containerRegionId,
    sourceArtifactId: embed.sourceArtifactId,
    mode: embed.mode,
    interaction: embed.interaction,
    versionPolicy: embed.versionPolicy,
    pinnedVersionId: embed.pinnedVersionId,
    contextPolicy: embed.contextPolicy,
    displayPreferences: embed.displayPreferences,
    canConfigure,
    state: "ready" as const,
    createdAt: embed.createdAt,
    updatedAt: embed.updatedAt,
  };
  if (embed.removedAt) {
    return { ...safe, state: "removed" as const };
  }
  if (
    source &&
    source.schoolId === actorValue.schoolId &&
    source.status === "deleted"
  ) {
    return { ...safe, state: "deleted" as const };
  }
  if (
    !source ||
    !decision?.allowed ||
    !decision.capabilities.includes("read")
  ) {
    const requests =
      source && source.schoolId === actorValue.schoolId
        ? await ctx.db
            .query("artifactAccessRequests")
            .withIndex("by_embed_requester", (q) =>
              q
                .eq("embedId", embed._id)
                .eq("requesterAccountId", actorValue.accountId),
            )
            .order("desc")
            .collect()
        : [];
    const pending = requests.find((request) => request.status === "pending");
    return {
      ...safe,
      state: "no_access" as const,
      canRequestAccess: Boolean(
        source && source.schoolId === actorValue.schoolId && !pending,
      ),
      accessRequest: pending
        ? {
            requestId: pending._id,
            status: "pending" as const,
            createdAt: pending.createdAt,
          }
        : undefined,
    };
  }
  let snapshot: unknown = {
    title: source.title,
    summary: source.summary,
    tags: source.tags,
    content: source.content,
  };
  let version:
    | {
        versionId: Id<"spectraArtifactVersions">;
        createdAt: number;
        summary?: string;
        name?: string;
      }
    | undefined;
  if (embed.versionPolicy === "pinned") {
    const pinned = embed.pinnedVersionId
      ? await ctx.db.get(embed.pinnedVersionId)
      : null;
    if (!pinned || pinned.artifactId !== source._id) {
      return {
        ...safe,
        state: "version_unavailable" as const,
        source: {
          artifactId: source._id,
          title: source.title,
          blueprintKey: source.blueprintKey,
        },
      };
    }
    try {
      snapshot = await loadVersionAfter(ctx, pinned);
    } catch {
      return {
        ...safe,
        state: "version_unavailable" as const,
        source: {
          artifactId: source._id,
          title: source.title,
          blueprintKey: source.blueprintKey,
        },
      };
    }
    version = {
      versionId: pinned._id,
      createdAt: pinned.createdAt,
      summary: pinned.summary,
      name: pinned.name,
    };
  }
  if (source.blueprintKey === "quiz" && decision.level !== "modify") {
    snapshot = projectQuizSnapshotForLearner(snapshot);
  } else if (source.blueprintKey === "timetable") {
    snapshot = projectTimetableSnapshot(snapshot);
  }
  const effectiveInteraction =
    embed.interaction === "edit" && !decision.capabilities.includes("modify")
      ? "read"
      : embed.interaction;
  let runtimeBuild;
  let runtimeResources;
  if (source.blueprintKey === "code") {
    const candidates =
      embed.versionPolicy === "pinned" && embed.pinnedVersionId
        ? await ctx.db
            .query("spectraRuntimeBuilds")
            .withIndex("by_artifact_version", (q) =>
              q
                .eq("artifactId", source._id)
                .eq("artifactVersionId", embed.pinnedVersionId!),
            )
            .collect()
        : await ctx.db
            .query("spectraRuntimeBuilds")
            .withIndex("by_artifact_status", (q) =>
              q.eq("artifactId", source._id).eq("status", "published"),
            )
            .collect();
    const selected = candidates
      .filter(
        (candidate) =>
          (candidate.status === "published" ||
            candidate.status === "superseded") &&
          candidate.storageId,
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (selected) {
      runtimeBuild = {
        buildId: selected._id,
        artifactVersionId: selected.artifactVersionId,
        runtime: selected.runtime,
        sourceHash: selected.sourceHash,
        payloadHash: selected.payloadHash,
        sdkVersion: selected.sdkVersion,
        sourceBytes: selected.sourceBytes,
        outputBytes: selected.outputBytes,
        payloadBytes: selected.payloadBytes,
        publishedAt: selected.publishedAt,
      };
    }
    const snapshotRecord =
      snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
        ? (snapshot as Record<string, unknown>)
        : {};
    runtimeResources = await codeRuntimeResources(
      ctx,
      actorValue,
      source,
      snapshotRecord.content ?? source.content,
    );
  }
  return {
    ...safe,
    state:
      source.status === "archived" ? ("archived" as const) : ("ready" as const),
    effectiveInteraction,
    source: {
      artifactId: source._id,
      title: source.title,
      summary: source.summary,
      blueprintKey: source.blueprintKey,
      tags: source.tags,
      updatedAt: source.updatedAt,
      snapshot,
    },
    version,
    runtimeBuild,
    runtimeResources,
  };
}

function visibleRegionExcerpt(
  value: unknown,
  regionIds: Set<string>,
  results: unknown[],
  depth = 0,
) {
  if (
    results.length >= 24 ||
    depth > 12 ||
    value === null ||
    typeof value !== "object"
  )
    return;
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string" && regionIds.has(record.id)) {
      results.push(record);
      return;
    }
  }
  for (const child of Array.isArray(value) ? value : Object.values(value))
    visibleRegionExcerpt(child, regionIds, results, depth + 1);
}

async function wouldCreateArtifactCycle(
  ctx: MutationCtx,
  containerArtifactId: string,
  sourceArtifactId: Id<"spectraArtifacts">,
) {
  if (containerArtifactId === sourceArtifactId) return true;
  const visited = new Set<string>();
  const pending = [String(sourceArtifactId)];
  while (pending.length > 0 && visited.size < 128) {
    const artifactId = pending.shift()!;
    if (artifactId === containerArtifactId) return true;
    if (visited.has(artifactId)) continue;
    visited.add(artifactId);
    const children = await ctx.db
      .query("artifactEmbeds")
      .withIndex("by_container", (q) =>
        q.eq("containerType", "artifact").eq("containerId", artifactId),
      )
      .collect();
    for (const child of children)
      if (!child.removedAt) pending.push(String(child.sourceArtifactId));
  }
  if (pending.length > 0)
    throw new Error(
      "EMBED_GRAPH_LIMIT: This embed graph is too deep to validate safely.",
    );
  return false;
}

export const create = mutation({
  args: {
    containerType: artifactEmbedContainerTypeValidator,
    containerId: v.string(),
    containerRegionId: v.string(),
    sourceArtifactId: v.id("spectraArtifacts"),
    mode: artifactEmbedModeValidator,
    interaction: artifactEmbedInteractionValidator,
    versionPolicy: artifactEmbedVersionPolicyValidator,
    pinnedVersionId: v.optional(v.id("spectraArtifactVersions")),
    displayPreferences: v.optional(v.any()),
    contextPolicy: artifactEmbedContextPolicyValidator,
  },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const container = await requireContainer(
      ctx,
      actorValue,
      args.containerType,
      args.containerId,
      "modify",
    );
    const source = await requireArtifactCapability(
      ctx,
      args.sourceArtifactId,
      args.interaction === "edit" ? "modify" : "read",
    );
    if (
      container.schoolId !== source.artifact.schoolId ||
      source.artifact.schoolId !== actorValue.schoolId
    )
      throw new Error("EMBED_SCHOOL_BOUNDARY");
    if (!args.containerRegionId.trim())
      throw new Error("EMBED_CONTAINER_REGION_REQUIRED");
    if (
      args.containerType === "artifact" &&
      (await wouldCreateArtifactCycle(
        ctx,
        args.containerId,
        args.sourceArtifactId,
      ))
    )
      throw new Error(
        "EMBED_CYCLE: An artifact cannot embed itself directly or indirectly.",
      );
    if (args.versionPolicy === "pinned") {
      if (!args.pinnedVersionId)
        throw new Error("EMBED_PINNED_VERSION_REQUIRED");
      const version = await ctx.db.get(args.pinnedVersionId);
      if (!version || version.artifactId !== args.sourceArtifactId)
        throw new Error("EMBED_PINNED_VERSION_INVALID");
      await loadVersionAfter(ctx, version);
    }
    const now = Date.now();
    const embedId = await ctx.db.insert("artifactEmbeds", {
      containerType: args.containerType,
      containerId: args.containerId.trim(),
      containerRegionId: args.containerRegionId.trim().slice(0, 240),
      sourceArtifactId: args.sourceArtifactId,
      schoolId: actorValue.schoolId,
      mode: args.mode,
      interaction: args.interaction,
      versionPolicy: args.versionPolicy,
      pinnedVersionId:
        args.versionPolicy === "pinned" ? args.pinnedVersionId : undefined,
      displayPreferences: args.displayPreferences,
      contextPolicy: args.contextPolicy,
      createdByAccountId: actorValue.accountId,
      createdAt: now,
      updatedAt: now,
    });
    return { embedId };
  },
});

/**
 * One-way adoption for protocol-v2 document nodes. The legacy reference id is
 * converted into a stable container region, so concurrent opens converge on
 * one server row instead of duplicating the same historical placement.
 */
export const migrateLegacy = mutation({
  args: {
    containerId: v.string(),
    legacyReferenceId: v.string(),
    sourceArtifactId: v.id("spectraArtifacts"),
    mode: artifactEmbedModeValidator,
    versionPolicy: artifactEmbedVersionPolicyValidator,
    pinnedVersionId: v.optional(v.id("spectraArtifactVersions")),
    displayPreferences: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const legacyReferenceId = args.legacyReferenceId.trim().slice(0, 180);
    if (!legacyReferenceId)
      throw new Error("EMBED_LEGACY_REFERENCE_ID_REQUIRED");
    const containerRegionId = `document:reference:${legacyReferenceId}`;
    const container = await requireContainer(
      ctx,
      actorValue,
      "artifact",
      args.containerId,
      "modify",
    );
    const source = await requireArtifactCapability(
      ctx,
      args.sourceArtifactId,
      "read",
    );
    if (
      container.schoolId !== source.artifact.schoolId ||
      source.artifact.schoolId !== actorValue.schoolId
    )
      throw new Error("EMBED_SCHOOL_BOUNDARY");
    if (
      await wouldCreateArtifactCycle(
        ctx,
        args.containerId,
        args.sourceArtifactId,
      )
    )
      throw new Error(
        "EMBED_CYCLE: An artifact cannot embed itself directly or indirectly.",
      );
    const existing = (
      await ctx.db
        .query("artifactEmbeds")
        .withIndex("by_container", (q) =>
          q.eq("containerType", "artifact").eq("containerId", args.containerId),
        )
        .collect()
    ).find(
      (candidate) =>
        candidate.containerRegionId === containerRegionId &&
        candidate.sourceArtifactId === args.sourceArtifactId,
    );
    if (existing) {
      if (existing.removedAt)
        await ctx.db.patch(existing._id, {
          removedAt: undefined,
          updatedAt: Date.now(),
        });
      return { embedId: existing._id, containerRegionId };
    }
    if (args.versionPolicy === "pinned") {
      if (!args.pinnedVersionId)
        throw new Error("EMBED_PINNED_VERSION_REQUIRED");
      const version = await ctx.db.get(args.pinnedVersionId);
      if (!version || version.artifactId !== args.sourceArtifactId)
        throw new Error("EMBED_PINNED_VERSION_INVALID");
      await loadVersionAfter(ctx, version);
    }
    const now = Date.now();
    const embedId = await ctx.db.insert("artifactEmbeds", {
      containerType: "artifact",
      containerId: args.containerId,
      containerRegionId,
      sourceArtifactId: args.sourceArtifactId,
      schoolId: actorValue.schoolId,
      mode: args.mode,
      interaction: "read",
      versionPolicy: args.versionPolicy,
      pinnedVersionId:
        args.versionPolicy === "pinned" ? args.pinnedVersionId : undefined,
      displayPreferences: args.displayPreferences,
      contextPolicy: "summary",
      createdByAccountId: actorValue.accountId,
      createdAt: now,
      updatedAt: now,
    });
    return { embedId, containerRegionId };
  },
});

export const update = mutation({
  args: {
    embedId: v.id("artifactEmbeds"),
    containerRegionId: v.optional(v.string()),
    mode: v.optional(artifactEmbedModeValidator),
    interaction: v.optional(artifactEmbedInteractionValidator),
    versionPolicy: v.optional(artifactEmbedVersionPolicyValidator),
    pinnedVersionId: v.optional(v.id("spectraArtifactVersions")),
    displayPreferences: v.optional(v.any()),
    contextPolicy: v.optional(artifactEmbedContextPolicyValidator),
  },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const embed = await ctx.db.get(args.embedId);
    if (!embed || embed.removedAt) throw new Error("EMBED_NOT_FOUND");
    await requireContainer(
      ctx,
      actorValue,
      embed.containerType,
      embed.containerId,
      "modify",
    );
    const nextInteraction = args.interaction ?? embed.interaction;
    await requireArtifactCapability(
      ctx,
      embed.sourceArtifactId,
      nextInteraction === "edit" ? "modify" : "read",
    );
    const nextVersionPolicy = args.versionPolicy ?? embed.versionPolicy;
    const nextContainerRegionId =
      args.containerRegionId === undefined
        ? embed.containerRegionId
        : args.containerRegionId.trim().slice(0, 240);
    if (!nextContainerRegionId)
      throw new Error("EMBED_CONTAINER_REGION_REQUIRED");
    const nextPinnedVersionId =
      nextVersionPolicy === "pinned"
        ? (args.pinnedVersionId ?? embed.pinnedVersionId)
        : undefined;
    if (nextVersionPolicy === "pinned") {
      const version = nextPinnedVersionId
        ? await ctx.db.get(nextPinnedVersionId)
        : null;
      if (!version || version.artifactId !== embed.sourceArtifactId)
        throw new Error("EMBED_PINNED_VERSION_INVALID");
      await loadVersionAfter(ctx, version);
    }
    await ctx.db.patch(embed._id, {
      containerRegionId: nextContainerRegionId,
      mode: args.mode ?? embed.mode,
      interaction: nextInteraction,
      versionPolicy: nextVersionPolicy,
      pinnedVersionId: nextPinnedVersionId,
      displayPreferences:
        args.displayPreferences === undefined
          ? embed.displayPreferences
          : args.displayPreferences,
      contextPolicy: args.contextPolicy ?? embed.contextPolicy,
      updatedAt: Date.now(),
    });
    return { embedId: embed._id };
  },
});

export const remove = mutation({
  args: { embedId: v.id("artifactEmbeds") },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const embed = await ctx.db.get(args.embedId);
    if (!embed || embed.removedAt) return { removed: false };
    await requireContainer(
      ctx,
      actorValue,
      embed.containerType,
      embed.containerId,
      "modify",
    );
    const now = Date.now();
    await ctx.db.patch(embed._id, { removedAt: now, updatedAt: now });
    const pendingRequests = await ctx.db
      .query("artifactAccessRequests")
      .withIndex("by_embed_status", (q) =>
        q.eq("embedId", embed._id).eq("status", "pending"),
      )
      .collect();
    await Promise.all(
      pendingRequests.map((request) =>
        ctx.db.patch(request._id, {
          status: "cancelled",
          updatedAt: now,
          resolvedAt: now,
          resolvedByAccountId: actorValue.accountId,
        }),
      ),
    );
    return { removed: true };
  },
});

export const removeMany = mutation({
  args: { embedIds: v.array(v.id("artifactEmbeds")) },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const ids = [...new Set(args.embedIds)];
    if (ids.length > 64)
      throw new Error("Remove at most 64 linked objects at a time.");
    const embeds = (
      await Promise.all(ids.map((embedId) => ctx.db.get(embedId)))
    ).filter((embed): embed is Doc<"artifactEmbeds"> => Boolean(embed));
    for (const embed of embeds) {
      if (embed.removedAt) continue;
      await requireContainer(
        ctx,
        actorValue,
        embed.containerType,
        embed.containerId,
        "modify",
      );
    }
    const active = embeds.filter((embed) => !embed.removedAt);
    const now = Date.now();
    await Promise.all(
      active.map((embed) =>
        ctx.db.patch(embed._id, { removedAt: now, updatedAt: now }),
      ),
    );
    const pendingRequests = (
      await Promise.all(
        active.map((embed) =>
          ctx.db
            .query("artifactAccessRequests")
            .withIndex("by_embed_status", (q) =>
              q.eq("embedId", embed._id).eq("status", "pending"),
            )
            .collect(),
        ),
      )
    ).flat();
    await Promise.all(
      pendingRequests.map((request) =>
        ctx.db.patch(request._id, {
          status: "cancelled",
          updatedAt: now,
          resolvedAt: now,
          resolvedByAccountId: actorValue.accountId,
        }),
      ),
    );
    return { removed: active.length };
  },
});

/** Restores the same row when a host-level Undo brings its placement back. */
export const restore = mutation({
  args: { embedId: v.id("artifactEmbeds") },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const embed = await ctx.db.get(args.embedId);
    if (!embed) throw new Error("EMBED_NOT_FOUND");
    if (!embed.removedAt) return { restored: false };
    const container = await requireContainer(
      ctx,
      actorValue,
      embed.containerType,
      embed.containerId,
      "modify",
    );
    if (embed.schoolId && container.schoolId !== embed.schoolId)
      throw new Error("EMBED_SCHOOL_BOUNDARY");
    if (
      embed.containerType === "artifact" &&
      (await wouldCreateArtifactCycle(
        ctx,
        embed.containerId,
        embed.sourceArtifactId,
      ))
    )
      throw new Error(
        "EMBED_CYCLE: An artifact cannot embed itself directly or indirectly.",
      );
    await ctx.db.patch(embed._id, {
      removedAt: undefined,
      updatedAt: Date.now(),
    });
    return { restored: true };
  },
});

export const listForContainer = query({
  args: {
    containerType: artifactEmbedContainerTypeValidator,
    containerId: v.string(),
  },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const container = await requireContainer(
      ctx,
      actorValue,
      args.containerType,
      args.containerId,
      "read",
    );
    const rows = await ctx.db
      .query("artifactEmbeds")
      .withIndex("by_container", (q) =>
        q
          .eq("containerType", args.containerType)
          .eq("containerId", args.containerId),
      )
      .collect();
    return {
      canConfigure: container.canConfigure,
      embeds: await Promise.all(
        rows
          .filter((embed) => !embed.removedAt)
          .map((embed) =>
            projection(ctx, actorValue, embed, container.canConfigure),
          ),
      ),
    };
  },
});

export const getProjection = query({
  args: { embedId: v.id("artifactEmbeds") },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const embed = await ctx.db.get(args.embedId);
    if (!embed) throw new Error("EMBED_NOT_FOUND");
    const container = await requireContainer(
      ctx,
      actorValue,
      embed.containerType,
      embed.containerId,
      "read",
    );
    return projection(ctx, actorValue, embed, container.canConfigure);
  },
});

/**
 * The authenticated Next route is the only product consumer. Ordinary embed
 * projections never receive this bearer URL; the route streams and verifies
 * the bytes while the browser only sees a same-origin embed id.
 */
export const runtimeBuildAccess = query({
  args: { embedId: v.id("artifactEmbeds") },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const embed = await ctx.db.get(args.embedId);
    if (!embed || embed.removedAt) throw new Error("EMBED_NOT_FOUND");
    await requireContainer(
      ctx,
      actorValue,
      embed.containerType,
      embed.containerId,
      "read",
    );
    const { source, decision } = await sourceDecision(
      ctx,
      actorValue,
      embed.sourceArtifactId,
    );
    if (
      !source ||
      source.blueprintKey !== "code" ||
      source.status === "deleted" ||
      !decision?.allowed ||
      !decision.capabilities.includes("read")
    )
      throw new Error("AUTH_NO_ACCESS");
    const candidates =
      embed.versionPolicy === "pinned" && embed.pinnedVersionId
        ? await ctx.db
            .query("spectraRuntimeBuilds")
            .withIndex("by_artifact_version", (q) =>
              q
                .eq("artifactId", source._id)
                .eq("artifactVersionId", embed.pinnedVersionId!),
            )
            .collect()
        : await ctx.db
            .query("spectraRuntimeBuilds")
            .withIndex("by_artifact_status", (q) =>
              q.eq("artifactId", source._id).eq("status", "published"),
            )
            .collect();
    const selected = candidates
      .filter(
        (candidate) =>
          (candidate.status === "published" ||
            candidate.status === "superseded") &&
          candidate.storageId &&
          candidate.payloadHash &&
          candidate.payloadBytes !== undefined,
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    const storageUrl = selected?.storageId
      ? await ctx.storage.getUrl(selected.storageId)
      : null;
    if (!selected || !storageUrl) throw new Error("RUNTIME_BUILD_UNAVAILABLE");
    return {
      storageUrl,
      payloadHash: selected.payloadHash!,
      payloadBytes: selected.payloadBytes!,
      runtime: selected.runtime,
      artifactVersionId: selected.artifactVersionId,
      sdkVersion: selected.sdkVersion,
    };
  },
});

export const contextContribution = query({
  args: { embedId: v.id("artifactEmbeds") },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const embed = await ctx.db.get(args.embedId);
    if (!embed || embed.removedAt) throw new Error("EMBED_NOT_FOUND");
    await requireContainer(
      ctx,
      actorValue,
      embed.containerType,
      embed.containerId,
      "read",
    );
    if (embed.contextPolicy === "none")
      return { policy: "none" as const, contribution: null };
    const { source, decision } = await sourceDecision(
      ctx,
      actorValue,
      embed.sourceArtifactId,
    );
    if (
      !source ||
      source.status === "deleted" ||
      !decision?.allowed ||
      !decision.capabilities.includes("read")
    )
      return { policy: embed.contextPolicy, contribution: null };
    let content: unknown;
    if (embed.versionPolicy === "pinned" && embed.pinnedVersionId) {
      const version = await ctx.db.get(embed.pinnedVersionId);
      content =
        version?.artifactId === source._id
          ? await loadVersionAfter(ctx, version)
          : undefined;
    } else content = source.content;
    if (source.blueprintKey === "quiz" && decision.level !== "modify") {
      content = projectQuizSnapshotForLearner(content);
    } else if (source.blueprintKey === "timetable") {
      content = projectTimetableSnapshot(content);
    }
    const base = {
      artifactId: source._id,
      title: source.title,
      summary: source.summary,
      blueprintKey: source.blueprintKey,
      versionId: embed.pinnedVersionId,
    };
    if (embed.contextPolicy === "summary")
      return {
        policy: "summary" as const,
        contribution: base,
        provenance: {
          containerType: embed.containerType,
          containerId: embed.containerId,
          embedId: embed._id,
          sourceArtifactId: source._id,
        },
      };
    const preferences =
      embed.displayPreferences && typeof embed.displayPreferences === "object"
        ? (embed.displayPreferences as Record<string, unknown>)
        : {};
    const ids = Array.isArray(preferences.regionIds)
      ? preferences.regionIds
          .filter((value): value is string => typeof value === "string")
          .slice(0, 24)
      : [];
    const visible: unknown[] = [];
    visibleRegionExcerpt(content, new Set(ids), visible);
    return {
      policy: "visible_region" as const,
      contribution: {
        ...base,
        visible: JSON.stringify(visible.length ? visible : content).slice(
          0,
          12_000,
        ),
      },
      provenance: {
        containerType: embed.containerType,
        containerId: embed.containerId,
        embedId: embed._id,
        sourceArtifactId: source._id,
      },
    };
  },
});
