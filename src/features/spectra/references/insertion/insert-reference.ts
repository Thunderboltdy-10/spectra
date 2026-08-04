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
  const anchorKind = reference.target.anchor?.kind ?? getWorkReferenceContract(reference.target.workType).targets[0]?.kind ?? "work";
  if (!validateReferenceView(reference.target.workType, anchorKind, reference.target.view)) throw new Error("REFERENCE_VIEW_UNSUPPORTED");
  const common = {
    id: reference.id, protocolVersion: reference.protocolVersion, workId: reference.target.workId,
    workType: reference.target.workType, anchor: reference.target.anchor, view: reference.target.view,
    state: reference.state, versionPolicy: reference.versionPolicy, displayPreferences: reference.displayPreferences,
  };
  const payload: Record<string, unknown> = contract.insertion === "tiptap_node"
    ? { type: "spectraReference", attrs: common }
    : contract.insertion === "slide_element"
      ? { type: "reference", elementId: reference.id, reference: common }
      : contract.insertion === "board_object"
        ? { kind: "reference", objectId: reference.id, reference: common }
        : contract.insertion === "sheet_object"
          ? { kind: "reference", objectId: reference.id, reference: common }
          : contract.insertion === "detail_block"
            ? { kind: "reference", blockId: reference.id, reference: common }
            : contract.insertion === "calendar_reference"
              ? { kind: "calendar_reference", reference: common }
              : { kind: "source_reference", sourceElementId: reference.id, reference: common };
  return { hostWorkType, primitive: contract.insertion, origin, referenceId: reference.id, payload };
}

export function parseSpectraWorkUrl(value: string) {
  const match = value.trim().match(/(?:https?:\/\/[^/]+)?\/(?:library|artifacts)\/([^/?#]+)(?:\?[^#]*)?(?:#(.+))?$/i);
  return match ? { workId: decodeURIComponent(match[1]!), fragment: match[2] ? decodeURIComponent(match[2]) : undefined } : null;
}

export function insertionFromPaste(hostWorkType: ArtifactTypeKey, value: string, build: (target: { workId: string; fragment?: string }) => ReferenceNode) {
  const target = parseSpectraWorkUrl(value);
  return target ? createNativeReferenceInsertion(hostWorkType, build(target), "paste") : null;
}
