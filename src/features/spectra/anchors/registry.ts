import { ARTIFACT_TYPE_KEYS, type ArtifactTypeKey } from "../artifacts/types";
import { createWorkAnchorAdapter, type WorkAnchorAdapter } from "./semantic-anchor";

export const WORK_ANCHOR_ADAPTERS = Object.fromEntries(
  ARTIFACT_TYPE_KEYS.map((type) => [type, createWorkAnchorAdapter(type)]),
) as Record<ArtifactTypeKey, WorkAnchorAdapter>;

export function getWorkAnchorAdapter(type: ArtifactTypeKey) {
  return WORK_ANCHOR_ADAPTERS[type];
}
