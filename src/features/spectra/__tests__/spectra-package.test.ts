import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  createSpectraPackage,
  openSpectraPackage,
} from "../lenses/spectra-package";
import { validateArtifactContent } from "../artifacts/registry";

const content = {
  settings: { shuffle: true, revealMode: "click" as const },
  cards: [{ id: "card-1", front: "Question", back: "Answer" }],
};

describe("Spectra package", () => {
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

  it("opens a package with directory entries and validates the restored content", () => {
    const bytes = createSpectraPackage({
      artifactType: "flashcard_deck",
      schemaVersion: 3,
      createdByVersion: "spectra-test",
      content,
    });
    const opened = openSpectraPackage(bytes);
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
    expect(openSpectraPackage(withDirectories).content).toEqual(content);
  });

  it("refuses traversal, unexpected entries, and invalid artifact content", () => {
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
    expect(() => openSpectraPackage(archive({ "assets/../escape.txt": strToU8("no") })))
      .toThrowError("SPECTRA_PACKAGE_PATH_INVALID");
    expect(() => openSpectraPackage(archive({ "extra.txt": strToU8("no") })))
      .toThrowError("SPECTRA_PACKAGE_ENTRY_INVALID");
    expect(() => openSpectraPackage(archive({}, { cards: [] })))
      .toThrowError("SPECTRA_PACKAGE_CONTENT_INVALID");
  });
});
