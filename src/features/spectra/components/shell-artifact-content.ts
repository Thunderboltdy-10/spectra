import type { SpectraArtifact, SpectraOverview } from "../data/api";

/** Library rows retain identity and AI activity, not closed editor snapshots. */
export function releaseShellArtifactContent(artifact: SpectraArtifact): SpectraArtifact {
  const activePreview = artifact.accessLevel !== null && artifact.status !== "deleted" &&
    (artifact.aiState === "creating" || artifact.aiState === "updating");
  if (artifact.content === undefined && (activePreview || artifact.aiPreview?.content === undefined)) {
    return artifact;
  }
  const { content: _content, ...metadata } = artifact;
  if (!activePreview && metadata.aiPreview?.content !== undefined) {
    const { content: _previewContent, ...preview } = metadata.aiPreview;
    metadata.aiPreview = preview;
  }
  return metadata;
}

export function retainShellOverviewContent(
  overview: SpectraOverview | null,
  retainedIds: ReadonlySet<string>,
): SpectraOverview | null {
  if (!overview) return overview;
  let changed = false;
  const retain = (artifact: SpectraArtifact) => {
    const accessible = artifact.accessLevel !== null && artifact.status !== "deleted";
    const next = retainedIds.has(artifact._id) && accessible ? artifact : releaseShellArtifactContent(artifact);
    changed ||= next !== artifact;
    return next;
  };
  const artifacts = overview.artifacts.map(retain);
  const items = overview.workspace?.items.map((item) => {
    if (!item.artifact) return item;
    const artifact = retain(item.artifact);
    return artifact === item.artifact ? item : { ...item, artifact };
  });
  return changed ? {
    ...overview,
    artifacts,
    workspace: overview.workspace && items ? { ...overview.workspace, items } : overview.workspace,
  } : overview;
}

export function retainShellHydratedArtifacts(
  current: Record<string, SpectraArtifact>,
  retainedIds: ReadonlySet<string>,
) {
  const entries = Object.entries(current).filter(([id, artifact]) =>
    retainedIds.has(id) && artifact.accessLevel !== null && artifact.status !== "deleted");
  return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
}

/** A refreshed canonical body must beat the earlier detail used to open it. */
export function mergeShellArtifactContent(
  listed: SpectraArtifact,
  hydrated?: SpectraArtifact,
): SpectraArtifact {
  if (!hydrated) return listed;
  // A metadata-only list may be cached across a permission change. Preserve
  // the complete authorized detail, including its role and version, rather
  // than grafting older list permissions onto the freshly fetched body.
  return listed.content !== undefined && listed.updatedAt > hydrated.updatedAt
    ? listed
    : hydrated;
}
