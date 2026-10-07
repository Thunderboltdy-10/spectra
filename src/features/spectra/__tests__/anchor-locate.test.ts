// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  bestByExcerpt,
  cellRangeIn,
  CARD_NOUNS,
  excerptRuns,
  headingIn,
  itemForRegion,
  itemInPassage,
  lineOfExcerpt,
  ordinalIn,
  plainOfMarkup,
  regionOfResult,
  SLIDE_NOUNS,
  workRegionFrom,
} from "../anchors/locate";
import { sheetLandingFor } from "../anchors/sheet-region";
import { documentBlockFor } from "../anchors/document-region";

describe("reading a region", () => {
  it("bounds untrusted regions and accepts a bare locator", () => {
    expect(workRegionFrom(undefined)).toBeUndefined();
    expect(workRegionFrom({ id: "  " })).toBeUndefined();
    expect(workRegionFrom([{ id: "x" }])).toBeUndefined();
    expect(workRegionFrom("slide-3")).toEqual({ id: "slide-3" });
    expect(workRegionFrom({ id: "b1", label: "Heading: Cells", excerpt: "x".repeat(900), extra: 1 })).toEqual({
      id: "b1",
      label: "Heading: Cells",
      excerpt: "x".repeat(600),
    });
  });

  it("takes a semantic result's region, label and passage, and nothing from a result without one", () => {
    expect(
      regionOfResult({ anchor: { kind: "artifact", artifactId: "a", regionId: "s2", label: "Slide 2" }, location: "Slide 2: Results", snippet: "…the yield rose" }),
    ).toEqual({ id: "s2", label: "Slide 2: Results", excerpt: "…the yield rose" });
    expect(regionOfResult({ anchor: { kind: "artifact", artifactId: "a" }, snippet: "title match" })).toBeUndefined();
    expect(regionOfResult({ anchor: { kind: "thread", threadId: "t", messageId: "m" }, snippet: "hi" })).toBeUndefined();
  });

  it("reads positions, ranges and headings the way people and Spectra write them", () => {
    expect(ordinalIn("slide-3", SLIDE_NOUNS)).toBe(2);
    expect(ordinalIn("Slide 3: Results", SLIDE_NOUNS)).toBe(2);
    expect(ordinalIn("Card 1", CARD_NOUNS)).toBe(0);
    expect(ordinalIn("slide-0", SLIDE_NOUNS)).toBeNull();
    expect(ordinalIn("slideshow", SLIDE_NOUNS)).toBeNull();

    expect(cellRangeIn("B4")).toEqual({ start: { row: 3, column: 1 }, end: { row: 3, column: 1 } });
    expect(cellRangeIn("C9:A1")).toEqual({ start: { row: 0, column: 0 }, end: { row: 8, column: 2 } });
    expect(cellRangeIn("Budget A1:F40")).toMatchObject({ sheet: "Budget", end: { row: 39, column: 5 } });
    expect(cellRangeIn("'My sheet'!$B$2")).toMatchObject({ sheet: "My sheet", start: { row: 1, column: 1 } });
    expect(cellRangeIn("Methods")).toBeNull();

    expect(headingIn("Heading: Méthods…")).toBe("methods");
    expect(headingIn("x")).toBeNull();
  });

  it("finds the item a region names by id, then by position", () => {
    const slides = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
    expect(itemForRegion(slides, { id: "s2" }, SLIDE_NOUNS)?.id).toBe("s2");
    expect(itemForRegion(slides, { id: "gone", label: "Slide 3: End" }, SLIDE_NOUNS)?.id).toBe("s3");
    expect(itemForRegion(slides, { id: "slide-9" }, SLIDE_NOUNS)).toBeUndefined();
  });

  it("finds where a trimmed passage starts among packed items", () => {
    const cards = ["Mitosis makes two identical cells", "Meiosis makes four gametes with half the chromosomes", "ATP stores energy"];
    expect(excerptRuns("…  makes four gametes with half the chromosomes …")[0]).toBe("makes four gametes with half the chromosomes");
    expect(bestByExcerpt(cards, (card) => card, "…four gametes with half the chromosomes ATP stores…")).toBe(cards[1]);
    expect(itemInPassage(cards, 0, (card) => card, "ATP stores energy")).toBe(cards[2]);
    expect(itemInPassage(cards, 1, (card) => card, "nothing like this at all")).toBe(cards[1]);
    expect(itemInPassage(cards, 5, (card) => card, "ATP")).toBeUndefined();
    expect(plainOfMarkup("<p>Fish &amp; chips</p>")).toBe(" Fish & chips ");
  });

  it("finds the line a code passage starts on", () => {
    const source = "import x from 'y';\n\nfunction total(items) {\n  return items.reduce((sum, item) =>   sum + item.price, 0);\n}\n";
    expect(lineOfExcerpt(source, "…return items.reduce((sum, item) => sum + item.price, 0); }")).toBe(4);
    expect(lineOfExcerpt(source, "FUNCTION TOTAL(items) {")).toBe(3);
    expect(lineOfExcerpt(source, "nowhere to be found in this file")).toBeNull();
    expect(lineOfExcerpt(source, undefined)).toBeNull();
  });
});

describe("a region in a workbook", () => {
  const sheets = [
    { id: "s1", name: "Raw", cells: {} },
    {
      id: "s2",
      name: "Budget",
      rowIdentities: { "40": "row-identity-41" },
      cells: {
        A1: { value: "Item" },
        B1: { value: "Cost" },
        A5: { value: "Bus fare" },
        B5: { value: 12 },
        A6: { value: "Lunch" },
        B6: { value: 8 },
      },
    },
    { id: "s3", name: "Hidden", cells: {}, hidden: true },
  ];

  it("lands on the sheet and range a semantic label names, narrowed to the row the passage is in", () => {
    expect(sheetLandingFor(sheets, "s1", { id: "s2", label: "Budget A1:B6", excerpt: "Lunch · 8" })).toEqual({
      sheetId: "s2",
      range: { start: { row: 5, column: 0 }, end: { row: 5, column: 1 } },
    });
    expect(sheetLandingFor(sheets, "s1", { id: "s2", label: "Budget A1:B6" })?.range).toEqual({
      start: { row: 0, column: 0 },
      end: { row: 5, column: 1 },
    });
  });

  it("reads row regions, citations and plain ranges", () => {
    expect(sheetLandingFor(sheets, "s1", { id: "s2:row:5" })).toEqual({ sheetId: "s2", range: { start: { row: 4, column: 0 }, end: { row: 4, column: 0 } } });
    expect(sheetLandingFor(sheets, "s1", { id: "row-identity-41" })?.range.start.row).toBe(40);
    expect(sheetLandingFor(sheets, "s1", { id: "Budget!B5" })).toEqual({ sheetId: "s2", range: { start: { row: 4, column: 1 }, end: { row: 4, column: 1 } } });
    expect(sheetLandingFor(sheets, "s2", { id: "A1:C9" })?.sheetId).toBe("s2");
  });

  it("names nothing for a hidden sheet or another workbook's region", () => {
    expect(sheetLandingFor(sheets, "s1", { id: "s3" })).toBeNull();
    expect(sheetLandingFor(sheets, "s1", { id: "elsewhere" })).toBeNull();
    expect(sheetLandingFor(sheets, "s1", { id: "Missing!A1" })).toBeNull();
  });
});

describe("a region in a document", () => {
  function documentDom() {
    const dom = document.createElement("div");
    dom.innerHTML = [
      '<h2 data-block-id="b1">Methods</h2>',
      '<p data-block-id="b2">We heated the sample.</p>',
      '<p data-block-id="b3">The enzyme denatured above 60 degrees.</p>',
      '<ul data-block-id="b4"><li><p data-block-id="b4-1">Nested point</p></li></ul>',
      "<p>Untracked</p>",
    ].join("");
    return dom;
  }

  it("lands on the block the passage is in, starting from the region's block", () => {
    const dom = documentDom();
    expect(documentBlockFor(dom, { id: "b1" })?.textContent).toBe("Methods");
    expect(documentBlockFor(dom, { id: "b1", excerpt: "…enzyme denatured above 60 degrees" })?.getAttribute("data-block-id")).toBe("b3");
    expect(documentBlockFor(dom, { id: "b4-1" })?.textContent).toBe("Nested point");
    expect(documentBlockFor(dom, { id: "block-2" })?.getAttribute("data-block-id")).toBe("b2");
  });

  it("finds a heading a citation names, and nothing for an unknown place", () => {
    const dom = documentDom();
    expect(documentBlockFor(dom, { id: "Methods" })?.getAttribute("data-block-id")).toBe("b1");
    expect(documentBlockFor(dom, { id: "gone", label: "Heading: Meth…" })?.getAttribute("data-block-id")).toBe("b1");
    expect(documentBlockFor(dom, { id: "gone", label: "Heading: Results" })).toBeNull();
  });
});
