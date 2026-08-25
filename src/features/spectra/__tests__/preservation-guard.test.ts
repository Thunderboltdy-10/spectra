import { describe, expect, it } from "vitest";
import {
  assertPreservationKept,
  preservationViolations,
  PreservationViolationError,
} from "../commands/office/preservation-guard";
import { preservedRegionRefusal } from "../commands/registry";

/**
 * The last line of the preservation law, and the only one that does not take a
 * command's word for anything.
 *
 * Everything else in this area is a declaration: a binding names the regions it
 * writes, and the gate believes it. That is the right design — it makes a
 * control's honesty legible where the control is defined — but it means a lens
 * regression, a mis-declared `touches`, or a brand-new operation that rewrites
 * the wrong part all produce a payload that passes every check and quietly
 * changes a macro project. This runs on the bytes, on the one path a human edit
 * and an AI edit both take, so that class of bug cannot reach the Bridge.
 */
describe("native preservation guard", () => {
  const macroEntry = {
    feature: "macro",
    class: "PRESERVED",
    partName: "/xl/vbaProject.bin",
    readOnly: true,
  };

  it("refuses a write that changed a preserved part, in the words the bar uses", () => {
    const violations = preservationViolations({
      entries: [macroEntry],
      parts: [
        { name: "xl/workbook.xml", verdict: "different" },
        { name: "xl/vbaProject.bin", verdict: "different", note: "binary content differs" },
      ],
    });

    expect(violations).toEqual([
      {
        partName: "/xl/vbaProject.bin",
        feature: "macro",
        region: "macros",
        reason: preservedRegionRefusal("macros"),
      },
    ]);
    // The sentence is not written here. It is the same one a person reads on the
    // disabled control, because a promise kept in one surface and broken in the
    // other is not a promise.
    expect(violations[0]?.reason).toContain("macros");
    expect(() => assertPreservationKept({
      entries: [macroEntry],
      parts: [{ name: "xl/vbaProject.bin", verdict: "different" }],
    })).toThrow(PreservationViolationError);
  });

  it("allows a preserved XML part that was reserialized but says the same thing", () => {
    // `equivalent` is L1-equal: identical XML, different bytes. Preservation is a
    // promise about content, and holding it to byte equality would refuse every
    // save that reserializes the package.
    expect(preservationViolations({
      entries: [{ feature: "transitions", class: "PRESERVED", partName: "/ppt/slides/slide1.xml", readOnly: true }],
      parts: [{ name: "ppt/slides/slide1.xml", verdict: "equivalent" }],
    })).toEqual([]);

    // A binary part has no L1 form, so it can only be identical or different —
    // the exemption above cannot widen to macros, media or embedded objects.
    expect(preservationViolations({
      entries: [macroEntry],
      parts: [{ name: "xl/vbaProject.bin", verdict: "identical" }],
    })).toEqual([]);
  });

  it("lets a preserved part be removed with the thing that owned it", () => {
    // Deleting a slide orphans its notes part. Refusing that would make slide
    // removal impossible; what must never happen is a preserved part surviving
    // with different content, which the first test covers.
    expect(preservationViolations({
      entries: [{ feature: "notes", class: "PRESERVED", partName: "/ppt/notesSlides/notesSlide4.xml", readOnly: true }],
      parts: [{
        name: "ppt/notesSlides/notesSlide4.xml",
        verdict: "different",
        note: "only in expected package",
      }],
    })).toEqual([]);

    // And a newly added part is not a rewrite of a preserved one either.
    expect(preservationViolations({
      entries: [{ feature: "media", class: "PRESERVED", partName: "/ppt/media/image9.png", readOnly: true }],
      parts: [{ name: "ppt/media/image9.png", verdict: "different", note: "only in actual package" }],
    })).toEqual([]);
  });

  it("says nothing about parts no lens claimed, and matches with or without a leading slash", () => {
    // Editable parts change on every save. Flagging them would make the guard
    // useless and it would be turned off, which is the real risk.
    expect(preservationViolations({
      entries: [macroEntry],
      parts: [
        { name: "ppt/slides/slide1.xml", verdict: "different" },
        { name: "[Content_Types].xml", verdict: "different" },
      ],
    })).toEqual([]);

    // The lens writes "/xl/vbaProject.bin"; the archive stores it without the
    // slash. A guard that missed on that would silently pass everything.
    expect(preservationViolations({
      entries: [{ ...macroEntry, partName: "xl/vbaProject.bin" }],
      parts: [{ name: "/xl/vbaProject.bin", verdict: "different" }],
    })).toHaveLength(1);

    // An entry with no part behind it cannot be checked and must not throw.
    expect(preservationViolations({
      entries: [{ feature: "equations", class: "PRESERVED" }, {}],
      parts: [{ name: "word/document.xml", verdict: "different" }],
    })).toEqual([]);
  });

  it("reports every preserved part at once, so one save is not fixed four times", () => {
    let thrown: PreservationViolationError | undefined;
    try {
      assertPreservationKept({
        entries: [
          macroEntry,
          { feature: "pivot", class: "PRESERVED", partName: "/xl/pivotCache/pivotCacheDefinition1.xml", readOnly: true },
          { feature: "chart", class: "PRESERVED", partName: "/xl/charts/chart1.xml", readOnly: true },
        ],
        parts: [
          { name: "xl/vbaProject.bin", verdict: "different" },
          { name: "xl/pivotCache/pivotCacheDefinition1.xml", verdict: "different" },
          { name: "xl/charts/chart1.xml", verdict: "different" },
        ],
      });
    } catch (error) {
      thrown = error as PreservationViolationError;
    }
    expect(thrown?.violations).toHaveLength(3);
    expect(thrown?.message).toContain("NATIVE_PRESERVATION_VIOLATION");
    expect(thrown?.message).toContain("2 other preserved parts");
    expect(thrown?.message).toContain("/xl/charts/chart1.xml");
  });

  it("scopes an XML preservation claim to its declared element", () => {
    const entry = {
      feature: "conditional-formatting",
      class: "PRESERVED",
      partName: "/xl/worksheets/sheet1.xml",
      pathPattern: "conditionalFormatting",
      readOnly: true,
    };
    expect(
      preservationViolations({
        entries: [entry],
        parts: [
          {
            name: "xl/worksheets/sheet1.xml",
            verdict: "different",
            diffs: [{ path: "/x:worksheet/x:sheetData/x:row[1]/x:c[1]/x:v" }],
          },
        ],
      }),
    ).toEqual([]);
    expect(
      preservationViolations({
        entries: [entry],
        parts: [
          {
            name: "xl/worksheets/sheet1.xml",
            verdict: "different",
            diffs: [{ path: "/x:worksheet/x:conditionalFormatting[1]/x:cfRule" }],
          },
        ],
      }),
    ).toHaveLength(1);
  });
});
