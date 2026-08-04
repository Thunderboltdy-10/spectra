import type { z } from "zod";

export const ARTIFACT_TYPE_KEYS = [
  "document",
  "flashcard_deck",
  "quiz",
  "planner_task",
  "agent",
  "timetable",
  "presentation",
  "sheets",
  "code",
  "whiteboard",
] as const;

export type ArtifactTypeKey = (typeof ARTIFACT_TYPE_KEYS)[number];

/**
 * Canonical creatable work types. `timetable` remains in the legacy artifact
 * union only so old snapshots and links can be migrated into `/calendar`.
 */
export const WORK_TYPE_KEYS = [
  "document",
  "flashcard_deck",
  "quiz",
  "planner_task",
  "agent",
  "presentation",
  "sheets",
  "code",
  "whiteboard",
] as const;

export type WorkTypeKey = (typeof WORK_TYPE_KEYS)[number];
export const CREATABLE_ARTIFACT_TYPE_KEYS = WORK_TYPE_KEYS;

export type SemanticRegion = {
  regionId: string;
  kind: string;
  parentRegionId?: string;
  label: string;
  path: readonly (string | number)[];
  overlapDomain: string;
  readableText?: string;
};

export type ArtifactSkill = {
  typeKey: ArtifactTypeKey;
  purpose: string;
  createWhen: readonly string[];
  inspect: readonly string[];
  regions: readonly string[];
  operations: readonly string[];
  preservationRules: readonly string[];
  validation: readonly string[];
  approvals: readonly string[];
  connections: readonly string[];
  workingEffects: readonly string[];
  specialistGuides?: readonly {
    id: string;
    trigger: string;
    instructions: readonly string[];
  }[];
};

export type ArtifactTypeManifest<TSchema extends z.ZodType = z.ZodType> = {
  identity: {
    typeKey: ArtifactTypeKey;
    displayName: string;
    description: string;
    category: "writing" | "practice" | "planning" | "intelligence" | "data" | "creative" | "technical";
    icon: string;
    minimumAppVersion: 1;
  };
  schemas: {
    currentVersion: number;
    content: TSchema;
  };
  renderers: {
    full: string;
    panel: string;
    compact: string;
    embedCompact: string;
    embedExpanded: string;
    historical: string;
    print: string | null;
  };
  editor: {
    routeSegment: string;
    sync: "yjs" | "transactional";
    validity: "continuous" | "transactional";
    minimumPanelWidth: 320;
  };
  operations: readonly string[];
  regions: (content: z.infer<TSchema>) => SemanticRegion[];
  loadSkill: () => Promise<ArtifactSkill>;
  collaboration: {
    roomPartition: "artifact" | "sheet" | "slide" | "file" | "viewport";
    commentAnchors: readonly string[];
    awareness: readonly string[];
  };
  history: {
    snapshot: "normalized" | "content-addressed" | "yjs-snapshot";
    partialRestore: boolean;
  };
  capabilities: {
    canPresent: boolean;
    canExecute: boolean;
    canAssessFormatively: boolean;
    canEmbedInteractively: boolean;
  };
  interoperability: {
    imports: readonly string[];
    exports: readonly string[];
    quarantinesExecutableContent: boolean;
  };
  quality: {
    virtualizeAfter: number;
    primaryAccessibilityModel: string;
  };
};

export function defineArtifactSkill(skill: ArtifactSkill) {
  return Object.freeze(skill);
}
