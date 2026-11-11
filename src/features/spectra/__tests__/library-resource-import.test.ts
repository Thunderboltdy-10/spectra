import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LIBRARY_IMPORT_ACCEPT,
  classifyLibraryImport,
  documentContentFromImportedPlainText,
  isOfficeNativeImportFile,
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

  it("treats legacy .doc as a Library resource, not a Word projection", () => {
    const legacy = new File([new Uint8Array([0xd0, 0xcf])], "essay.doc", {
      type: "application/msword",
    });
    expect(classifyLibraryImport(legacy)).toEqual({
      kind: "resource",
      nativeFormat: "doc",
    });
  });

  it("keeps .doc in the Import accept list without claiming Word artifact", () => {
    expect(LIBRARY_IMPORT_ACCEPT.split(",")).toContain(".doc");
    expect(LIBRARY_IMPORT_ACCEPT.split(",")).toContain(".docx");
    const src = readFileSync(
      resolve(__dirname, "../organization/library-import.ts"),
      "utf8",
    );
    // Legacy OLE .doc must not be mapped as editable document work.
    expect(src).not.toMatch(/\n\s*doc:\s*"document",/);
    expect(src).toMatch(/docx:\s*"document"/);
  });

  it("gates the office lens to OOXML natives only", () => {
    expect(
      isOfficeNativeImportFile(
        new File([""], "essay.DOCX", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ),
    ).toBe(true);
    expect(
      isOfficeNativeImportFile(
        new File([""], "book.xlsx", {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      ),
    ).toBe(true);
    expect(
      isOfficeNativeImportFile(
        new File([""], "deck.PPTX", {
          type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        }),
      ),
    ).toBe(true);
    // Legacy OLE and text/md share work blueprints but must not hit the lens.
    expect(
      isOfficeNativeImportFile(
        new File([new Uint8Array([0xd0, 0xcf])], "essay.doc", {
          type: "application/msword",
        }),
      ),
    ).toBe(false);
    expect(
      isOfficeNativeImportFile(new File(["hi"], "note.txt", { type: "text/plain" })),
    ).toBe(false);
    expect(
      isOfficeNativeImportFile(new File(["# hi"], "note.md", { type: "text/markdown" })),
    ).toBe(false);
  });

  it("does not Word-route .doc and does not swallow office lens failures", () => {
    const shell = readFileSync(
      resolve(__dirname, "../pages/spectra-shell.tsx"),
      "utf8",
    );
    // Resource classify short-circuits before work/office projection.
    expect(shell).toContain('classification.kind === "resource"');
    expect(shell).toContain("importLibraryResourceFile");
    // Office lens gated by OOXML helper — not by document/sheets/presentation alone.
    expect(shell).toContain("isOfficeNativeImportFile(file)");
    expect(shell).not.toMatch(
      /projectOfficeImportWithLens\(file\)\.catch\(\(\) => null\)/,
    );
    const importFnAt = shell.indexOf("async function importLibraryFile");
    expect(importFnAt).toBeGreaterThan(-1);
    const importFnSlice = shell.slice(importFnAt, importFnAt + 5500);
    expect(importFnSlice).toContain("await projectOfficeImportWithLens(file, created.artifactId)");
    // Blueprint-only gate must not remain (would POST .txt/.md to office).
    expect(importFnSlice).not.toMatch(
      /blueprintKey === "document"[\s\S]{0,120}projectOfficeImportWithLens/,
    );
  });

  it("keeps Office and text as editable artifact imports", () => {
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

  it("forwards parentNodeId from the open folder on both Import paths", () => {
    const organizer = readFileSync(
      resolve(__dirname, "../organization/library-organizer.tsx"),
      "utf8",
    );
    const shell = readFileSync(
      resolve(__dirname, "../pages/spectra-shell.tsx"),
      "utf8",
    );
    // Organizer threads the same parent New uses into onImportFile.
    expect(organizer).toContain("onImportFile?.(file, currentParentId)");
    expect(organizer).toMatch(
      /onImportFile\?:\s*\(file:\s*File,\s*parentNodeId\?:\s*string\s*\|\s*null\)\s*=>\s*void/,
    );
    // Shell accepts parent and passes it to resource + work createArtifact paths.
    expect(shell).toContain("importLibraryFile(");
    expect(shell).toContain("parentNodeId?: string | null");
    expect(shell).toContain("parentNodeId: placementParentId");
    expect(shell).toContain(
      "...(placementParentId ? { parentNodeId: placementParentId } : {})",
    );
    const resourceCallAt = shell.indexOf("importLibraryResourceFile(file,");
    // Both import branches must mention placementParentId after the resource call site.
    expect(resourceCallAt).toBeGreaterThan(-1);
    expect(shell.indexOf("placementParentId", resourceCallAt)).toBeGreaterThan(
      resourceCallAt,
    );
    const importFnAt = shell.indexOf("async function importLibraryFile");
    expect(importFnAt).toBeGreaterThan(-1);
    const importFnSlice = shell.slice(importFnAt, importFnAt + 4500);
    expect(importFnSlice).toContain("parentNodeId: placementParentId");
    expect(importFnSlice).toContain(
      "...(placementParentId ? { parentNodeId: placementParentId } : {})",
    );
  });
});
