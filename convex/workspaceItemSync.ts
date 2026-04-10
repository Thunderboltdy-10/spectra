import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  resolveCanonicalWorkspaceItemType,
  resolveWorkspaceCategory,
  resolveWorkspaceSourceId,
  resolveWorkspaceSourceKind,
} from "./workspaceHelpers";

function normalizeTitle(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Untitled";
}

function summarizeContent(value: string | undefined, max = 180) {
  const compact = value?.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}

export function workspaceItemTypeForArtifact(
  artifactType: string,
): Doc<"workspaceItems">["type"] {
  switch (artifactType) {
    case "note":
    case "study_plan":
    case "flashcard_deck":
    case "code_project":
      return "document";
    case "document":
    case "bookmark":
    case "collection":
      return "reference";
    case "timetable":
      return "planner";
    case "visualization":
    case "concept_map":
    case "quiz":
      return "visualization";
    case "image":
    case "diagram":
      return "media";
    case "whiteboard":
    case "code_output":
    default:
      return "custom";
  }
}

export function workspaceCategoryForArtifact(
  artifactType: string,
): Doc<"workspaceItems">["category"] {
  switch (artifactType) {
    case "note":
    case "study_plan":
    case "flashcard_deck":
    case "code_project":
      return "documents";
    case "document":
    case "bookmark":
    case "collection":
      return "references";
    case "timetable":
      return "planner";
    case "visualization":
    case "concept_map":
    case "quiz":
    case "code_output":
    case "whiteboard":
      return "visualizations";
    case "image":
    case "diagram":
      return "media";
    default:
      return "custom";
  }
}

export function canonicalWorkspaceItemTypeForArtifact(): Doc<"workspaceItems">["itemType"] {
  return "artifact";
}

export function canonicalRenderModeForArtifact(artifactType: string) {
  switch (artifactType) {
    case "study_plan":
      return "note";
    case "timetable":
      return "planner";
    case "document":
    case "bookmark":
    case "collection":
    case "custom":
      return "export";
    case "code_project":
    case "code_output":
      return "code";
    case "diagram":
    case "image":
    case "visualization":
    case "concept_map":
      return "visual";
    case "whiteboard":
      return "board";
    default:
      return artifactType;
  }
}

async function findWorkspaceItemForArtifact(
  ctx: Pick<MutationCtx, "db">,
  artifactId: Id<"artifacts">,
  ownerUserId: Id<"users">,
  orgId: Id<"orgs">,
) {
  const rows = await ctx.db
    .query("workspaceItems")
    .withIndex("by_source_artifact", (q) => q.eq("sourceArtifactId", artifactId))
    .collect();

  return rows.find((row) => row.ownerUserId === ownerUserId && row.orgId === orgId) ?? null;
}

async function resolveDefaultWidgetPosition(
  ctx: Pick<MutationCtx, "db">,
  workstreamId: Id<"workstreams">,
) {
  const items = await ctx.db
    .query("workspaceItems")
    .withIndex("by_workstream", (q) => q.eq("workstreamId", workstreamId))
    .collect();

  const activeCount = items.filter((item) => item.status === "active").length;
  const column = activeCount % 2;
  const row = Math.floor(activeCount / 2);

  return {
    x: 80 + column * 320,
    y: 220 + row * 220,
  };
}

export async function syncWorkspaceItemForArtifact(
  ctx: Pick<MutationCtx, "db">,
  params: {
    artifactId: Id<"artifacts">;
    ownerUserId: Id<"users">;
    orgId: Id<"orgs">;
    workstreamId?: Id<"workstreams">;
    status: Doc<"artifacts">["status"];
    title?: string;
    artifactType: string;
    contentPlaintext?: string;
  },
) {
  const existing = await findWorkspaceItemForArtifact(
    ctx,
    params.artifactId,
    params.ownerUserId,
    params.orgId,
  );
  const now = Date.now();

  if (!params.workstreamId || params.status !== "active") {
    if (existing && existing.status !== "archived") {
      await ctx.db.patch(existing._id, {
        status: "archived",
        updatedAt: now,
      });
    }
    return;
  }

  const nextFields = {
    workstreamId: params.workstreamId,
    type: workspaceItemTypeForArtifact(params.artifactType),
    itemType: resolveCanonicalWorkspaceItemType({
      legacyType: workspaceItemTypeForArtifact(params.artifactType),
      itemType: canonicalWorkspaceItemTypeForArtifact(),
      sourceArtifactId: params.artifactId,
    }),
    sourceKind: resolveWorkspaceSourceKind({
      sourceArtifactId: params.artifactId,
      itemType: canonicalWorkspaceItemTypeForArtifact(),
    }),
    sourceId: resolveWorkspaceSourceId({
      sourceArtifactId: params.artifactId,
    }),
    renderMode: canonicalRenderModeForArtifact(params.artifactType),
    sourceArtifactId: params.artifactId,
    title: normalizeTitle(params.title),
    contentSummary: summarizeContent(params.contentPlaintext),
    category: resolveWorkspaceCategory({
      legacyType: workspaceItemTypeForArtifact(params.artifactType),
      renderMode: canonicalRenderModeForArtifact(params.artifactType),
      itemType: canonicalWorkspaceItemTypeForArtifact(),
      explicitCategory: workspaceCategoryForArtifact(params.artifactType),
    }),
    status: "active" as const,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, nextFields);
    return;
  }

  const position = await resolveDefaultWidgetPosition(ctx, params.workstreamId);
  await ctx.db.insert("workspaceItems", {
    orgId: params.orgId,
    ownerUserId: params.ownerUserId,
    workstreamId: params.workstreamId,
    type: workspaceItemTypeForArtifact(params.artifactType),
    renderMode: params.artifactType,
    sourceArtifactId: params.artifactId,
    itemType: resolveCanonicalWorkspaceItemType({
      legacyType: workspaceItemTypeForArtifact(params.artifactType),
      itemType: canonicalWorkspaceItemTypeForArtifact(),
      sourceArtifactId: params.artifactId,
    }),
    sourceKind: resolveWorkspaceSourceKind({
      sourceArtifactId: params.artifactId,
      itemType: canonicalWorkspaceItemTypeForArtifact(),
    }),
    sourceId: resolveWorkspaceSourceId({
      sourceArtifactId: params.artifactId,
    }),
    title: normalizeTitle(params.title),
    contentSummary: summarizeContent(params.contentPlaintext),
    category: resolveWorkspaceCategory({
      legacyType: workspaceItemTypeForArtifact(params.artifactType),
      renderMode: params.artifactType,
      itemType: canonicalWorkspaceItemTypeForArtifact(),
      explicitCategory: workspaceCategoryForArtifact(params.artifactType),
    }),
    x: position.x,
    y: position.y,
    width: 280,
    height: 160,
    status: "active",
    pinned: true,
    createdAt: now,
    updatedAt: now,
  });
}

export async function removeWorkspaceItemForArtifact(
  ctx: Pick<MutationCtx, "db">,
  params: {
    artifactId: Id<"artifacts">;
    ownerUserId: Id<"users">;
    orgId: Id<"orgs">;
  },
) {
  const existing = await findWorkspaceItemForArtifact(
    ctx,
    params.artifactId,
    params.ownerUserId,
    params.orgId,
  );

  if (existing) {
    await ctx.db.delete(existing._id);
  }
}
