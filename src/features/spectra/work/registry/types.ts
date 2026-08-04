import type { ArtifactTypeKey, SemanticRegion } from "../../artifacts/types";

export type WorkType = ArtifactTypeKey;
export type WorkSurface =
  | "full"
  | "panel"
  | "tile"
  | "read_only"
  | "reference_collapsed"
  | "reference_expanded"
  | "public"
  | "print";

export type WorkCapability =
  | "view"
  | "edit"
  | "interact"
  | "attempt"
  | "submit"
  | "present"
  | "execute"
  | "ai_mutate";

export type WorkModeDefinition = {
  id: string;
  label: string;
  requiredCapability: WorkCapability;
  primary?: boolean;
};

/** The two roles sharing can grant. Everything else is an internal capability. */
export type WorkSharingRole = "read_only" | "edit";

/**
 * What a type can actually do, stated once so surfaces, permissions and the
 * conformance suite read the same truth instead of each re-deriving it.
 */
export type WorkCapabilityTruth = {
  present: boolean;
  execute: boolean;
  assess: boolean;
  embedInteractively: boolean;
};

export type WorkCommentContract = {
  anchorKinds: readonly string[];
  supportsGeneral: boolean;
};

export type WorkHistoryContract = {
  snapshot: "yjs-snapshot" | "content-addressed" | "normalized";
  partialRestore: boolean;
};

export type WorkInteroperabilityContract = {
  imports: readonly string[];
  exports: readonly string[];
  quarantinesExecutableContent: boolean;
};

export type WorkAccessibilityContract = {
  /** How the type is navigated without a pointer, in one phrase. */
  primaryModel: string;
  /** Core operations that must have a keyboard route. */
  keyboardOperations: readonly string[];
};

/**
 * An empty surface is an invitation to act, so each type states what to do
 * next rather than reporting that nothing is here.
 */
export type WorkEmptyState = {
  headline: string;
  body: string;
  action: string;
};

export type WorkResponsiveContract = {
  minInlineSize: number;
  preferredInlineSize: number;
  supportsPanel: boolean;
  supportsTile: boolean;
  supportsCompact: boolean;
  toolbarPriorities: readonly string[];
};

export type WorkAnchor = {
  workId: string;
  workType: WorkType;
  kind: string;
  path: readonly string[];
  stableIds?: Readonly<Record<string, string>>;
  fallbackExcerpt?: string;
  schemaVersion: number;
};

export type WorkDefinition<TModel = unknown> = {
  key: WorkType;
  internalName: string;
  userFacingName: string;
  description: string;
  model: {
    schemaVersion: number;
    validate(value: unknown): { success: boolean };
    deriveSemanticRegions(value: TModel): SemanticRegion[];
  };
  modes: readonly WorkModeDefinition[];
  surfaces: Readonly<Record<WorkSurface, string | null>>;
  collaboration: {
    partition: "work" | "sheet" | "slide" | "file" | "viewport";
    defaultPolicy: "mergeable" | "interaction_lease" | "structural_claim";
  };
  permissions: {
    readOnly: readonly WorkCapability[];
    edit: readonly WorkCapability[];
  };
  capabilities: WorkCapabilityTruth;
  comments: WorkCommentContract;
  history: WorkHistoryContract;
  interoperability: WorkInteroperabilityContract;
  accessibility: WorkAccessibilityContract;
  emptyState: WorkEmptyState;
  anchors: {
    fromRegion(workId: string, region: SemanticRegion): WorkAnchor;
  };
  references: { collapsed: string; expanded: string };
  sources: { supported: boolean; citationKinds: readonly string[] };
  actions: readonly string[];
  commands: readonly string[];
  responsive: WorkResponsiveContract;
};
