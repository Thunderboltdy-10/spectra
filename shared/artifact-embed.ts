import { v, type Validator } from "convex/values";

export const ARTIFACT_EMBED_CONTAINER_TYPES = ["artifact", "thread"] as const;
export const ARTIFACT_EMBED_MODES = ["compact", "expanded"] as const;
export const ARTIFACT_EMBED_INTERACTIONS = [
  "read",
  "interact",
  "edit",
] as const;
export const ARTIFACT_EMBED_VERSION_POLICIES = ["live", "pinned"] as const;
export const ARTIFACT_EMBED_CONTEXT_POLICIES = [
  "none",
  "summary",
  "visible_region",
] as const;
export const ARTIFACT_EMBED_STATES = [
  "ready",
  "no_access",
  "deleted",
  "archived",
  "version_unavailable",
  "removed",
] as const;

function literalUnion<const Values extends readonly string[]>(values: Values) {
  return v.union(...values.map((value) => v.literal(value))) as Validator<
    Values[number]
  >;
}

/**
 * Runtime validators and TypeScript unions are derived from the same literal
 * lists. Convex functions, the database table, editor nodes, and render hosts
 * therefore cannot acquire separate hand-maintained enum schemas again.
 */
export const artifactEmbedContainerTypeValidator = literalUnion(
  ARTIFACT_EMBED_CONTAINER_TYPES,
);
export const artifactEmbedModeValidator = literalUnion(ARTIFACT_EMBED_MODES);
export const artifactEmbedInteractionValidator = literalUnion(
  ARTIFACT_EMBED_INTERACTIONS,
);
export const artifactEmbedVersionPolicyValidator = literalUnion(
  ARTIFACT_EMBED_VERSION_POLICIES,
);
export const artifactEmbedContextPolicyValidator = literalUnion(
  ARTIFACT_EMBED_CONTEXT_POLICIES,
);
export const artifactEmbedStateValidator = literalUnion(ARTIFACT_EMBED_STATES);

export type ArtifactEmbedContainerType =
  (typeof ARTIFACT_EMBED_CONTAINER_TYPES)[number];
export type ArtifactEmbedMode = (typeof ARTIFACT_EMBED_MODES)[number];
export type ArtifactEmbedInteraction =
  (typeof ARTIFACT_EMBED_INTERACTIONS)[number];
export type ArtifactEmbedVersionPolicy =
  (typeof ARTIFACT_EMBED_VERSION_POLICIES)[number];
export type ArtifactEmbedContextPolicy =
  (typeof ARTIFACT_EMBED_CONTEXT_POLICIES)[number];
export type ArtifactEmbedState = (typeof ARTIFACT_EMBED_STATES)[number];

/**
 * The one portable embed record shared by Convex, editor nodes, boards, chat,
 * export fallbacks, and render hosts. Source content and access projections are
 * deliberately separate so a stored host node cannot retain a title after
 * source access is revoked.
 */
export type ArtifactEmbedReference = {
  embedId: string;
  containerType: ArtifactEmbedContainerType;
  containerId: string;
  containerRegionId: string;
  sourceArtifactId: string;
  mode: ArtifactEmbedMode;
  interaction: ArtifactEmbedInteraction;
  versionPolicy: ArtifactEmbedVersionPolicy;
  pinnedVersionId?: string;
  contextPolicy: ArtifactEmbedContextPolicy;
  displayPreferences?: Record<string, unknown>;
  state: ArtifactEmbedState;
  createdAt?: number;
  updatedAt?: number;
};
