import type { ArtifactTypeKey } from "../../artifacts/types";
import type { SemanticAnchor } from "../../anchors";

export type ReferenceState = "collapsed" | "expanded";
export type ReferenceStatus = "ready" | "no_access" | "deleted" | "archived" | "version_unavailable";
export type ReferenceNode = {
  id: string;
  protocolVersion: 2;
  target: { workId: string; workType: ArtifactTypeKey; anchor?: SemanticAnchor; view?: string };
  state: ReferenceState;
  versionPolicy: "live" | { pinnedVersionId: string };
  width?: number;
  height?: number;
  displayPreferences?: Record<string, unknown>;
  status: ReferenceStatus;
};

export function setReferenceState(reference: ReferenceNode, state: ReferenceState): ReferenceNode {
  return { ...reference, state };
}

export function resizeReference(reference: ReferenceNode, width: number, height: number, host: { width: number; height: number }): ReferenceNode {
  return {
    ...reference,
    width: Math.max(240, Math.min(width, host.width)),
    height: Math.max(120, Math.min(height, host.height)),
  };
}

export function changeReferenceView(reference: ReferenceNode, view: string): ReferenceNode {
  return { ...reference, target: { ...reference.target, view } };
}

export function referenceIdentity(reference: ReferenceNode) {
  return `${reference.id}:${reference.target.workId}:${reference.target.anchor?.path.join("/") ?? "root"}`;
}
