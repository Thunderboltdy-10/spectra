import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { ArtifactEmbedById } from "../components/artifact-embed-host";

function ReferenceNodeView({ node, selected, deleteNode }: NodeViewProps) {
  const embedId =
    typeof node.attrs.embedId === "string" ? node.attrs.embedId : "";
  return (
    <NodeViewWrapper
      className={`my-3 ${selected ? "outline outline-2 outline-offset-2 outline-[color-mix(in_oklab,var(--accent-cyan)_35%,transparent)]" : ""}`}
      data-spectra-reference=""
      data-reference-id={embedId || undefined}
      contentEditable={false}
    >
      {embedId ? (
        <ArtifactEmbedById embedId={embedId} onRemove={deleteNode} />
      ) : (
        <div className="rounded-card border border-dashed border-[var(--border-strong)] bg-[var(--bg-secondary)] px-4 py-3 text-micro text-[var(--text-secondary)]">
          This older reference is no longer linked to a live source. Add it
          again to restore live updates.
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const SpectraReferenceNode = Node.create({
  name: "spectraReference",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      embedId: { default: null },
      containerType: { default: "artifact" },
      containerId: { default: null },
      containerRegionId: { default: "artifact:structure" },
      sourceArtifactId: { default: null },
      mode: { default: "compact" },
      interaction: { default: "read" },
      versionPolicy: { default: "live" },
      pinnedVersionId: { default: null },
      contextPolicy: { default: "summary" },
      displayPreferences: { default: null },
      state: { default: "ready" },
      createdAt: { default: null },
      updatedAt: { default: null },
      blockId: { default: null },
      // Read-only migration input. New insertions never write these forked v2
      // attributes, but existing documents still open with an honest fallback.
      id: { default: null },
      workId: { default: null },
      workType: { default: null },
      anchor: { default: null },
      view: { default: null },
      width: { default: null },
      height: { default: null },
      status: { default: null },
      label: { default: null },
      protocolVersion: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-spectra-reference]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-spectra-reference": "",
        "data-reference-id": HTMLAttributes.embedId,
        role: "group",
        "aria-label": "Live reference",
        contenteditable: "false",
      }),
      "Live reference",
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ReferenceNodeView);
  },
});

export const SpectraCitationNode = Node.create({
  name: "spectraCitation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: null },
      sourceId: { default: null },
      evidenceSpanId: { default: null },
      label: { default: "Citation" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-spectra-citation]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-spectra-citation": "",
        contenteditable: "false",
      }),
      String(HTMLAttributes.label ?? "Citation"),
    ];
  },
});
