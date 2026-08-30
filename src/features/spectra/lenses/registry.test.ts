import { describe, expect, it } from "vitest";
import { Document } from "@ariadng/office/docx";
import { fidelityRegionMap } from "../commands/office/fidelity-regions";
import { ALL_CAPABILITIES } from "../capabilities/catalog";
import { connectorNativeWriteClaims } from "../capabilities/derivations";
import type { CapabilityDefinition } from "../capabilities/types";
import { csvLens } from "./csv-lens";
import {
  docxLens,
  type DocxProjection,
  type DocxSemanticDelta,
} from "./docx-lens";
import {
  interchangeShimIssues,
  materializeThroughInterchange,
  openThroughInterchange,
  type ProviderInterchangeShim,
} from "./interchange";
import { mdLens } from "./md-lens";
import {
  connectorNativeWriteIssues,
  lensRegistrationFor,
  registeredLens,
  requireLensRegistration,
} from "./registry";

const bytes = (value: string) => new TextEncoder().encode(value);
const text = (value: Uint8Array) => new TextDecoder().decode(value);

describe("formal lens registry", () => {
  it("resolves every OOXML alias and proof format through one registry", () => {
    expect(requireLensRegistration(".DOCM").canonicalFormat).toBe("docx");
    expect(requireLensRegistration("xlsm").canonicalFormat).toBe("xlsx");
    expect(requireLensRegistration("ppsm").canonicalFormat).toBe("pptx");
    expect(registeredLens("markdown")).toBe(mdLens);
    expect(registeredLens("csv")).toBe(csvLens);
    expect(lensRegistrationFor("pdf")).toBeUndefined();
  });

  it("rejects unregistered or schema-missing connector-native writes", () => {
    expect(
      connectorNativeWriteIssues([
        {
          capabilityId: "document.edit",
          workType: "document",
          nativeFormat: "gdoc",
          delta: "replace-body",
        },
        {
          capabilityId: "sheets.edit",
          workType: "sheets",
          nativeFormat: "csv",
          delta: "format-cell",
        },
      ]),
    ).toEqual([
      "document.edit: claims a connector-backed gdoc write, but that native format has no registered lens.",
      'sheets.edit: claims connector-backed delta "format-cell" for csv, but the registered csv lens does not implement it.',
    ]);
  });

  it("extends the real capability ghost gate with connector mappings", () => {
    const documentCapability = ALL_CAPABILITIES.find((definition) =>
      definition.id.startsWith("document."),
    );
    expect(documentCapability).toBeDefined();
    const definitions = ALL_CAPABILITIES.map((definition) =>
      definition === documentCapability
        ? {
            ...definition,
            connectorNative: [
              { nativeFormat: "md", delta: "missing-markdown-delta" },
            ],
          }
        : definition,
    ) as readonly CapabilityDefinition[];
    expect(
      connectorNativeWriteIssues(connectorNativeWriteClaims(definitions)),
    ).toContain(
      `${documentCapability!.id}: claims connector-backed delta "missing-markdown-delta" for md, but the registered md lens does not implement it.`,
    );
  });
});

describe("Markdown proof lens", () => {
  const source = bytes(
    "---\ncourse: Physics\n---\n# Waves\n\nReview [[Physics IA|the investigation]].\n",
  );

  it("keeps frontmatter and wiki-links explicit while round-tripping edits", async () => {
    const opened = await mdLens.open(source);
    expect(opened.projection.nativeBinding.frontmatter).toBe(
      "---\ncourse: Physics\n---\n",
    );
    expect(opened.projection.body).toContain(
      "[[Physics IA|the investigation]]",
    );
    expect(opened.fidelityMap.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feature: "frontmatter",
          class: "PRESERVED",
          readOnly: true,
        }),
        expect.objectContaining({
          feature: "hyperlinks",
          class: "PRESERVED",
          readOnly: true,
        }),
      ]),
    );
    await expect(
      mdLens.materialize({
        projection: opened.projection,
        carry: opened.preservedCarry,
      }),
    ).resolves.toEqual(source);

    const output = await mdLens.mutate(opened.preservedCarry, {
      kind: "replace-body",
      body: opened.projection.body.replace("Waves", "Standing waves"),
    });
    expect(text(output)).toContain("course: Physics");
    expect(text(output)).toContain("# Standing waves");
    expect((await mdLens.diffExternal(source, output)).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ regionId: "md:body" }),
      ]),
    );
  });

  it("refuses to rewrite preserved frontmatter through projection materialization", async () => {
    const opened = await mdLens.open(source);
    await expect(
      mdLens.materialize({
        projection: {
          ...opened.projection,
          nativeBinding: {
            ...opened.projection.nativeBinding,
            frontmatter: "---\ncourse: Chemistry\n---\n",
          },
        },
        carry: opened.preservedCarry,
      }),
    ).rejects.toMatchObject({ code: "MD_PRESERVED_BOUNDARY_READ_ONLY" });
  });
});

describe("CSV proof lens", () => {
  it("parses quoted rows into stable cell addresses and declares one-table limits", async () => {
    const source = bytes('Subject,Topic\nPhysics,"Waves, standing"\n');
    const opened = await csvLens.open(source);
    expect(opened.projection.table.cells).toEqual(
      expect.arrayContaining([
        { id: "csv:B2", ref: "B2", value: "Waves, standing" },
      ]),
    );
    expect(opened.fidelityMap.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ feature: "cells", class: "NATIVE" }),
        expect.objectContaining({
          feature: "sheetStructure",
          class: "PRESERVED",
        }),
      ]),
    );
    const output = await csvLens.mutate(opened.preservedCarry, {
      kind: "set-cell",
      ref: "C2",
      value: "New column",
    });
    const reopened = await csvLens.open(output);
    expect(reopened.projection.table.cells).toContainEqual({
      id: "csv:C2",
      ref: "C2",
      value: "New column",
    });
    expect((await csvLens.diffExternal(source, output)).changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ regionId: "csv:C2" })]),
    );
  });
});

describe("provider interchange contract", () => {
  const shim: ProviderInterchangeShim<Uint8Array, Uint8Array> = {
    id: "google-docs-ooxml",
    providerId: "google-drive",
    providerNativeFormat: "google-doc",
    interchangeFormat: "docx",
    direction: "round-trip",
    fidelityBoundary: [
      {
        feature: "body",
        class: "EQUIVALENT",
        reason: "Google export may normalize Word-compatible body formatting.",
      },
      {
        feature: "tables",
        class: "PRESERVED",
        reason: "Google export owns complex table conversion.",
        readOnly: true,
      },
    ],
    async toInterchange(payload) {
      return { payload, providerRevision: "head-42" };
    },
    async fromInterchange(payload) {
      return payload;
    },
  };

  it("overlays conversion fidelity before capability gating and writes back through the shim", async () => {
    const remoteDocument = Document.create();
    remoteDocument.addParagraph("Remote body");
    const opened = await openThroughInterchange<
      DocxProjection,
      DocxSemanticDelta,
      Uint8Array,
      Uint8Array
    >(shim, await remoteDocument.save());
    expect(opened.interchange.providerRevision).toBe("head-42");
    expect(fidelityRegionMap(opened.fidelityMap.entries)).toMatchObject({
      body: "EQUIVALENT",
      tables: "PRESERVED",
    });
    const output = await materializeThroughInterchange<
      DocxProjection,
      DocxSemanticDelta,
      Uint8Array,
      Uint8Array
    >({
      shim,
      projection: {
        ...opened.projection,
        blocks: opened.projection.blocks.map((block, index) =>
          index === 0 ? { ...block, text: "Changed body" } : block,
        ),
      },
      carry: opened.preservedCarry,
      providerRevision: opened.interchange.providerRevision,
    });
    expect((await docxLens.open(output)).projection.blocks[0]?.text).toBe(
      "Changed body",
    );
    await expect(
      materializeThroughInterchange<
        DocxProjection,
        DocxSemanticDelta,
        Uint8Array,
        Uint8Array
      >({
        shim,
        projection: opened.projection,
        carry: opened.preservedCarry,
        providerRevision: "",
      }),
    ).rejects.toThrow("INTERCHANGE_PROVIDER_REVISION_MISSING");
  });

  it("rejects a round-trip claim without a writer or fidelity boundary", () => {
    expect(
      interchangeShimIssues({
        ...shim,
        fidelityBoundary: [],
        fromInterchange: undefined,
      }),
    ).toEqual([
      "google-docs-ooxml: conversion fidelity boundary is empty.",
      "google-docs-ooxml: claims round-trip conversion but has no interchange-to-provider writer.",
    ]);
  });
});
