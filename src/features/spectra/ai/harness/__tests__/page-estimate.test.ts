import { describe, expect, it } from "vitest";
import { documentFromMarkdown, documentReadback } from "../authoring/document";
import { estimateDocumentPages, pagesNote } from "../authoring/page-estimate";

const sentence = "The mitochondria convert nutrients into usable energy for the cell through respiration. ";
const prose = (words: number) => sentence.repeat(Math.ceil(words / 12)).trim();
const doc = (markdown: string, pageSetup?: Record<string, unknown>) => ({ ...documentFromMarkdown(markdown), ...(pageSetup ? { pageSetup } : {}) });

describe("how many pages a document fills", () => {
  it("puts a short sheet on one page", () => {
    const sheet = doc(`# Cell biology\n\n${prose(120)}\n\n## Questions\n\n1. What is respiration?\n2. Where does it happen?`);
    expect(estimateDocumentPages(sheet)).toBeLessThan(1);
    expect(pagesNote(sheet)).toBe("About 1 page.");
  });

  it("fills an A4 sheet with about 430 words of prose and carries whole blocks over", () => {
    const pages = (count: number) => estimateDocumentPages(doc(Array.from({ length: count }, () => prose(60)).join("\n\n")));
    // Five 65-word paragraphs fit one sheet; the eighth is well onto the second.
    expect(pages(5)).toBeLessThan(1);
    expect(pages(8)).toBeGreaterThan(1.3);
    expect(pages(8)).toBeLessThan(1.7);
  });

  it("counts a worksheet of short lines and answer space by its blocks, not its words", () => {
    const worksheet = doc(
      ["# Worksheet", ...Array.from({ length: 30 }, (_, index) => `${index + 1}. Define term ${index + 1}.\n\n_______________`)].join("\n\n"),
    );
    expect(estimateDocumentPages(worksheet)).toBeGreaterThan(1.5);
    expect(pagesNote(worksheet)).toMatch(/^About [2-4] pages/);
  });

  it("follows the paper, margins and page breaks", () => {
    const markdown = Array.from({ length: 6 }, () => prose(60)).join("\n\n");
    expect(estimateDocumentPages(doc(markdown, { size: "a5" }))).toBeGreaterThan(estimateDocumentPages(doc(markdown)));
    expect(estimateDocumentPages(doc(markdown, { margins: "narrow" }))).toBeLessThan(estimateDocumentPages(doc(markdown)));
  });

  it("leads the save readback", () => {
    expect(documentReadback(doc(`# Notes\n\n${prose(40)}`))).toMatch(/^About 1 page\. \d+ blocks/);
  });
});
