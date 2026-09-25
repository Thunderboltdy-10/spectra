import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireSpectraActor } from "./spectraShared";
import {
  ARTIFACT_SUMMARY_READ_MODEL_VERSION,
  artifactSummaryFor,
} from "./orgTreeShared";
import {
  evaluateAccessForActorWithLoadedResource,
  evaluateArtifactAccessForActorWithSummary,
} from "./authorityShared";

/** Exact-reference orientation, with current authority and no editor payload. */
export const getArtifact = query({
  args: { artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, { artifactId }) => {
    const actor = await requireSpectraActor(ctx);
    const summary = await artifactSummaryFor(ctx, artifactId);
    let metadata: Record<string, unknown>;
    if (summary?.readModelVersion === ARTIFACT_SUMMARY_READ_MODEL_VERSION) {
      const access = await evaluateArtifactAccessForActorWithSummary(
        ctx, actor, artifactId,
        summary.blueprintKey === "agent" ? "agent" : "artifact", summary,
      );
      if (!access.allowed || !access.capabilities.includes("read") ||
        summary.blueprintKey === "thread_reference") return null;
      metadata = summary.projection && typeof summary.projection === "object"
        ? summary.projection as Record<string, unknown> : {};
      metadata = { ...metadata, _id: artifactId, blueprintKey: summary.blueprintKey, updatedAt: summary.updatedAt };
    } else {
      // Legacy/missing read models remain readable without a migration shortcut.
      // This fallback reads one canonical row; the normal path never does.
      const artifact = await ctx.db.get(artifactId);
      if (!artifact || artifact.blueprintKey === "thread_reference") return null;
      const access = await evaluateAccessForActorWithLoadedResource(
        ctx, actor, artifact.blueprintKey === "agent" ? "agent" : "artifact", artifactId,
        { resource: artifact, ownerAccountId: artifact.ownerAccountId, schoolId: artifact.schoolId, lifecycle: artifact.status },
      );
      if (!access.allowed || !access.capabilities.includes("read")) return null;
      metadata = artifact;
    }
    return {
      _id: artifactId,
      blueprintKey: metadata.blueprintKey,
      title: typeof metadata.title === "string" ? metadata.title.slice(0, 240) : "",
      summary: typeof metadata.summary === "string" ? metadata.summary.slice(0, 640) : undefined,
      updatedAt: metadata.updatedAt,
      contentAvailable: false,
      metadataIncomplete: typeof metadata.title !== "string" || !metadata.title.trim(),
    };
  },
});

export const getWorkspace = query({
  args: { workspaceId: v.id("spectraWorkspaces") },
  handler: async (ctx, { workspaceId }) => {
    const actor = await requireSpectraActor(ctx);
    const workspace = await ctx.db.get(workspaceId);
    const access = await evaluateAccessForActorWithLoadedResource(
      ctx, actor, "workspace", workspaceId,
      workspace ? {
        resource: workspace, ownerAccountId: workspace.ownerAccountId,
        schoolId: workspace.schoolId, lifecycle: workspace.status,
      } : null,
    );
    if (!workspace || !access.allowed || !access.capabilities.includes("read")) return null;
    return {
      workspace: {
        _id: workspaceId, title: workspace.title.slice(0, 240),
        description: workspace.description?.slice(0, 640), updatedAt: workspace.updatedAt,
      },
      items: [],
      contentAvailable: false,
    };
  },
});
