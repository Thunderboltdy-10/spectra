import type { ArtifactTypeKey } from "../../artifacts/types";
import { getWorkReferenceContract, validateReferenceView } from "../registry";
import type { ReferenceNode } from "../model/reference-node";

export type ReferenceInsertionOrigin = "command" | "paste" | "drag" | "context" | "ai" | "suggestion";
export type NativeReferenceInsertion = {
  hostWorkType: ArtifactTypeKey;
  primitive: ReturnType<typeof getWorkReferenceContract>["insertion"];
  origin: ReferenceInsertionOrigin;
  referenceId: string;
  payload: Record<string, unknown>;
};

export function createNativeReferenceInsertion(hostWorkType: ArtifactTypeKey, reference: ReferenceNode, origin: ReferenceInsertionOrigin): NativeReferenceInsertion {
  const contract = getWorkReferenceContract(hostWorkType);
  const view = typeof reference.displayPreferences?.view === "string"
    ? reference.displayPreferences.view
    : undefined;
  const anchorKind = typeof reference.displayPreferences?.anchorKind === "string"
    ? reference.displayPreferences.anchorKind
    : "work:root";
  const sourceType = reference.displayPreferences?.sourceWorkType;
  if (typeof sourceType === "string" && view && !validateReferenceView(sourceType as ArtifactTypeKey, anchorKind, view)) {
    throw new Error("REFERENCE_VIEW_UNSUPPORTED");
  }
  const common = { ...reference };
  const payload: Record<string, unknown> = contract.insertion === "tiptap_node"
    ? { type: "spectraReference", attrs: common }
    : contract.insertion === "slide_element"
      ? { type: "reference", elementId: reference.embedId, reference: common }
      : contract.insertion === "board_object"
        ? { kind: "reference", objectId: reference.embedId, reference: common }
        : contract.insertion === "sheet_object"
          ? { kind: "reference", objectId: reference.embedId, reference: common }
          : contract.insertion === "detail_block"
            ? { kind: "reference", blockId: reference.embedId, reference: common }
            : contract.insertion === "calendar_reference"
              ? { kind: "calendar_reference", reference: common }
              : { kind: "source_reference", sourceElementId: reference.embedId, reference: common };
  return { hostWorkType, primitive: contract.insertion, origin, referenceId: reference.embedId, payload };
}

export function parseSpectraWorkUrl(value: string) {
  const match = value.trim().match(/(?:https?:\/\/[^/]+)?\/(?:library|artifacts)\/([^/?#]+)(?:\?[^#]*)?(?:#(.+))?$/i);
  return match ? { workId: decodeURIComponent(match[1]!), fragment: match[2] ? decodeURIComponent(match[2]) : undefined } : null;
}

export function insertionFromPaste(hostWorkType: ArtifactTypeKey, value: string, build: (target: { workId: string; fragment?: string }) => ReferenceNode) {
  const target = parseSpectraWorkUrl(value);
  return target ? createNativeReferenceInsertion(hostWorkType, build(target), "paste") : null;
}
