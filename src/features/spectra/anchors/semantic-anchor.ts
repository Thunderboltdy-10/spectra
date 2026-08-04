import type { ArtifactTypeKey, SemanticRegion } from "../artifacts/types";
import { getWorkDefinition, type WorkAnchor } from "../work/registry";

export type SemanticAnchor = WorkAnchor & { relativePosition?: Uint8Array };
export type AnchorGeometry = { x: number; y: number; width: number; height: number };
export type AnchorSelection = { regionId?: string; path?: readonly string[]; relativePosition?: Uint8Array; excerpt?: string };

export type WorkAnchorAdapter = {
  exists(anchor: SemanticAnchor, content: unknown): boolean;
  describe(anchor: SemanticAnchor, content: unknown): string;
  reveal(anchor: SemanticAnchor, options?: { focus?: boolean }): Promise<void>;
  resolveGeometry(anchor: SemanticAnchor): AnchorGeometry | null;
  createFromSelection(workId: string, selection: AnchorSelection, content: unknown): SemanticAnchor | null;
  migrate(anchor: SemanticAnchor, content: unknown): SemanticAnchor;
};

export function regionsFor(type: ArtifactTypeKey, content: unknown): SemanticRegion[] {
  return getWorkDefinition(type).model.deriveSemanticRegions(content);
}

export function createWorkAnchorAdapter(
  type: ArtifactTypeKey,
  handlers: {
    reveal?: (anchor: SemanticAnchor, options?: { focus?: boolean }) => void | Promise<void>;
    geometry?: (anchor: SemanticAnchor) => AnchorGeometry | null;
  } = {},
): WorkAnchorAdapter {
  const definition = getWorkDefinition(type);
  const isRoot = (anchor: SemanticAnchor) => anchor.kind === "work:root" || anchor.path.join("/") === "work/root";
  const match = (anchor: SemanticAnchor, content: unknown) => {
    const regions = regionsFor(type, content);
    return regions.find((region) =>
      region.regionId === anchor.stableIds?.regionId ||
      region.path.map(String).join("/") === anchor.path.join("/"));
  };
  return {
    exists: (anchor, content) => anchor.workType === type && (isRoot(anchor) || Boolean(match(anchor, content))),
    describe: (anchor, content) => isRoot(anchor) ? `Whole ${definition.userFacingName.toLowerCase()}` : match(anchor, content)?.label ?? anchor.fallbackExcerpt ?? `${definition.userFacingName} target`,
    reveal: async (anchor, options) => { await handlers.reveal?.(anchor, options); },
    resolveGeometry: (anchor) => handlers.geometry?.(anchor) ?? null,
    createFromSelection: (workId, selection, content) => {
      if (!selection.regionId && (!selection.path || selection.path.join("/") === "work/root")) {
        return { workId, workType: type, kind: "work:root", path: ["work", "root"], stableIds: { workId }, schemaVersion: definition.model.schemaVersion };
      }
      const regions = regionsFor(type, content);
      const region = regions.find((candidate) => candidate.regionId === selection.regionId || candidate.path.map(String).join("/") === selection.path?.join("/"));
      if (!region) return null;
      return {
        ...definition.anchors.fromRegion(workId, region),
        ...(selection.relativePosition ? { relativePosition: selection.relativePosition } : {}),
        ...(selection.excerpt ? { fallbackExcerpt: selection.excerpt } : {}),
      };
    },
    migrate: (anchor, content) => {
      if (isRoot(anchor)) return { ...anchor, workType: type, kind: "work:root", path: ["work", "root"], schemaVersion: definition.model.schemaVersion };
      const region = match(anchor, content) ?? regionsFor(type, content).find((candidate) => candidate.readableText?.includes(anchor.fallbackExcerpt ?? ""));
      return region ? { ...definition.anchors.fromRegion(anchor.workId, region), relativePosition: anchor.relativePosition } : { ...anchor, schemaVersion: definition.model.schemaVersion };
    },
  };
}

export function serializeSemanticAnchor(anchor: SemanticAnchor) {
  return { ...anchor, relativePosition: anchor.relativePosition ? Array.from(anchor.relativePosition) : undefined };
}

export function deserializeSemanticAnchor(value: ReturnType<typeof serializeSemanticAnchor>): SemanticAnchor {
  return { ...value, relativePosition: value.relativePosition ? Uint8Array.from(value.relativePosition) : undefined };
}
