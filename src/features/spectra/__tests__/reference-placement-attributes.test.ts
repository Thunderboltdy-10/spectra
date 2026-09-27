// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it, vi } from "vitest";
import { SpectraReferenceNode } from "../editor/reference-citation-nodes";

vi.mock("../components/artifact-embed-host", () => ({
  ArtifactEmbedById: () => null,
}));

describe("document reference placement attributes", () => {
  it("keeps the operation and exact pin through real editor insertion and JSON reload", () => {
    const reference = {
      embedId: "embed-retained",
      placementOperationId: "placement-operation",
      containerType: "artifact",
      containerId: "host-document",
      containerRegionId: "document:reference:retained",
      sourceArtifactId: "source-artifact",
      versionPolicy: "pinned",
      pinnedVersionId: "source-version-old",
      label: "Retained work",
    };
    const first = new Editor({
      extensions: [StarterKit, SpectraReferenceNode],
      content: "<p>Keep this paragraph.</p>",
    });
    let reloaded: Editor | undefined;
    try {
      first.commands.insertContent({
        type: "spectraReference",
        attrs: reference,
      });
      const saved = first.getJSON();
      expect(
        saved.content?.find((node) => node.type === "spectraReference")?.attrs,
      ).toMatchObject(reference);
      reloaded = new Editor({
        extensions: [StarterKit, SpectraReferenceNode],
        content: JSON.parse(JSON.stringify(saved)),
      });
      expect(
        reloaded
          .getJSON()
          .content?.find((node) => node.type === "spectraReference")?.attrs,
      ).toMatchObject(reference);
      expect(JSON.stringify(reloaded.getJSON())).toContain(
        "Keep this paragraph.",
      );
    } finally {
      reloaded?.destroy();
      first.destroy();
    }
  });
});
