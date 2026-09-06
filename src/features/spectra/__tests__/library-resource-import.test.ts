import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyLibraryImport,
  documentContentFromImportedPlainText,
  projectLibraryImportContent,
} from "../organization/library-import";

describe("Library Import resource citizens (D29)", () => {
  it("classifies PDFs and images as resources, not documents", () => {
    const pdf = new File([new Uint8Array([1, 2, 3])], "qa-resource-citizen.pdf", {
      type: "application/pdf",
    });
    expect(classifyLibraryImport(pdf)).toEqual({
      kind: "resource",
      nativeFormat: "pdf",
    });

    const image = new File([new Uint8Array([1])], "photo.png", {
      type: "image/png",
    });
    expect(classifyLibraryImport(image)).toEqual({
      kind: "resource",
      nativeFormat: "png",
    });

    const unknown = new File([new Uint8Array([9])], "notes.xyz", {
      type: "application/octet-stream",
    });
    expect(classifyLibraryImport(unknown).kind).toBe("resource");
  });

  it("keeps Office and text as editable work imports", () => {
    expect(
      classifyLibraryImport(
        new File([""], "deck.pptx", {
          type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        }),
      ),
    ).toMatchObject({ kind: "work", blueprintKey: "presentation" });
    expect(
      classifyLibraryImport(
        new File([""], "essay.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ),
    ).toMatchObject({ kind: "work", blueprintKey: "document" });
    expect(
      classifyLibraryImport(new File(["hi"], "note.txt", { type: "text/plain" })),
    ).toMatchObject({ kind: "work", blueprintKey: "document" });
  });

  it("routes Library Import through the resource API for ordinary files", () => {
    const shell = readFileSync(
      resolve(__dirname, "../pages/spectra-shell.tsx"),
      "utf8",
    );
    expect(shell).toContain("classifyLibraryImport");
    expect(shell).toContain("importLibraryResourceFile");
    expect(shell).toContain('classification.kind === "resource"');
  });

  it("still projects plain text when imported as a document", async () => {
    const plain = documentContentFromImportedPlainText(
      "First paragraph.\n\nSecond paragraph with enough text.",
    );
    expect(plain.blocks.map((block) => block.text)).toEqual([
      "First paragraph.",
      "Second paragraph with enough text.",
    ]);
    const file = new File(["Hello"], "note.txt", { type: "text/plain" });
    const projected = await projectLibraryImportContent(file, "document");
    expect(projected).toBeTruthy();
  });

  it("compensates hollow citizens when the resource payload upload fails", () => {
    const route = readFileSync(
      resolve(__dirname, "../../../app/api/spectra/resources/route.ts"),
      "utf8",
    );
    expect(route).toContain("createImportedResource");
    expect(route).toContain("RESOURCE_PAYLOAD_UPLOAD_FAILED");
    expect(route).toContain("spectraArtifacts:permanentlyDelete");
    expect(route).toContain("discardHollowImport");
    // Create still precedes upload (issueUpload needs workId), but failure
    // must not leave content:null artifacts in Library.
    const createAt = route.indexOf("createImportedResource");
    const deleteAt = route.indexOf("permanentlyDelete");
    const failAt = route.indexOf("RESOURCE_PAYLOAD_UPLOAD_FAILED");
    expect(createAt).toBeGreaterThan(-1);
    expect(failAt).toBeGreaterThan(createAt);
    expect(deleteAt).toBeGreaterThan(-1);
  });
});
