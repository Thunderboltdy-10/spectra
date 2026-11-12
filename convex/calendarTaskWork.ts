import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { upsertCalendarItemReadModel } from "./calendarReadModels";
import { findNodesForSource, placeSourceNode, restoreTrashedNode, trashNode } from "./orgTreeShared";
import { buildArtifactTextIndex, defaultArtifactContent, defaultArtifactSchemaVersion } from "./spectraShared";

/*
 * One thing on the calendar (CALENDAR.md, "Tasks"). Whatever a student adds
 * there is a task work with a title, a reminder, a description and when:
 * a day alone (it sits at the top of that day), an end alone (a deadline),
 * or a start and an end (it fills those hours). `dueAt` is always the end;
 * `startAt`, when there is one, makes it a span. It opens as the task sheet. The calendar shows each dated task as an
 * item that is a projection of the work, keyed `task:<artifact id>`; moving,
 * finishing or removing that item writes the work, and the work writes the
 * item back. Classes (lessons, a timetable's repeating events) and imported
 * calendars stay plain calendar items: they are not things to do.
 */

export function taskProjectionKey(artifactId: Id<"spectraArtifacts">) {
  return `task:${artifactId}`;
}

/** Whether a calendar item is a task work's own projection, so its changes go to the work. */
export function isTaskProjection(item: Doc<"calendarItems">) {
  return Boolean(item.planArtifactId && item.sourceKey === taskProjectionKey(item.planArtifactId));
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

/** What a single task work puts on the calendar, or null when it has no day there. */
function projectedTime(artifact: Doc<"spectraArtifacts">) {
  const content = object(artifact.content);
  // A plan of several tasks schedules its own blocks; a single task (its sheet keeps one entry in tasks) is the task.
  if (Array.isArray(content.tasks) && content.tasks.length > 1) return null;
  if (object(content.source).provider === "managebac") return null; // The school's deadline is already there.
  if (artifact.status !== "active" || artifact.deletionRequestedAt !== undefined) return null;
  const dueAt = typeof content.dueAt === "number" && Number.isFinite(content.dueAt) ? content.dueAt : null;
  if (dueAt === null) return null;
  const startAt = typeof content.startAt === "number" && content.startAt < dueAt ? content.startAt : undefined;
  return startAt !== undefined
    ? { content, startAt, endAt: dueAt, span: true, allDay: false }
    : { content, startAt: dueAt, endAt: dueAt, span: false, allDay: content.allDay !== false };
}

/** Keeps a task work's calendar item in step with the work. Runs with the trigger's inner db. */
export async function syncTaskWorkProjection(ctx: Pick<MutationCtx, "db">, artifact: Doc<"spectraArtifacts">) {
  const key = taskProjectionKey(artifact._id);
  const existing = await ctx.db
    .query("calendarItems")
    .withIndex("by_source_key", (q) => q.eq("ownerAccountId", artifact.ownerAccountId).eq("sourceKey", key))
    .first();
  // A task in the Trash leaves the calendar, whichever way it got there (run Undo, Library, Bridge).
  const owned = (await ctx.db.query("orgNodes").withIndex("by_kind_source", (q) => q.eq("kind", "work").eq("sourceId", artifact._id)).collect()).filter((node) => node.accountId === artifact.ownerAccountId);
  const time = owned.length && owned.every((node) => node.deletedAt !== undefined) ? null : projectedTime(artifact);
  const now = Date.now();
  if (!time) {
    if (existing && existing.status !== "removed") {
      await ctx.db.patch(existing._id, { status: "removed", revision: existing.revision + 1, updatedAt: now });
      await upsertCalendarItemReadModel(ctx, (await ctx.db.get(existing._id))!);
    }
    return false;
  }
  const { content } = time;
  const done = content.status === "done" || content.status === "completed";
  const value = {
    kind: (time.span ? "personal_event" : "task") as "personal_event" | "task",
    title: text(content.taskTitle) || artifact.title || "Untitled task",
    // No notes: the task opens as its sheet, and copying the description would rewrite this item on every autosave.
    notes: undefined,
    startAt: time.startAt,
    endAt: time.endAt,
    allDay: time.allDay,
    timezone: text(content.timezone, 80) || existing?.timezone || "UTC",
    status: (done ? "completed" : "active") as "completed" | "active",
  };
  // The work the task is for; the task itself is planArtifactId.
  const linkedArtifactIds = (Array.isArray(content.linkedArtifactIds) ? content.linkedArtifactIds : [])
    .filter((id): id is string => typeof id === "string" && id !== artifact._id)
    .slice(0, 50) as Id<"spectraArtifacts">[];
  if (existing) {
    const same = (Object.keys(value) as (keyof typeof value)[]).every((field) => existing[field] === value[field]) &&
      JSON.stringify(existing.linkedArtifactIds) === JSON.stringify(linkedArtifactIds);
    if (same) return true;
    await ctx.db.patch(existing._id, { ...value, linkedArtifactIds, revision: existing.revision + 1, updatedAt: now });
    await upsertCalendarItemReadModel(ctx, (await ctx.db.get(existing._id))!);
    return true;
  }
  if (!artifact.schoolId) return false;
  const itemId = await ctx.db.insert("calendarItems", {
    ownerAccountId: artifact.ownerAccountId,
    schoolId: artifact.schoolId,
    ...value,
    timePrecision: "exact",
    sourceLocked: false,
    sourceKey: key,
    planArtifactId: artifact._id,
    planTaskId: "task-1",
    linkedArtifactIds,
    revision: 1,
    createdBy: "human",
    createdAt: now,
    updatedAt: now,
  });
  await upsertCalendarItemReadModel(ctx, (await ctx.db.get(itemId))!);
  return true;
}

export type TaskWorkDraft = {
  title: string;
  notes?: string;
  startAt?: number;
  endAt?: number;
  allDay?: boolean;
  timezone: string;
  linkedArtifactIds?: Id<"spectraArtifacts">[];
  workspaceId?: Id<"spectraWorkspaces">;
  createdBy: "human" | "ai";
};

/** Makes a task work for something added to the calendar; its item follows from the work. */
export async function createTaskWork(
  ctx: MutationCtx,
  actor: { accountId: Id<"accounts">; schoolId: Id<"schools"> },
  draft: TaskWorkDraft,
) {
  const now = Date.now();
  const title = text(draft.title, 240) || "Untitled task";
  const span = draft.startAt !== undefined && draft.endAt !== undefined && draft.endAt > draft.startAt && draft.allDay !== true;
  const content = {
    ...(defaultArtifactContent("planner_task") as Record<string, unknown>),
    taskTitle: title,
    description: text(draft.notes, 20_000),
    status: "todo",
    // A span starts and is due at its end; a moment or a day is due then.
    ...(span ? { startAt: draft.startAt, dueAt: draft.endAt, allDay: false } : draft.startAt !== undefined ? { dueAt: draft.startAt, allDay: draft.allDay === true } : {}),
    timezone: draft.timezone,
    ...(draft.linkedArtifactIds?.length ? { linkedArtifactIds: draft.linkedArtifactIds.map(String) } : {}),
  };
  const summary = text(draft.notes, 600);
  const artifactId = await ctx.db.insert("spectraArtifacts", {
    ownerAccountId: actor.accountId,
    schoolId: actor.schoolId,
    blueprintKey: "planner_task",
    schemaVersion: defaultArtifactSchemaVersion("planner_task"),
    title,
    summary,
    content,
    textIndex: buildArtifactTextIndex({ title, summary, content, tags: [] }),
    tags: [],
    status: "active",
    createdFrom: { source: draft.createdBy === "ai" ? "ai" : "manual", contextSummary: "Added to the calendar" },
    createdAt: now,
    updatedAt: now,
  } as never);
  await placeSourceNode(ctx, {
    accountId: actor.accountId,
    schoolId: actor.schoolId,
    kind: "work",
    sourceId: artifactId,
    name: title,
    target: draft.workspaceId ? { workspaceId: draft.workspaceId } : {},
    placedByAccountId: actor.accountId,
    mayShare: true,
    typeKey: "planner_task",
  });
  const item = await ctx.db
    .query("calendarItems")
    .withIndex("by_source_key", (q) => q.eq("ownerAccountId", actor.accountId).eq("sourceKey", taskProjectionKey(artifactId)))
    .first();
  return { artifactId, item };
}

/** A calendar gesture's new time, as the task work holds it. */
export function taskTimePatch(item: Doc<"calendarItems">, startAt: number, endAt: number) {
  return item.kind === "personal_event" && endAt > startAt ? { startAt, dueAt: endAt } : { dueAt: startAt, startAt: undefined };
}

/** Writes a change made on the calendar into the task work behind the item. */
export async function patchTaskWork(ctx: MutationCtx, item: Doc<"calendarItems">, patch: Record<string, unknown>) {
  const artifact = item.planArtifactId ? await ctx.db.get(item.planArtifactId) : null;
  if (!artifact || artifact.ownerAccountId !== item.ownerAccountId)
    throw new Error("CALENDAR_ITEM_NOT_FOUND: This task is not on your Calendar any more. Refresh Calendar.");
  await ctx.db.patch(artifact._id, { content: { ...object(artifact.content), ...patch }, updatedAt: Date.now() });
  return (await ctx.db.get(item._id))!;
}

/** Removing a task from the calendar puts its work in the Trash, where it can be brought back. */
export async function trashTaskWork(ctx: MutationCtx, item: Doc<"calendarItems">) {
  const artifactId = item.planArtifactId!;
  const nodes = await findNodesForSource(ctx, "work", artifactId);
  for (const node of nodes) if (node.deletedAt === undefined && node.accountId === item.ownerAccountId) await trashNode(ctx, node);
  // The work keeps its notes; it only leaves the calendar.
  await patchTaskWork(ctx, item, { dueAt: null, startAt: undefined });
}

/** Undoes trashTaskWork: the work comes back from the Trash with its day. */
export async function restoreTaskWork(ctx: MutationCtx, item: Doc<"calendarItems">) {
  const artifact = item.planArtifactId ? await ctx.db.get(item.planArtifactId) : null;
  if (!artifact || artifact.ownerAccountId !== item.ownerAccountId) return false;
  const nodes = await findNodesForSource(ctx, "work", artifact._id);
  for (const node of nodes) if (node.isTrashRoot && node.accountId === item.ownerAccountId) await restoreTrashedNode(ctx, node);
  const time = item.kind === "personal_event" && item.startAt !== undefined && item.endAt !== undefined && item.endAt > item.startAt
    ? { startAt: item.startAt, dueAt: item.endAt }
    : { dueAt: item.startAt ?? null, startAt: undefined };
  await ctx.db.patch(artifact._id, { content: { ...object(artifact.content), ...time }, updatedAt: Date.now() });
  // Undo may run outside the trigger layer; the item follows the work either way.
  await syncTaskWorkProjection(ctx, (await ctx.db.get(artifact._id))!);
  return true;
}
