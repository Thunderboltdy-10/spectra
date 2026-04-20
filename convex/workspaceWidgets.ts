import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";
import { normalizeWorkspaceWidgetState, recordWorkspaceMutation } from "./workspaceHelpers";

const vWidgetSource = v.union(v.literal("user"), v.literal("ai"), v.literal("system"));

type WorkspaceActor = { _id: Id<"users">; orgId: Id<"orgs"> };

type WidgetRecord = {
  _id: Id<"workspaceWidgets">;
  ownerUserId: Id<"users">;
  orgId: Id<"orgs">;
  workstreamId?: Id<"workstreams">;
  title: string;
  kind: string;
  state?: Record<string, unknown>;
  updatedAt: number;
};

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

async function requireOwnedWorkstream(
  ctx: { db: { get: (id: Id<"workstreams">) => Promise<unknown> } },
  actor: WorkspaceActor,
  workstreamId: Id<"workstreams">,
) {
  const workstream = await ctx.db.get(workstreamId) as { ownerUserId?: Id<"users">; orgId?: Id<"orgs"> } | null;
  if (!workstream || workstream.ownerUserId !== actor._id || workstream.orgId !== actor.orgId) {
    throw new Error("Workstream not found");
  }
}

async function requireOwnedWidget(
  ctx: { db: { get: (id: Id<"workspaceWidgets">) => Promise<unknown> } },
  actor: WorkspaceActor,
  widgetId: Id<"workspaceWidgets">,
) {
  const widget = await ctx.db.get(widgetId) as WidgetRecord | null;
  if (!widget || widget.ownerUserId !== actor._id || widget.orgId !== actor.orgId) {
    throw new Error("Workspace widget not found");
  }
  return widget;
}

function normalizeTitle(kind: string, title?: string | null) {
  const trimmed = typeof title === "string" ? title.trim() : "";
  return trimmed || `${kind} widget`;
}

function normalizeText(value: string | null | undefined, max = 280) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().split(/\s+/).join(" ");
  return normalized ? normalized.slice(0, max) : undefined;
}

function startOfDay(timestamp: number) {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfDay(timestamp: number) {
  const d = new Date(timestamp);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function formatDayKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function inferTopicCluster(parts: Array<string | null | undefined>) {
  const tokens = parts
    .flatMap((part) => (typeof part === "string" ? part.toLowerCase().split(/[^a-z0-9]+/g) : []))
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
  return tokens[0];
}

function computeTimerState(state: Record<string, unknown>, now: number) {
  const normalized = normalizeWorkspaceWidgetState("timer", state) as Record<string, unknown>;
  const secs = typeof normalized.secs === "number" ? normalized.secs : 25 * 60;
  const totalSecs = typeof normalized.totalSecs === "number" ? normalized.totalSecs : 25 * 60;
  const elapsedSecs = typeof normalized.elapsedSecs === "number" ? normalized.elapsedSecs : Math.max(0, totalSecs - secs);
  const cycleCount = typeof normalized.cycleCount === "number" ? normalized.cycleCount : 0;
  const running = normalized.running === true;
  const completedAt = typeof normalized.completedAt === "number" ? normalized.completedAt : undefined;
  const lastStartedAt = typeof normalized.lastStartedAt === "number" ? normalized.lastStartedAt : undefined;
  const lastTickedAtValue = typeof normalized.lastTickedAt === "number" ? normalized.lastTickedAt : undefined;
  const lastPausedAt = typeof normalized.lastPausedAt === "number" ? normalized.lastPausedAt : undefined;
  if (!running) {
    return {
      ...normalized,
      secs,
      totalSecs,
      elapsedSecs,
      cycleCount,
      running,
      completedAt,
      lastStartedAt,
      lastTickedAt: lastTickedAtValue ?? now,
      lastPausedAt,
    };
  }

  const lastTickedAt = lastTickedAtValue ?? lastStartedAt ?? now;
  const elapsed = Math.max(0, Math.floor((now - lastTickedAt) / 1000));
  if (elapsed <= 0) {
    return {
      ...normalized,
      secs,
      totalSecs,
      elapsedSecs,
      cycleCount,
      running,
      completedAt,
      lastStartedAt,
      lastTickedAt,
      lastPausedAt,
    };
  }

  const nextSecs = Math.max(0, secs - elapsed);
  const completed = nextSecs <= 0;
  return {
    ...normalized,
    secs: completed ? totalSecs : nextSecs,
    totalSecs,
    elapsedSecs: completed ? totalSecs : Math.min(totalSecs, elapsedSecs + elapsed),
    running: completed ? false : running,
    cycleCount: completed ? cycleCount + 1 : cycleCount,
    completedAt: completed ? now : completedAt,
    lastStartedAt,
    lastPausedAt: completed ? now : lastPausedAt,
    lastTickedAt: now,
  };
}

async function enrichWidgetState(ctx: Parameters<typeof requireActor>[0], actor: WorkspaceActor, widget: WidgetRecord) {
  const baseState = normalizeWorkspaceWidgetState(widget.kind, widget.state);
  const now = Date.now();

  if (widget.kind === "timer") {
    return computeTimerState(baseState, now);
  }

  if (widget.kind === "planner" || widget.kind === "today" || widget.kind === "calendar") {
    const plannerRows = widget.workstreamId
      ? await ctx.db.query("plannerItems").withIndex("by_workstream", (q) => q.eq("workstreamId", widget.workstreamId!)).collect()
      : await ctx.db.query("plannerItems").withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id)).collect();
    const plannerItems = plannerRows.filter((item) => item.ownerUserId === actor._id && item.orgId === actor.orgId && item.status !== "cancelled");

    if (widget.kind === "planner") {
      return {
        ...baseState,
        items: plannerItems
          .sort((a, b) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER) || b.updatedAt - a.updatedAt)
          .slice(0, 12)
          .map((item) => ({
            id: item._id,
            title: item.title,
            description: normalizeText(item.description, 180),
            type: item.type,
            priority: item.priority,
            status: item.status,
            dueAt: item.dueAt,
            scheduledAt: item.dueAt,
            topicCluster: inferTopicCluster([item.title, item.description]),
          })),
        total: plannerItems.length,
      };
    }

    if (widget.kind === "today") {
      const dayStart = startOfDay(now);
      const dayEnd = endOfDay(now);
      const items = plannerItems
        .filter((item) => typeof item.dueAt === "number" && item.dueAt >= dayStart && item.dueAt <= dayEnd)
        .sort((a, b) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER))
        .slice(0, 12)
        .map((item) => ({
          id: item._id,
          title: item.title,
          description: normalizeText(item.description, 160),
          type: item.type,
          priority: item.priority,
          status: item.status,
          dueAt: item.dueAt,
          scheduledAt: item.dueAt,
          topicCluster: inferTopicCluster([item.title, item.description]),
        }));
      return {
        ...baseState,
        items,
        total: items.length,
        completedCount: items.filter((item) => item.status === "completed").length,
        dateKey: formatDayKey(now),
      };
    }

    const days = Array.from(new Map(
      plannerItems
        .filter((item) => typeof item.dueAt === "number")
        .map((item) => [formatDayKey(item.dueAt!), { day: formatDayKey(item.dueAt!), dueAt: item.dueAt, count: 0, items: [] as Array<{ id: Id<"plannerItems">; title: string; status: string; priority: string; dueAt?: number }> }]),
    ).values());
    for (const day of days) {
      day.items = plannerItems
        .filter((item) => typeof item.dueAt === "number" && formatDayKey(item.dueAt) === day.day)
        .slice(0, 6)
        .map((item) => ({ id: item._id, title: item.title, status: item.status, priority: item.priority, dueAt: item.dueAt }));
      day.count = day.items.length;
    }
    return { ...baseState, days: days.sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0)).slice(0, 21) };
  }

  if (widget.kind === "library") {
    const artifacts = (widget.workstreamId
      ? await ctx.db.query("artifacts").withIndex("by_workstream", (q) => q.eq("workstreamId", widget.workstreamId!)).collect()
      : await ctx.db.query("artifacts").withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id)).order("desc").take(20))
      .filter((artifact) => artifact.ownerUserId === actor._id && artifact.orgId === actor.orgId && artifact.status === "active");
    const resources = (await ctx.db.query("resources").withIndex("by_owner_scope", (q) => q.eq("ownerUserId", actor._id).eq("scope", "personal")).collect())
      .filter((resource) => resource.orgId === actor.orgId && resource.status === "processed");
    return {
      ...baseState,
      artifacts: artifacts.slice(0, 8).map((artifact) => ({
        id: artifact._id,
        title: artifact.title,
        type: artifact.type,
        subtitle: normalizeText(artifact.contentPlaintext, 140) ?? artifact.type.replace(/_/g, " "),
        updatedAt: artifact.updatedAt,
      })),
      resources: resources.slice(0, 8).map((resource) => ({
        id: resource._id,
        title: resource.filename,
        subtitle: `${resource.mimeType} · ${Math.round(resource.size / 1024)} KB`,
        updatedAt: resource.updatedAt,
      })),
    };
  }

  return baseState;
}

export const listForWorkstream = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.optional(v.id("workstreams")),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const rows = args.workstreamId
      ? await ctx.db.query("workspaceWidgets").withIndex("by_workstream_updated", (q) => q.eq("workstreamId", args.workstreamId)).order("desc").collect()
      : await ctx.db.query("workspaceWidgets").withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id)).order("desc").collect();

    const visible = rows
      .filter((row) => row.ownerUserId === actor._id && row.orgId === actor.orgId)
      .filter((row) => !row.hidden) as WidgetRecord[];

    const enriched = await Promise.all(visible.map(async (row) => ({
      ...row,
      state: await enrichWidgetState(ctx, actor, row),
    })));

    return enriched.sort((a, b) => a.updatedAt - b.updatedAt);
  },
});

export const create = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.optional(v.id("workstreams")),
    kind: v.string(),
    title: v.optional(v.string()),
    x: v.number(),
    y: v.number(),
    w: v.number(),
    h: v.number(),
    collapsed: v.optional(v.boolean()),
    hidden: v.optional(v.boolean()),
    state: v.optional(v.any()),
    source: v.optional(vWidgetSource),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    if (args.workstreamId) {
      await requireOwnedWorkstream(ctx, actor, args.workstreamId);
    }
    const now = Date.now();
    const widgetId = await ctx.db.insert("workspaceWidgets", {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      kind: args.kind,
      title: normalizeTitle(args.kind, args.title),
      x: args.x,
      y: args.y,
      w: args.w,
      h: args.h,
      collapsed: args.collapsed ?? false,
      hidden: args.hidden ?? false,
      state: normalizeWorkspaceWidgetState(args.kind, args.state),
      source: args.source ?? "user",
      createdAt: now,
      updatedAt: now,
    });

    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: args.workstreamId,
      mutationType: "create_workspace_widget",
      source: args.source ?? "user",
      entity: "workspace-widget",
      action: "created",
      summary: `Created ${args.kind} widget`,
      after: { widgetId, kind: args.kind },
    });

    return { widgetId };
  },
});

export const update = mutation({
  args: {
    actorClerkId: v.string(),
    widgetId: v.id("workspaceWidgets"),
    title: v.optional(v.string()),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    w: v.optional(v.number()),
    h: v.optional(v.number()),
    collapsed: v.optional(v.boolean()),
    hidden: v.optional(v.boolean()),
    state: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const widget = await requireOwnedWidget(ctx, actor, args.widgetId);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = normalizeTitle(widget.kind, args.title);
    if (args.x !== undefined) patch.x = args.x;
    if (args.y !== undefined) patch.y = args.y;
    if (args.w !== undefined) patch.w = args.w;
    if (args.h !== undefined) patch.h = args.h;
    if (args.collapsed !== undefined) patch.collapsed = args.collapsed;
    if (args.hidden !== undefined) patch.hidden = args.hidden;
    if (args.state !== undefined) patch.state = {
      ...normalizeWorkspaceWidgetState(widget.kind, widget.state),
      ...normalizeWorkspaceWidgetState(widget.kind, args.state),
    };
    await ctx.db.patch(args.widgetId, patch);
    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: widget.workstreamId,
      mutationType: "update_workspace_widget",
      source: "user",
      entity: "workspace-widget",
      action: "updated",
      summary: `Updated widget ${widget.title}`,
      before: widget,
      after: patch,
    });
    return { success: true };
  },
});

export const remove = mutation({
  args: {
    actorClerkId: v.string(),
    widgetId: v.id("workspaceWidgets"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const widget = await requireOwnedWidget(ctx, actor, args.widgetId);
    await ctx.db.patch(widget._id, {
      hidden: true,
      updatedAt: Date.now(),
    });
    await recordWorkspaceMutation(ctx, {
      orgId: actor.orgId,
      ownerUserId: actor._id,
      workstreamId: widget.workstreamId,
      mutationType: "remove_workspace_widget",
      source: "user",
      entity: "workspace-widget",
      action: "deleted",
      summary: `Removed widget ${widget.title}`,
      before: widget,
      after: { hidden: true },
    });
    return { success: true };
  },
});
