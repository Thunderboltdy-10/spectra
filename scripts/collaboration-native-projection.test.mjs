import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { getBlueprint } from "../src/features/spectra/artifacts/blueprint-catalog.ts";
import {
  codeYjsAdapter,
  documentYjsAdapter,
  listWorkYjsAdapters,
  planNativeArtifactYjsMutation,
  workYjsAdapter,
} from "../src/features/spectra/work/models/yjs/index.ts";
import { changedArtifactRegionIds } from "../src/features/spectra/collaboration/artifact-yjs-model.ts";
import {
  isNativeArtifactDocument,
  initializeNativeArtifactDocument,
  nativeArtifactProjection,
  nativeChangedRegionIds,
} from "./collaboration-native-projection.mjs";
import { shouldRepairNativeProjection } from "./collaboration-room-state.mjs";

function defaultContent(typeKey) {
  const blueprint = getBlueprint(typeKey);
  if (!blueprint) throw new Error(`Missing blueprint ${typeKey}`);
  return structuredClone(blueprint.defaultContent);
}

function setEnvelope(document, title) {
  const meta = document.getMap("spectra:work-v2:live-meta");
  meta.set("title", title);
  meta.set("summary", "Gateway projection test");
  meta.set("tags", ["round-one", "native"]);
}

describe("native collaboration gateway projection", () => {
  it.each(listWorkYjsAdapters().map((adapter) => [adapter.workType, adapter]))(
    "bootstraps the canonical %s projection before a client connects",
    (typeKey, adapter) => {
      const canonicalDocument = adapter.createDocument(defaultContent(typeKey));
      const canonicalContent = adapter.project(canonicalDocument);
      const gatewayDocument = new Y.Doc();
      const envelope = {
        title: `${typeKey} bootstrap`,
        summary: "Convex baseline",
        tags: ["round-one", "bootstrap"],
        typeKey,
        schemaVersion: 2,
        content: canonicalContent,
      };

      expect(initializeNativeArtifactDocument(gatewayDocument, envelope)).toBe(
        true,
      );
      expect(nativeArtifactProjection(gatewayDocument, 2)).toEqual(envelope);
      expect(initializeNativeArtifactDocument(gatewayDocument, envelope)).toBe(
        false,
      );
    },
  );

  it.each([
    ["document", documentYjsAdapter],
    ["code", codeYjsAdapter],
    ["sheets", workYjsAdapter("sheets")],
  ])("matches the canonical %s adapter projection", (typeKey, adapter) => {
    const document = adapter.createDocument(defaultContent(typeKey));
    setEnvelope(document, `${typeKey} projection`);

    expect(isNativeArtifactDocument(document)).toBe(true);
    expect(nativeArtifactProjection(document, 2)).toEqual({
      title: `${typeKey} projection`,
      summary: "Gateway projection test",
      tags: ["round-one", "native"],
      typeKey,
      schemaVersion: 2,
      content: adapter.project(document),
    });
  });

  it("does not mistake a legacy-only room for a native model", () => {
    const document = new Y.Doc();
    document.getMap("spectra:artifact-meta").set("initialized", true);
    expect(isNativeArtifactDocument(document)).toBe(false);
    expect(nativeArtifactProjection(document, 1)).toBeNull();
  });

  it("migrates a legacy room from the canonical projection instead of trusting its legacy roots", () => {
    const document = new Y.Doc();
    document.getMap("spectra:artifact-meta").set("initialized", true);
    const envelope = {
      title: "Canonical migration",
      summary: "Convex remains authoritative during the native cutover",
      tags: ["round-one", "migration"],
      typeKey: "document",
      schemaVersion: 2,
      content: documentYjsAdapter.project(
        documentYjsAdapter.createDocument({
          blocks: [
            { id: "canonical", type: "paragraph", text: "Canonical content" },
          ],
        }),
      ),
    };

    expect(initializeNativeArtifactDocument(document, envelope)).toBe(true);
    expect(nativeArtifactProjection(document, 2)).toEqual(envelope);
  });

  it("preserves the canonical rich DOCX projection across gateway bootstrap", () => {
    const canonicalDocument = documentYjsAdapter.createDocument({
      blocks: [
        {
          id: "cover",
          type: "paragraph",
          text: "Essay coverx = 1",
          inlineContent: [
            { kind: "text", text: "Essay cover" },
            {
              kind: "image",
              partName: "/word/media/image1.png",
              mediaType: "image/png",
              altText: "School crest",
              widthEmu: 1_200_000,
              heightEmu: 900_000,
              placement: "inline",
            },
            { kind: "equation", latex: "x = 1", display: "inline" },
          ],
          attrs: { nativeReadOnly: true },
        },
        {
          id: "results-table",
          type: "table",
          text: "Quantity | Value\nEnergy | E = mc^2",
          rows: [
            ["Quantity", "Value"],
            ["Energy", "E = mc^2"],
          ],
          richRows: [
            [
              [{ kind: "text", text: "Quantity" }],
              [{ kind: "text", text: "Value" }],
            ],
            [
              [{ kind: "text", text: "Energy" }],
              [{ kind: "equation", latex: "E = mc^2", display: "block" }],
            ],
          ],
          attrs: { nativeReadOnly: true },
        },
      ],
      outline: [],
      nativeBinding: {
        version: 1,
        profile: "strict-native",
        macroEnabled: false,
        semanticDigest: "a".repeat(64),
        format: "docx",
        identityStable: true,
        sourceArtifactId: "artifact-rich-docx",
        sourcePayloadHash: "b".repeat(64),
      },
    });
    const canonicalContent = documentYjsAdapter.project(canonicalDocument);
    const gatewayDocument = new Y.Doc();
    const envelope = {
      title: "Rich essay",
      summary: "Equations, images, and tables stay ordered",
      tags: ["real-corpus"],
      typeKey: "document",
      schemaVersion: 2,
      content: canonicalContent,
    };

    expect(initializeNativeArtifactDocument(gatewayDocument, envelope)).toBe(
      true,
    );
    const projected = nativeArtifactProjection(gatewayDocument, 2);
    expect(projected).toEqual(envelope);
    expect(nativeChangedRegionIds(envelope, projected)).toEqual([
      "$spectra:native-projection",
    ]);

    canonicalDocument.destroy();
    gatewayDocument.destroy();
  });

  it("projects the same semantic regions that the native AI plan claimed", () => {
    const source = {
      blocks: [
        { id: "intro", type: "heading", text: "Durable sync" },
        { id: "worked", type: "paragraph", text: "2 + 2 = 4" },
      ],
    };
    const document = documentYjsAdapter.createDocument(source);
    setEnvelope(document, "Durable sync probe");
    const before = nativeArtifactProjection(document, 2);
    const nextContent = structuredClone(before.content);
    nextContent.blocks[1].text = "2 + 3 = 5";
    nextContent.tiptap.content[1].content[0].text = "2 + 3 = 5";
    const plan = planNativeArtifactYjsMutation(
      document,
      "document",
      {
        title: before.title,
        summary: before.summary,
        tags: before.tags,
        content: nextContent,
      },
      { clientId: "ai-test", kind: "ai", operationId: "operation-1" },
    );
    plan.apply();
    const after = nativeArtifactProjection(document, 2);
    const derived = changedArtifactRegionIds(
      "document",
      before.content,
      after.content,
    );

    expect(derived).toEqual(
      plan.regions
        .map((region) => region.regionId)
        .filter((regionId) => !regionId.startsWith("metadata:")),
    );
  });

  it("names changed native entities without treating identical projections as empty", () => {
    const before = {
      title: "Essay",
      tags: [],
      typeKey: "document",
      content: { blocks: [{ id: "intro", type: "paragraph", text: "a" }] },
    };
    const after = {
      title: "Essay",
      tags: [],
      typeKey: "document",
      content: { blocks: [{ id: "intro", type: "paragraph", text: "b" }] },
    };
    expect(nativeChangedRegionIds(before, after)).toEqual(["intro"]);
    expect(nativeChangedRegionIds(after, after)).toEqual([
      "$spectra:native-projection",
    ]);
  });

  it("requests projection repair when a replayed durable head is ahead of its checkpoint", () => {
    expect(
      shouldRepairNativeProjection({
        durableHeadSequence: 1,
        lastProjectionSequence: 0,
      }),
    ).toBe(true);
    expect(
      shouldRepairNativeProjection({
        durableHeadSequence: 4,
        lastProjectionSequence: 4,
      }),
    ).toBe(false);
    expect(
      shouldRepairNativeProjection({
        durableHeadSequence: 0,
        lastProjectionSequence: null,
      }),
    ).toBe(false);
  });
});
