import type {
  ArtifactEmbedMode,
  ArtifactEmbedReference,
} from "../../../../../shared/artifact-embed";

export type ReferenceNode = ArtifactEmbedReference;

export function setReferenceMode(
  reference: ReferenceNode,
  mode: ArtifactEmbedMode,
): ReferenceNode {
  return { ...reference, mode };
}

export function resizeReference(
  reference: ReferenceNode,
  width: number,
  height: number,
  host: { width: number; height: number },
): ReferenceNode {
  return {
    ...reference,
    displayPreferences: {
      ...reference.displayPreferences,
      width: Math.max(240, Math.min(width, host.width)),
      height: Math.max(120, Math.min(height, host.height)),
    },
  };
}

export function changeReferenceView(
  reference: ReferenceNode,
  view: string,
): ReferenceNode {
  return {
    ...reference,
    displayPreferences: { ...reference.displayPreferences, view },
  };
}

export function referenceIdentity(reference: ReferenceNode) {
  return reference.embedId;
}
