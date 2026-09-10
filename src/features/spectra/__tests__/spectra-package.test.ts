import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  createSpectraPackage,
  openSpectraPackage,
} from "../lenses/spectra-package";
import { validateArtifactContent } from "../artifacts/registry";
import {
  LIBRARY_IMPORT_ACCEPT,
  documentContentFromImportedHtml,
  documentContentFromImportedPlainText,
  projectLibraryImportContent,
} from "../organization/library-import";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const content = {
  settings: { shuffle: true, revealMode: "click" as const },
  cards: [{ id: "card-1", front: "Question", back: "Answer" }],
};

describe("Spectra package", () => {
  afterEach(() => vi.useRealTimers());

  it("creates byte-identical archives for equivalent content and entry order", () => {
    const first = createSpectraPackage({
      artifactType: "flashcard_deck",
      schemaVersion: 3,
      createdByVersion: "spectra-test",
      content,
      assets: { "b.txt": strToU8("B"), "a.txt": strToU8("A") },
      history: { "2.json": strToU8("2"), "1.json": strToU8("1") },
    });
    const second = createSpectraPackage({
      artifactType: "flashcard_deck",
      schemaVersion: 3,
      createdByVersion: "spectra-test",
      content: {
        cards: [{ back: "Answer", front: "Question", id: "card-1" }],
        settings: { revealMode: "click", shuffle: true },
      },
      assets: { "a.txt": strToU8("A"), "b.txt": strToU8("B") },
      history: { "1.json": strToU8("1"), "2.json": strToU8("2") },
    });
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
  });

  it("opens a package with directory entries and validates the restored content", async () => {
    const bytes = createSpectraPackage({
      artifactType: "flashcard_deck",
      schemaVersion: 3,
      createdByVersion: "spectra-test",
      content,
    });
    const opened = await openSpectraPackage(bytes);
    expect(opened.manifest.artifactType).toBe("flashcard_deck");
    expect(opened.content).toEqual(content);
    expect(validateArtifactContent(opened.manifest.artifactType, opened.content).success).toBe(true);

    const withDirectories = zipSync({
      "README.txt": strToU8("Spectra package"),
      "content.json": strToU8(JSON.stringify(content)),
      "manifest.json": strToU8(JSON.stringify(opened.manifest)),
      "assets/": new Uint8Array(),
      "history/": new Uint8Array(),
    });
    expect((await openSpectraPackage(withDirectories)).content).toEqual(content);
  });

  it("stays byte-identical when the wall clock changes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T08:00:00.000Z"));
    const first = createSpectraPackage({
      artifactType: "flashcard_deck",
      schemaVersion: 3,
      createdByVersion: "spectra-test",
      content,
    });
    vi.setSystemTime(new Date("2026-08-27T20:00:00.000Z"));
    const second = createSpectraPackage({
      artifactType: "flashcard_deck",
      schemaVersion: 3,
      createdByVersion: "spectra-test",
      content,
    });

    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
  });

  it("makes portable packages selectable from the Library importer", () => {
    expect(LIBRARY_IMPORT_ACCEPT.split(",")).toContain(".spectra-pkg");
  });

  it("projects imported HTML instead of leaving a blank document", () => {
    const projected = documentContentFromImportedHtml(
      "<h1>P8.V1 F2 page 1</h1><p>Density fixture.</p>",
    );
    expect(projected.blocks).toEqual([
      {
        id: "block-1",
        type: "heading",
        text: "P8.V1 F2 page 1",
        attrs: { level: 1 },
      },
      { id: "block-2", type: "paragraph", text: "Density fixture." },
    ]);
    expect(projected.outline[0]?.title).toBe("P8.V1 F2 page 1");
  });

  it("asks Library import to project Office files instead of a blank default", async () => {
    const shell = readFileSync(
      resolve(__dirname, "../pages/spectra-shell.tsx"),
      "utf8",
    );
    expect(shell).toContain("projectLibraryImportContent");
    expect(shell).not.toMatch(
      /importedContent = portable\?\.content \?\? fallback\.content/,
    );
    expect(shell).toContain("projectLibraryImportContent(file, blueprintKey)");
    expect(shell).toContain("importLibraryResourceFile");
  });

  it("projects plain text library imports; PDF projection helper remains available", async () => {
    const plain = documentContentFromImportedPlainText(
      "First paragraph.\n\nSecond paragraph with enough text.",
    );
    expect(plain.blocks.map((block) => block.text)).toEqual([
      "First paragraph.",
      "Second paragraph with enough text.",
    ]);

    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF();
    pdf.text("QA Resource Citizen", 20, 20);
    const pdfBytes = new Uint8Array(pdf.output("arraybuffer"));
    const file = new File([pdfBytes], "qa-resource-citizen.pdf", {
      type: "application/pdf",
    });
    const projected = await projectLibraryImportContent(file, "document");
    expect(projected).toBeTruthy();
    const blocks = (projected as { blocks: Array<{ text: string }> }).blocks;
    expect(blocks.some((block) => /QA Resource Citizen/i.test(block.text))).toBe(
      true,
    );
  });



  it("refuses traversal, unexpected entries, and invalid artifact content", async () => {
    const manifest = JSON.stringify({
      packageFormatVersion: 1,
      artifactType: "flashcard_deck",
      schemaVersion: 3,
      createdByVersion: "spectra-test",
    });
    const archive = (extra: Record<string, Uint8Array>, value: unknown = content) =>
      zipSync({
        "README.txt": strToU8("Spectra package"),
        "content.json": strToU8(JSON.stringify(value)),
        "manifest.json": strToU8(manifest),
        ...extra,
      });
    await expect(
      openSpectraPackage(archive({ "assets/../escape.txt": strToU8("no") })),
    ).rejects.toThrowError("SPECTRA_PACKAGE_PATH_INVALID");
    await expect(
      openSpectraPackage(archive({ "extra.txt": strToU8("no") })),
    ).rejects.toThrowError("SPECTRA_PACKAGE_ENTRY_INVALID");
    await expect(
      openSpectraPackage(archive({}, { cards: [] })),
    ).rejects.toThrowError("SPECTRA_PACKAGE_CONTENT_INVALID");
  });
});
