import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { evaluateAccessForActor } from "./authorityShared";
import { getAuthenticatedActor } from "./identityShared";
import { requireArtifactCapability } from "./spectraShared";
import { loadVersionAfter } from "./artifactSnapshots";

const containerType = v.union(v.literal("artifact"), v.literal("thread"));
const mode = v.union(v.literal("compact"), v.literal("expanded"));
const interaction = v.union(v.literal("read"), v.literal("interact"), v.literal("edit"));
const versionPolicy = v.union(v.literal("live"), v.literal("pinned"));
const contextPolicy = v.union(v.literal("none"), v.literal("summary"), v.literal("visible_region"));

type EmbedCtx = QueryCtx | MutationCtx;
type EmbedActor = NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>;

async function actor(ctx: EmbedCtx) {
  const value = await getAuthenticatedActor(ctx);
  if (!value) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return value;
}

async function requireContainer(ctx: EmbedCtx, actorValue: EmbedActor, type: "artifact" | "thread", id: string, capability: "read" | "modify") {
  if (type === "artifact") {
    const artifactId = ctx.db.normalizeId("spectraArtifacts", id);
    if (!artifactId) throw new Error("EMBED_CONTAINER_NOT_FOUND");
    const result = await requireArtifactCapability(ctx, artifactId, capability);
    return { schoolId: result.artifact.schoolId, container: result.artifact };
  }
  const threadId = ctx.db.normalizeId("spectraThreads", id);
  const thread = threadId ? await ctx.db.get(threadId) : null;
  if (!thread || thread.status === "deleted" || thread.ownerAccountId !== actorValue.accountId || thread.schoolId !== actorValue.schoolId) throw new Error("EMBED_CONTAINER_NOT_FOUND");
  return { schoolId: thread.schoolId, container: thread };
}

async function sourceDecision(ctx: EmbedCtx, actorValue: EmbedActor, sourceArtifactId: Id<"spectraArtifacts">) {
  const source = await ctx.db.get(sourceArtifactId);
  if (!source) return { source: null, decision: null };
  const decision = await evaluateAccessForActor(ctx, actorValue, source.blueprintKey === "agent" ? "agent" : "artifact", source._id);
  return { source, decision };
}

async function projection(ctx: QueryCtx, actorValue: EmbedActor, embed: Doc<"artifactEmbeds">) {
  const { source, decision } = await sourceDecision(ctx, actorValue, embed.sourceArtifactId);
  const safe = {
    embedId: embed._id,
    containerType: embed.containerType,
    containerId: embed.containerId,
    containerRegionId: embed.containerRegionId,
    mode: embed.mode,
    interaction: embed.interaction,
    versionPolicy: embed.versionPolicy,
    contextPolicy: embed.contextPolicy,
    displayPreferences: embed.displayPreferences,
    createdAt: embed.createdAt,
    updatedAt: embed.updatedAt,
  };
  if (!source || !decision?.allowed || !decision.capabilities.includes("read")) {
    return { ...safe, state: "no_access" as const, canRequestAccess: Boolean(source && source.schoolId === actorValue.schoolId) };
  }
  if (source.status === "deleted") return { ...safe, state: "deleted" as const, source: { artifactId: source._id, title: source.title, blueprintKey: source.blueprintKey } };
  let snapshot: unknown = { title: source.title, summary: source.summary, tags: source.tags, content: source.content };
  let version: { versionId: Id<"spectraArtifactVersions">; createdAt: number; summary?: string; name?: string } | undefined;
  if (embed.versionPolicy === "pinned") {
    const pinned = embed.pinnedVersionId ? await ctx.db.get(embed.pinnedVersionId) : null;
    if (!pinned || pinned.artifactId !== source._id) {
      return { ...safe, state: "version_unavailable" as const, source: { artifactId: source._id, title: source.title, blueprintKey: source.blueprintKey } };
    }
    try {
      snapshot = await loadVersionAfter(ctx, pinned);
    } catch {
      return { ...safe, state: "version_unavailable" as const, source: { artifactId: source._id, title: source.title, blueprintKey: source.blueprintKey } };
    }
    version = { versionId: pinned._id, createdAt: pinned.createdAt, summary: pinned.summary, name: pinned.name };
  }
  const effectiveInteraction = embed.interaction === "edit" && !decision.capabilities.includes("modify") ? "read" : embed.interaction;
  return {
    ...safe,
    state: source.status === "archived" ? "archived" as const : "ready" as const,
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
  };
}

function visibleRegionExcerpt(value: unknown, regionIds: Set<string>, results: unknown[], depth = 0) {
  if (results.length >= 24 || depth > 12 || value === null || typeof value !== "object") return;
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string" && regionIds.has(record.id)) {
      results.push(record);
      return;
    }
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) visibleRegionExcerpt(child, regionIds, results, depth + 1);
}

async function wouldCreateArtifactCycle(ctx: MutationCtx, containerArtifactId: string, sourceArtifactId: Id<"spectraArtifacts">) {
  if (containerArtifactId === sourceArtifactId) return true;
  const visited = new Set<string>();
  const pending = [String(sourceArtifactId)];
  while (pending.length > 0 && visited.size < 128) {
    const artifactId = pending.shift()!;
    if (artifactId === containerArtifactId) return true;
    if (visited.has(artifactId)) continue;
    visited.add(artifactId);
    const children = await ctx.db.query("artifactEmbeds").withIndex("by_container", (q) => q.eq("containerType", "artifact").eq("containerId", artifactId)).collect();
    for (const child of children) if (!child.removedAt) pending.push(String(child.sourceArtifactId));
  }
  if (pending.length > 0) throw new Error("EMBED_GRAPH_LIMIT: This embed graph is too deep to validate safely.");
  return false;
}

export const create = mutation({
  args: {
    containerType,
    containerId: v.string(),
    containerRegionId: v.string(),
    sourceArtifactId: v.id("spectraArtifacts"),
    mode,
    interaction,
    versionPolicy,
    pinnedVersionId: v.optional(v.id("spectraArtifactVersions")),
    displayPreferences: v.optional(v.any()),
    contextPolicy,
  },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const container = await requireContainer(ctx, actorValue, args.containerType, args.containerId, "modify");
    const source = await requireArtifactCapability(ctx, args.sourceArtifactId, args.interaction === "edit" ? "modify" : "read");
    if (container.schoolId !== source.artifact.schoolId || source.artifact.schoolId !== actorValue.schoolId) throw new Error("EMBED_SCHOOL_BOUNDARY");
    if (!args.containerRegionId.trim()) throw new Error("EMBED_CONTAINER_REGION_REQUIRED");
    if (args.containerType === "artifact" && await wouldCreateArtifactCycle(ctx, args.containerId, args.sourceArtifactId)) throw new Error("EMBED_CYCLE: An artifact cannot embed itself directly or indirectly.");
    if (args.versionPolicy === "pinned") {
      if (!args.pinnedVersionId) throw new Error("EMBED_PINNED_VERSION_REQUIRED");
      const version = await ctx.db.get(args.pinnedVersionId);
      if (!version || version.artifactId !== args.sourceArtifactId) throw new Error("EMBED_PINNED_VERSION_INVALID");
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
      pinnedVersionId: args.versionPolicy === "pinned" ? args.pinnedVersionId : undefined,
      displayPreferences: args.displayPreferences,
      contextPolicy: args.contextPolicy,
      createdByAccountId: actorValue.accountId,
      createdAt: now,
      updatedAt: now,
    });
    return { embedId };
  },
});

export const update = mutation({
  args: {
    embedId: v.id("artifactEmbeds"),
    mode: v.optional(mode),
    interaction: v.optional(interaction),
    versionPolicy: v.optional(versionPolicy),
    pinnedVersionId: v.optional(v.id("spectraArtifactVersions")),
    displayPreferences: v.optional(v.any()),
    contextPolicy: v.optional(contextPolicy),
  },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const embed = await ctx.db.get(args.embedId);
    if (!embed || embed.removedAt) throw new Error("EMBED_NOT_FOUND");
    await requireContainer(ctx, actorValue, embed.containerType, embed.containerId, "modify");
    const nextInteraction = args.interaction ?? embed.interaction;
    await requireArtifactCapability(ctx, embed.sourceArtifactId, nextInteraction === "edit" ? "modify" : "read");
    const nextVersionPolicy = args.versionPolicy ?? embed.versionPolicy;
    const nextPinnedVersionId = nextVersionPolicy === "pinned" ? args.pinnedVersionId ?? embed.pinnedVersionId : undefined;
    if (nextVersionPolicy === "pinned") {
      const version = nextPinnedVersionId ? await ctx.db.get(nextPinnedVersionId) : null;
      if (!version || version.artifactId !== embed.sourceArtifactId) throw new Error("EMBED_PINNED_VERSION_INVALID");
      await loadVersionAfter(ctx, version);
    }
    await ctx.db.patch(embed._id, {
      mode: args.mode ?? embed.mode,
      interaction: nextInteraction,
      versionPolicy: nextVersionPolicy,
      pinnedVersionId: nextPinnedVersionId,
      displayPreferences: args.displayPreferences === undefined ? embed.displayPreferences : args.displayPreferences,
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
    await requireContainer(ctx, actorValue, embed.containerType, embed.containerId, "modify");
    const now = Date.now();
    await ctx.db.patch(embed._id, { removedAt: now, updatedAt: now });
    return { removed: true };
  },
});

export const listForContainer = query({
  args: { containerType, containerId: v.string() },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    await requireContainer(ctx, actorValue, args.containerType, args.containerId, "read");
    const rows = await ctx.db.query("artifactEmbeds").withIndex("by_container", (q) => q.eq("containerType", args.containerType).eq("containerId", args.containerId)).collect();
    return Promise.all(rows.filter((embed) => !embed.removedAt).map((embed) => projection(ctx, actorValue, embed)));
  },
});

export const getProjection = query({
  args: { embedId: v.id("artifactEmbeds") },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const embed = await ctx.db.get(args.embedId);
    if (!embed || embed.removedAt) throw new Error("EMBED_NOT_FOUND");
    await requireContainer(ctx, actorValue, embed.containerType, embed.containerId, "read");
    return projection(ctx, actorValue, embed);
  },
});

export const contextContribution = query({
  args: { embedId: v.id("artifactEmbeds") },
  handler: async (ctx, args) => {
    const actorValue = await actor(ctx);
    const embed = await ctx.db.get(args.embedId);
    if (!embed || embed.removedAt) throw new Error("EMBED_NOT_FOUND");
    await requireContainer(ctx, actorValue, embed.containerType, embed.containerId, "read");
    if (embed.contextPolicy === "none") return { policy: "none" as const, contribution: null };
    const { source, decision } = await sourceDecision(ctx, actorValue, embed.sourceArtifactId);
    if (!source || !decision?.allowed) return { policy: embed.contextPolicy, contribution: null };
    let content: unknown;
    if (embed.versionPolicy === "pinned" && embed.pinnedVersionId) {
      const version = await ctx.db.get(embed.pinnedVersionId);
      content = version?.artifactId === source._id ? await loadVersionAfter(ctx, version) : undefined;
    } else content = source.content;
    const base = { artifactId: source._id, title: source.title, summary: source.summary, blueprintKey: source.blueprintKey, versionId: embed.pinnedVersionId };
    if (embed.contextPolicy === "summary") return { policy: "summary" as const, contribution: base, provenance: { containerType: embed.containerType, containerId: embed.containerId, embedId: embed._id, sourceArtifactId: source._id } };
    const preferences = embed.displayPreferences && typeof embed.displayPreferences === "object" ? embed.displayPreferences as Record<string, unknown> : {};
    const ids = Array.isArray(preferences.regionIds) ? preferences.regionIds.filter((value): value is string => typeof value === "string").slice(0, 24) : [];
    const visible: unknown[] = [];
    visibleRegionExcerpt(content, new Set(ids), visible);
    return {
      policy: "visible_region" as const,
      contribution: { ...base, visible: JSON.stringify(visible.length ? visible : content).slice(0, 12_000) },
      provenance: { containerType: embed.containerType, containerId: embed.containerId, embedId: embed._id, sourceArtifactId: source._id },
    };
  },
});
