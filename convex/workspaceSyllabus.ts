import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./orgNodeMutation";
import { findNodesForSource, placeSourceNode, trashNode } from "./orgTreeShared";
import { buildArtifactTextIndex, defaultArtifactSchemaVersion } from "./spectraShared";
import { documentFromMarkdown } from "../src/features/spectra/ai/harness/authoring/document";
import { sequentialIdFactory } from "../src/features/spectra/ai/harness/authoring/shared";
import {
  syllabusById,
  syllabusForClass,
  syllabusTitle,
  syllabusVariant,
  type BundledSyllabus,
  type SyllabusLevel,
} from "../shared/syllabus";
import { SYLLABUS_BUNDLE_VERSION } from "../shared/syllabus/catalog.generated";

/*
 * A workspace that follows a course keeps its syllabus as a read-only document
 * pinned at the top: a ManageBac class finds its own from the class's name, and
 * a workspace someone makes picks one. The text comes from shared/syllabus at
 * build time. When a syllabus changes there, the next check swaps in a fresh copy
 * (the old one goes to the trash) rather than rewriting a document whose live
 * room may still hold the old words.
 */

const level = v.optional(v.union(v.literal("SL"), v.literal("HL")));
const PAGE = 100;

async function liveArtifact(ctx: MutationCtx, workspace: Doc<"spectraWorkspaces">) {
  const id = workspace.syllabus?.artifactId;
  const artifact = id ? await ctx.db.get(id) : null;
  if (!artifact || artifact.status === "deleted") return { artifact: null, removed: Boolean(id) };
  const nodes = (await findNodesForSource(ctx, "work", String(artifact._id))).filter(
    (node) => node.accountId === workspace.ownerAccountId,
  );
  // Put in the trash by its owner: they did not want it, so it is not brought back.
  const removed = nodes.length > 0 && nodes.every((node) => node.deletedAt !== undefined);
  return { artifact: removed ? null : artifact, removed, nodes };
}

async function createSyllabusArtifact(
  ctx: MutationCtx,
  workspace: Doc<"spectraWorkspaces"> & { schoolId: Id<"schools"> },
  entry: BundledSyllabus,
  level: SyllabusLevel | undefined,
  markdown: string,
) {
  const now = Date.now();
  const title = syllabusTitle(entry, level);
  const summary = [entry.programme, entry.firstAssessment ? `first assessment ${entry.firstAssessment}` : null]
    .filter(Boolean)
    .join(", ");
  const content = documentFromMarkdown(markdown, undefined, sequentialIdFactory());
  const tags = ["syllabus"];
  const artifactId = await ctx.db.insert("spectraArtifacts", {
    ownerAccountId: workspace.ownerAccountId,
    schoolId: workspace.schoolId,
    blueprintKey: "document",
    schemaVersion: defaultArtifactSchemaVersion("document"),
    title,
    summary,
    content,
    textIndex: buildArtifactTextIndex({ title, summary, content, tags }),
    tags,
    status: "active",
    syllabus: { id: entry.id, ...(level ? { level } : {}), version: entry.version },
    createdFrom: { source: "workspace", workspaceId: workspace._id, contextSummary: "Course syllabus" },
    createdAt: now,
    updatedAt: now,
  } as never);
  await placeSourceNode(ctx, {
    accountId: workspace.ownerAccountId,
    schoolId: workspace.schoolId,
    kind: "work",
    sourceId: artifactId,
    name: title,
    target: { workspaceId: workspace._id },
    placedByAccountId: workspace.ownerAccountId,
    mayShare: true,
    typeKey: "document",
  });
  // First in the workspace: pinned above everything else.
  for (const node of await findNodesForSource(ctx, "work", String(artifactId)))
    if (node.accountId === workspace.ownerAccountId && node.deletedAt === undefined && !node.pinned)
      await ctx.db.patch(node._id, { pinned: true });
  return artifactId;
}

/** Brings one workspace's Syllabus artifact in line with its choice and the bundle. */
export async function ensureWorkspaceSyllabus(
  ctx: MutationCtx,
  workspaceId: Id<"spectraWorkspaces">,
  choose?: { syllabusId?: string; level?: SyllabusLevel; className?: string },
) {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.status !== "active" || !workspace.schoolId) return { changed: false };
  if (!choose?.syllabusId && !choose?.className && workspace.syllabusBundle === SYLLABUS_BUNDLE_VERSION)
    return { changed: false };
  const settled = async (patch: Partial<Doc<"spectraWorkspaces">> = {}) => {
    if (Object.keys(patch).length || workspace.syllabusBundle !== SYLLABUS_BUNDLE_VERSION)
      await ctx.db.patch(workspace._id, { ...patch, syllabusBundle: SYLLABUS_BUNDLE_VERSION });
  };
  const current = workspace.syllabus;
  let className = choose?.className;
  // The projected title is deliberately human-readable and loses the cohort
  // prefix (2527HistHL1). Read the original source only on a syllabus check.
  if (!choose?.syllabusId && workspace.starterKey === "managebac-class" && workspace.sourceContext?.sourceRecordId) {
    const source = await ctx.db.get(workspace.sourceContext.sourceRecordId);
    const normalized = source?.normalized as Record<string, unknown> | undefined;
    const raw = normalized?.name ?? normalized?.title;
    if (typeof raw === "string" && raw.trim()) className = raw;
  }
  const matched = className ? syllabusForClass(className) : null;
  let choice: { id: string; level?: SyllabusLevel } | null = null;
  if (choose?.syllabusId) choice = { id: choose.syllabusId, level: choose.level };
  else if (matched) choice = { id: matched.entry.id, level: matched.level ?? undefined };
  else if (current) choice = { id: current.id, level: current.level };
  const entry = choice ? syllabusById(choice.id) : null;
  // No syllabus fits, or its file was taken out: whatever is there stays.
  if (!choice || !entry) {
    await settled();
    return { changed: false };
  }
  const variant = syllabusVariant(entry, choice.level);
  const chosenLevel = variant.key === "all" ? undefined : variant.key;
  const sameChoice = current?.id === entry.id && current.level === chosenLevel;
  // The workspace carries the content version. Unchanged checks do not read
  // the artifact body or its placement nodes and never rewrite the document.
  if (sameChoice && current.version === entry.version) {
    await settled();
    return { changed: false };
  }
  const live = await liveArtifact(ctx, workspace);
  if (sameChoice && (live.removed || live.artifact?.syllabus?.version === entry.version)) {
    await settled();
    return { changed: false };
  }
  const artifactId = await createSyllabusArtifact(
    ctx,
    workspace as Doc<"spectraWorkspaces"> & { schoolId: Id<"schools"> },
    entry,
    chosenLevel,
    variant.markdown,
  );
  // The copy it replaces goes to the trash, where it can still be restored.
  if (live.artifact)
    for (const node of live.nodes ?? []) if (node.deletedAt === undefined) await trashNode(ctx, node);
  await settled({
    syllabus: { id: entry.id, ...(chosenLevel ? { level: chosenLevel } : {}), artifactId, version: entry.version },
  });
  return { changed: true, artifactId };
}

export const ensure = internalMutation({
  args: {
    workspaceId: v.id("spectraWorkspaces"),
    syllabusId: v.optional(v.string()),
    level,
    className: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    ensureWorkspaceSyllabus(ctx, args.workspaceId, {
      syllabusId: args.syllabusId,
      level: args.level,
      className: args.className,
    }),
});

/**
 * After new syllabi are bundled and deployed: brings every workspace that has
 * one up to date, a page at a time.
 *   npx convex run workspaceSyllabus:refreshAll
 */
export const refreshAll = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("spectraWorkspaces")
      .paginate({ cursor: args.cursor ?? null, numItems: PAGE });
    let scheduled = 0;
    for (const workspace of page.page) {
      if (workspace.status !== "active" || workspace.syllabusBundle === SYLLABUS_BUNDLE_VERSION) continue;
      const className = workspace.starterKey === "managebac-class" ? (workspace.sourceContext?.projectedTitle ?? workspace.title) : undefined;
      if (!workspace.syllabus && !className) continue;
      await ctx.scheduler.runAfter(0, internal.workspaceSyllabus.ensure, { workspaceId: workspace._id, className });
      scheduled += 1;
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.workspaceSyllabus.refreshAll, { cursor: page.continueCursor });
    return { scheduled, done: page.isDone };
  },
});
