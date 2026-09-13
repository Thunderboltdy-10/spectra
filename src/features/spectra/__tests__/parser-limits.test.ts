import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Document } from "@ariadng/office/docx";
import { strFromU8, strToU8, zipSync } from "fflate";
import {
  OFFICE_ARCHIVE_LIMITS,
  readBoundedArchive,
} from "../../../../shared/parser-limits";

const fixture = (kind: string, name: string) =>
  readFile(join(process.cwd(), "fixtures", "office", kind, name)).then(
    (bytes) => new Uint8Array(bytes),
  );

function rewriteFirstCentralDirectorySize(bytes: Uint8Array, size: number) {
  const output = bytes.slice();
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  for (let offset = 0; offset + 28 <= output.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    view.setUint32(offset + 24, size, true);
    return output;
  }
  throw new Error("fixture has no central-directory entry");
}

describe("bounded parser intake", () => {
  it("stops a dishonest compressed entry at the first output limit", async () => {
    const bomb = zipSync({ "bomb.bin": new Uint8Array(2_000_000).fill(65) }, { level: 9 });
    const dishonest = rewriteFirstCentralDirectorySize(bomb, 0);

    await expect(readBoundedArchive(dishonest)).rejects.toThrow(
      /ARCHIVE_INFLATION_LIMIT: bomb\.bin produced \d+ bytes before its 0-byte limit/,
    );
  });

  it("rejects archive structure abuse before handing data to Office readers", async () => {
    const tooManyEntries = zipSync(
      Object.fromEntries(
        Array.from({ length: 2_001 }, (_, index) => [
          `entries/${index}.txt`,
          strToU8("x"),
        ]),
      ),
    );
    await expect(readBoundedArchive(tooManyEntries)).rejects.toThrow(
      "ARCHIVE_ENTRY_LIMIT",
    );

    const collision = zipSync({
      "A.txt": strToU8("one"),
      "a.txt": strToU8("two"),
    });
    await expect(readBoundedArchive(collision)).rejects.toThrow(
      "ARCHIVE_NAME_COLLISION",
    );

    const traversal = zipSync({ "../escape.txt": strToU8("no") });
    await expect(readBoundedArchive(traversal)).rejects.toThrow("ARCHIVE_INVALID");

    const valid = zipSync({ "valid.txt": strToU8("valid") });
    await expect(readBoundedArchive(valid.slice(0, -1))).rejects.toThrow(
      "ARCHIVE_INVALID",
    );
  });

  it("reads real XML-rich Office packages and can write them back", async () => {
    const docx = await fixture("docx", "equation-omml.docx");
    const boundedDocx = await readBoundedArchive(docx, OFFICE_ARCHIVE_LIMITS);
    const documentXml = strFromU8(boundedDocx.entries["word/document.xml"]!);
    expect(documentXml).toContain("oMath");
    expect(boundedDocx.entries["word/styles.xml"]).toBeDefined();

    const opened = await Document.open(boundedDocx.bytes);
    const saved = await opened.save();
    const reopened = await Document.open(saved);
    expect(reopened.body().children.length).toBeGreaterThan(0);

    const xlsx = await fixture("xlsx", "complex-preservation.xlsx");
    const boundedXlsx = await readBoundedArchive(xlsx, OFFICE_ARCHIVE_LIMITS);
    expect(boundedXlsx.entries["xl/styles.xml"]).toBeDefined();

    const pptx = await fixture("pptx", "media-preservation.pptx");
    const boundedPptx = await readBoundedArchive(pptx, OFFICE_ARCHIVE_LIMITS);
    expect(
      Object.keys(boundedPptx.entries).some((name) => name.startsWith("ppt/media/")),
    ).toBe(true);
  });

  it("accepts transparent zero padding around a fixed-size Office transport", async () => {
    const packageBytes = zipSync({ "word/document.xml": strToU8("<w:document />") });
    const padded = new Uint8Array(packageBytes.byteLength + 80_000);
    padded.set(packageBytes);
    const bounded = await readBoundedArchive(padded, OFFICE_ARCHIVE_LIMITS);
    expect(bounded.entries["word/document.xml"]).toBeDefined();
    expect(bounded.bytes.byteLength).toBeLessThan(padded.byteLength);
  });

  it("extracts text from a small generated PDF within the input guard", async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF();
    pdf.text("bounded PDF fixture", 20, 20);
    const bytes = new Uint8Array(pdf.output("arraybuffer"));
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const document = await loadingTask.promise;
    const page = await document.getPage(1);
    const text = await page.getTextContent();
    expect(text.items.map((item) => ("str" in item ? item.str : "")).join(" ")).toContain(
      "bounded PDF fixture",
    );
    await document.cleanup();
  });
});
