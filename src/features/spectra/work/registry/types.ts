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
  anchors: {
    fromRegion(workId: string, region: SemanticRegion): WorkAnchor;
  };
  references: { collapsed: string; expanded: string };
  sources: { supported: boolean; citationKinds: readonly string[] };
  actions: readonly string[];
  commands: readonly string[];
  responsive: WorkResponsiveContract;
};
