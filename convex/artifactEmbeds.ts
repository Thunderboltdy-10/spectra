import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./functions";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { evaluateAccessForActor } from "./authorityShared";
import { evaluateRetainedPinAccess } from "./retainedPinAccess";
import { getAuthenticatedActor, getOptionalAuthenticatedActor } from "./identityShared";
import { requireArtifactCapability } from "./spectraShared";
import { loadVersionAfter, releaseVersionIfUnpinned } from "./artifactSnapshots";
import { isSurvivingEmbed } from "./artifactEmbedOwnership";
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
  // Ordinary source access never admits a tombstone. Retained consumers use
  // the exact-pin evaluator below; avoid an extra doomed generic lookup.
  if (source.status === "deleted") return { source, decision: null };
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
  const sourceUnavailable = source?.status === "deleted";
  const retainedPinnedSource = Boolean(
    sourceUnavailable &&
    !embed.removedAt &&
    embed.versionPolicy === "pinned" &&
    embed.pinnedVersionId,
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
    sourceUnavailable,
    canConfigure,
    state: "ready" as const,
    createdAt: embed.createdAt,
    updatedAt: embed.updatedAt,
  };
  if (embed.removedAt) {
    return { ...safe, state: "removed" as const };
  }
  // A retained placement only selects a version. The shared evaluator proves
  // the actual current placement and independent source rights on every read.
  const retainedAccess = retainedPinnedSource
    ? await evaluateRetainedPinAccess(ctx, actorValue, embed._id)
    : null;
  if (retainedAccess && !retainedAccess.allowed) {
    if (
      retainedAccess.reason === "placement_unavailable" ||
      retainedAccess.reason === "version_unavailable"
    )
      return {
        ...safe,
        state: "version_unavailable" as const,
        ...(retainedAccess.reason === "placement_unavailable" &&
        retainedAccess.placementRefreshKey
          ? { placementRefreshKey: retainedAccess.placementRefreshKey }
          : {}),
      };
    return { ...safe, state: "no_access" as const, canRequestAccess: false };
  }
  if (sourceUnavailable && !retainedPinnedSource) {
    return { ...safe, state: "deleted" as const };
  }
  if (
    (!source ||
      !decision?.allowed ||
      !decision.capabilities.includes("read")) &&
    !retainedPinnedSource
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
  if (!source) return { ...safe, state: "no_access" as const };
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
    const pinned = retainedAccess?.allowed
      ? retainedAccess.version
      : embed.pinnedVersionId
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
        ...(retainedAccess?.allowed
          ? {}
          : {
              source: {
                artifactId: source._id,
                title: source.title,
                blueprintKey: source.blueprintKey,
              },
            }),
      };
    }
    version = {
      versionId: pinned._id,
      createdAt: pinned.createdAt,
      summary: pinned.summary,
      name: pinned.name,
    };
  }
  const sourceLevel = retainedAccess?.allowed
    ? retainedAccess.sourceLevel
    : decision?.level;
  if (source.blueprintKey === "quiz" && sourceLevel !== "modify") {
    snapshot = projectQuizSnapshotForLearner(snapshot);
  } else if (source.blueprintKey === "timetable") {
    snapshot = projectTimetableSnapshot(snapshot);
  }
  const effectiveInteraction =
    retainedAccess?.allowed ||
    (embed.interaction === "edit" && !decision?.capabilities.includes("modify"))
      ? "read"
      : embed.interaction;
  let runtimeBuild;
  let runtimeResources;
  const snapshotRecord =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>)
      : {};
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
    runtimeResources = await codeRuntimeResources(
      ctx,
      actorValue,
      source,
      retainedAccess?.allowed
        ? snapshotRecord.content
        : (snapshotRecord.content ?? source.content),
    );
  }
  return {
    ...safe,
    state:
      source.status === "archived" ? ("archived" as const) : ("ready" as const),
    effectiveInteraction,
    // The reader may change the work itself, so it can be edited where it is
    // embedded. A retained pin is read through the placement, never edited.
    canEditSource: Boolean(
      !retainedAccess?.allowed && decision?.capabilities.includes("modify"),
    ),
    source: {
      artifactId: source._id,
      title: retainedAccess?.allowed
        ? typeof snapshotRecord.title === "string"
          ? snapshotRecord.title
          : "Pinned work"
        : source.title,
      summary: retainedAccess?.allowed
        ? typeof snapshotRecord.summary === "string"
          ? snapshotRecord.summary
          : undefined
        : source.summary,
      blueprintKey: source.blueprintKey,
      tags: retainedAccess?.allowed
        ? Array.isArray(snapshotRecord.tags)
          ? snapshotRecord.tags.filter(
              (tag): tag is string => typeof tag === "string",
            )
          : []
        : source.tags,
      updatedAt: retainedAccess?.allowed
        ? retainedAccess.version.createdAt
        : source.updatedAt,
      snapshot,
    },
    version,
    runtimeBuild,
    runtimeResources,
  };
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
    placementOperationId: v.optional(v.string()),
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
    const operationId = args.placementOperationId?.trim().slice(0, 180);
    const placementFingerprint = operationId
      ? JSON.stringify({
          actor: String(actorValue.accountId),
          containerType: args.containerType,
          containerId: args.containerId.trim(),
          region: args.containerRegionId.trim(),
          source: String(args.sourceArtifactId),
          versionPolicy: args.versionPolicy,
          pinnedVersionId: args.pinnedVersionId ? String(args.pinnedVersionId) : null,
        })
      : undefined;
    if (operationId) {
      // Prefer live matches, then revive a soft-removed row for the same
      // placementOperationId. `.first()` alone can return a removed provisional
      // and fall through to a duplicate insert.
      const matches = await ctx.db
        .query("artifactEmbeds")
        .withIndex("by_placement_operation", (q) =>
          q.eq("containerType", args.containerType)
            .eq("containerId", args.containerId.trim())
            .eq("placementOperationId", operationId),
        )
        .collect();
      const live = matches.find((embed) => !embed.removedAt);
      if (live) {
        if (live.placementFingerprint && live.placementFingerprint !== placementFingerprint)
          throw new Error("EMBED_PLACEMENT_OPERATION_CONFLICT");
        return { embedId: live._id, idempotent: true };
      }
      const removed = matches.find((embed) => embed.removedAt !== undefined);
      if (removed) {
        if (removed.placementReceipt) throw new Error("EMBED_PLACEMENT_REMOVED: A saved insertion was later removed. Replaying its operation cannot restore it.");
        if (
          removed.placementFingerprint &&
          removed.placementFingerprint !== placementFingerprint
        )
          throw new Error("EMBED_PLACEMENT_OPERATION_CONFLICT");
        await ctx.db.patch(removed._id, {
          containerRegionId: args.containerRegionId.trim().slice(0, 240),
          sourceArtifactId: args.sourceArtifactId,
          mode: args.mode,
          interaction: args.interaction,
          versionPolicy: args.versionPolicy,
          pinnedVersionId:
            args.versionPolicy === "pinned" ? args.pinnedVersionId : undefined,
          displayPreferences: args.displayPreferences,
          contextPolicy: args.contextPolicy,
          removedAt: undefined,
          placementState: "provisional",
          placementFingerprint,
          placementExpiresAt: now + 10 * 60_000,
          updatedAt: now,
        });
        await (ctx.scheduler.runAfter as unknown as (delay: number, fn: unknown, args: unknown) => Promise<unknown>)(
          10 * 60_000,
          (internal as unknown as { artifactEmbeds: { expireProvisional: unknown } }).artifactEmbeds.expireProvisional,
          { embedId: removed._id, placementOperationId: operationId },
        );
        return { embedId: removed._id, idempotent: true };
      }
    }
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
      // Artifact writers confirm only after their canonical insertion commits.
      // Non-editor containers have no second write boundary and are confirmed
      // at creation time.
      placementState: operationId ? "provisional" : "confirmed",
      placementOperationId: operationId,
      placementFingerprint,
      placementExpiresAt: operationId ? now + 10 * 60_000 : undefined,
    });
    if (operationId) {
      await (ctx.scheduler.runAfter as unknown as (delay: number, fn: unknown, args: unknown) => Promise<unknown>)(
        10 * 60_000,
        (internal as unknown as { artifactEmbeds: { expireProvisional: unknown } }).artifactEmbeds.expireProvisional,
        { embedId, placementOperationId: operationId },
      );
    }
    return { embedId };
  },
});

/** Remove an editor intent that never became part of a committed version. */
export const expireProvisional = internalMutation({
  args: { embedId: v.id("artifactEmbeds"), placementOperationId: v.string() },
  handler: async (ctx, args) => {
    const embed = await ctx.db.get(args.embedId);
    if (!embed || embed.placementOperationId !== args.placementOperationId || embed.placementState !== "provisional") return { expired: false };
    if (embed.placementExpiresAt && embed.placementExpiresAt > Date.now()) return { expired: false };
    const source = await ctx.db.get(embed.sourceArtifactId);
    if (source?.status === "deleted" && embed.versionPolicy === "pinned" && embed.pinnedVersionId) return { expired: false };
    await ctx.db.delete(embed._id);
    return { expired: true };
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
      if (!existing.removedAt)
        return { embedId: existing._id, containerRegionId };
      // A removed row is historical evidence, not a reusable insertion
      // receipt. Create a fresh placement so a failed/provisional removal can
      // never be resurrected by a legacy migration.
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
      placementState: "confirmed",
    });
    return { embedId, containerRegionId };
  },
});

function containsCanonicalPlacement(value: unknown, embedId: string, operationId: string, regionId: string, depth = 0): boolean {
  if (depth > 14 || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((entry) => containsCanonicalPlacement(entry, embedId, operationId, regionId, depth + 1));
  if (typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const idMatches = record.embedId === embedId || record.id === embedId;
  const operationMatches = record.placementOperationId === operationId || record.operationId === operationId;
  const regionMatches = record.containerRegionId === regionId || record.regionId === regionId;
  if (idMatches && operationMatches && regionMatches) return true;
  return Object.values(record).some((entry) => containsCanonicalPlacement(entry, embedId, operationId, regionId, depth + 1));
}

/**
 * Called by the canonical change-group writer in the same transaction as the
 * version insert. This is the only path that turns an editor intent into a
 * confirmed placement; a local callback or arbitrary receipt string cannot.
 */
export async function confirmCanonicalPlacements(ctx: MutationCtx, versionId: Id<"spectraArtifactVersions">) {
  const version = await ctx.db.get(versionId);
  if (!version) return 0;
  const content = await loadVersionAfter(ctx, version).catch(() => undefined);
  if (content === undefined) return 0;
  const embeds = await ctx.db.query("artifactEmbeds").withIndex("by_placement_operation", (q) => q.eq("containerType", "artifact").eq("containerId", String(version.artifactId))).collect();
  let confirmed = 0;
  for (const embed of embeds) {
    if (!isSurvivingEmbed(embed) || embed.placementState !== "provisional" || !embed.placementOperationId) continue;
    if (!containsCanonicalPlacement(content, String(embed._id), embed.placementOperationId, embed.containerRegionId)) continue;
    await ctx.db.patch(embed._id, { placementState: "confirmed", placementReceipt: `canonical-version:${String(version._id)}`, placementExpiresAt: undefined, updatedAt: Date.now() });
    confirmed++;
  }
  return confirmed;
}

export const confirmPlacement = mutation({
  args: {
    embedId: v.id("artifactEmbeds"),
    placementOperationId: v.string(),
    canonicalVersionId: v.optional(v.id("spectraArtifactVersions")),
    canonicalChangeGroupId: v.optional(v.id("changeGroups")),
    canonicalOperationId: v.optional(v.id("spectraOperations")),
  },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const embed = await ctx.db.get(args.embedId);
    if (!embed || embed.placementOperationId !== args.placementOperationId.trim()) throw new Error("EMBED_PLACEMENT_NOT_FOUND");
    await requireContainer(ctx, actorValue, embed.containerType, embed.containerId, "modify");
    if (embed.removedAt) throw new Error("EMBED_NOT_FOUND");
    if (embed.placementState === "confirmed") return { embedId: embed._id, confirmed: true, idempotent: true };
    if (embed.placementState !== "provisional") throw new Error("EMBED_PLACEMENT_NOT_PENDING");
    const source = await ctx.db.get(embed.sourceArtifactId);
    if (!source || source.status === "deleted") throw new Error("EMBED_SOURCE_DELETED");
    const decision = await evaluateAccessForActor(ctx, actorValue, source.blueprintKey === "agent" ? "agent" : "artifact", source._id);
    if (!decision.allowed || !decision.capabilities.includes("read")) throw new Error("EMBED_SOURCE_ACCESS_REVOKED");
    if (!args.canonicalVersionId) throw new Error("EMBED_CANONICAL_RECEIPT_REQUIRED");
    const version = await ctx.db.get(args.canonicalVersionId);
    if (!version || embed.containerType !== "artifact" || String(version.artifactId) !== embed.containerId || !containsCanonicalPlacement(await loadVersionAfter(ctx, version), String(embed._id), embed.placementOperationId, embed.containerRegionId)) throw new Error("EMBED_CANONICAL_RECEIPT_INVALID");
    if (args.canonicalChangeGroupId) {
      const group = await ctx.db.get(args.canonicalChangeGroupId);
      if (!group || group.versionId !== version._id || group.artifactId !== version.artifactId) throw new Error("EMBED_CANONICAL_RECEIPT_INVALID");
    }
    if (args.canonicalOperationId && !version.operationIds?.includes(args.canonicalOperationId)) throw new Error("EMBED_CANONICAL_RECEIPT_INVALID");
    await ctx.db.patch(embed._id, { placementState: "confirmed", placementReceipt: `canonical-version:${String(version._id)}`, placementExpiresAt: undefined, updatedAt: Date.now() });
    return { embedId: embed._id, confirmed: true, idempotent: false };
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
    if (embed.pinnedVersionId && embed.pinnedVersionId !== nextPinnedVersionId)
      await releaseVersionIfUnpinned(ctx, embed.pinnedVersionId);
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
    await ctx.db.patch(embed._id, {
      removedAt: now,
      placementState: "removed",
      updatedAt: now,
    });
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
    if (embed.pinnedVersionId) await releaseVersionIfUnpinned(ctx, embed.pinnedVersionId);
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
        ctx.db.patch(embed._id, { removedAt: now, placementState: "removed", updatedAt: now }),
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
    for (const embed of active) if (embed.pinnedVersionId) await releaseVersionIfUnpinned(ctx, embed.pinnedVersionId);
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
    if (embed.versionPolicy === "pinned") {
      if (!embed.pinnedVersionId) throw new Error("EMBED_PINNED_VERSION_REQUIRED");
      const version = await ctx.db.get(embed.pinnedVersionId);
      if (!version || version.artifactId !== embed.sourceArtifactId)
        throw new Error("EMBED_PINNED_VERSION_UNAVAILABLE");
      await loadVersionAfter(ctx, version);
    }
    const source = await ctx.db.get(embed.sourceArtifactId);
    await ctx.db.patch(embed._id, {
      removedAt: undefined,
      placementState: embed.placementState === "removed" ? "confirmed" : embed.placementState,
      sourceUnavailableAt: source?.status === "deleted" ? embed.sourceUnavailableAt ?? Date.now() : undefined,
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
    const actorValue = await getOptionalAuthenticatedActor(ctx);
    if (!actorValue) return { canConfigure: false, embeds: [] };
    let container: Awaited<ReturnType<typeof requireContainer>>;
    try {
      container = await requireContainer(
        ctx,
        actorValue,
        args.containerType,
        args.containerId,
        "read",
      );
    } catch (error) {
      // A deleted host can outlive its old reference rows. Reading that stale
      // container is an empty state, not a page-level failure.
      if (
        error instanceof Error &&
        (error.message === "EMBED_CONTAINER_NOT_FOUND" ||
          error.message === "AUTH_RESOURCE_FORBIDDEN")
      )
        return { canConfigure: false, embeds: [] };
      throw error;
    }
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

/** A receipt is immutable saved evidence, never a mounted editor callback. */
export const getPlacementReceipt = query({
  args: { embedId: v.id("artifactEmbeds"), placementOperationId: v.string() },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const embed = await ctx.db.get(args.embedId);
    if (!embed || embed.placementOperationId !== args.placementOperationId) throw new Error("EMBED_PLACEMENT_NOT_FOUND");
    await requireContainer(ctx, actorValue, embed.containerType, embed.containerId, "read");
    if (embed.removedAt) throw new Error("EMBED_PLACEMENT_REMOVED");
    if (embed.placementState !== "confirmed" || !embed.placementReceipt?.startsWith("canonical-version:")) return null;
    const versionId = ctx.db.normalizeId("spectraArtifactVersions", embed.placementReceipt.slice("canonical-version:".length));
    const version = versionId ? await ctx.db.get(versionId) : null;
    if (!version || String(version.artifactId) !== embed.containerId || !containsCanonicalPlacement(await loadVersionAfter(ctx, version), String(embed._id), args.placementOperationId, embed.containerRegionId))
      throw new Error("EMBED_CANONICAL_RECEIPT_INVALID");
    return { phase: "canonical_write" as const, embedId: embed._id, operationId: args.placementOperationId, versionId: version._id };
  },
});

export const getProjection = query({
  args: { embedId: v.id("artifactEmbeds") },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const embed = await ctx.db.get(args.embedId);
    // A reference node can outlive a legacy embed row (for example after an
    // older cleanup job).  Missing reference metadata is a normal unavailable
    // state for the reader, not a reason to take down the whole document.
    if (!embed || embed.removedAt) return null;
    let container: Awaited<ReturnType<typeof requireContainer>>;
    try {
      container = await requireContainer(
        ctx,
        actorValue,
        embed.containerType,
        embed.containerId,
        "read",
      );
    } catch (error) {
      // Tiptap reference nodes are durable UI history. If their host was
      // deleted or access was revoked, render the component's unavailable
      // state instead of throwing through the global error boundary.
      if (
        error instanceof Error &&
        (error.message === "EMBED_CONTAINER_NOT_FOUND" ||
          error.message === "AUTH_RESOURCE_FORBIDDEN")
      )
        return null;
      throw error;
    }
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
    const retainedAccess =
      source?.status === "deleted" && embed.versionPolicy === "pinned"
        ? await evaluateRetainedPinAccess(ctx, actorValue, embed._id)
        : null;
    if (
      !source ||
      source.blueprintKey !== "code" ||
      (source.status === "deleted"
        ? !retainedAccess?.allowed
        : !decision?.allowed || !decision.capabilities.includes("read"))
    )
      throw new Error("AUTH_NO_ACCESS");
    const pinnedVersionId = retainedAccess?.allowed
      ? retainedAccess.version._id
      : embed.pinnedVersionId;
    if (embed.versionPolicy === "pinned" && !pinnedVersionId)
      throw new Error("RUNTIME_BUILD_UNAVAILABLE");
    const candidates =
      embed.versionPolicy === "pinned" && pinnedVersionId
        ? await ctx.db
            .query("spectraRuntimeBuilds")
            .withIndex("by_artifact_version", (q) =>
              q
                .eq("artifactId", source._id)
                .eq("artifactVersionId", pinnedVersionId),
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

