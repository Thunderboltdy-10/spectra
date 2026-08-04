import type { ArtifactTypeKey } from "../artifacts/types";
import type { SemanticAnchor, WorkAnchorAdapter } from "../anchors";

export type CommentAnchorTarget = {
  anchor: SemanticAnchor;
  status: "attached" | "orphaned";
  selected: boolean;
};

export function createRootCommentAnchor(workId: string, workType: ArtifactTypeKey, schemaVersion: number): SemanticAnchor {
  return { workId, workType, kind: "work:root", path: ["work", "root"], stableIds: { workId }, schemaVersion };
}

export function migrateLegacyCommentAnchor(input: { artifactId: string; artifactType: ArtifactTypeKey; regionId?: string; path?: string[]; excerpt?: string; relativePosition?: number[]; schemaVersion?: number }): SemanticAnchor {
  return {
    workId: input.artifactId,
    workType: input.artifactType,
    kind: input.regionId ? "semantic_region" : "work:root",
    path: input.path?.length ? input.path : input.regionId ? ["region", input.regionId] : ["work", "root"],
    ...(input.regionId ? { stableIds: { regionId: input.regionId } } : { stableIds: { workId: input.artifactId } }),
    ...(input.excerpt ? { fallbackExcerpt: input.excerpt } : {}),
    ...(input.relativePosition ? { relativePosition: Uint8Array.from(input.relativePosition) } : {}),
    schemaVersion: input.schemaVersion ?? 1,
  };
}

export function resolveCommentAnchor(anchor: SemanticAnchor, adapter: WorkAnchorAdapter, content: unknown): CommentAnchorTarget {
  return { anchor, status: adapter.exists(anchor, content) || anchor.kind === "work:root" ? "attached" : "orphaned", selected: false };
}

export function reanchorComment(target: CommentAnchorTarget, anchor: SemanticAnchor): CommentAnchorTarget {
  return { anchor, status: "attached", selected: true };
}

export async function revealCommentTarget(target: CommentAnchorTarget, adapter: WorkAnchorAdapter) {
  if (target.status === "orphaned") return { ...target, selected: true };
  await adapter.reveal(target.anchor, { focus: true });
  return { ...target, selected: true };
}
