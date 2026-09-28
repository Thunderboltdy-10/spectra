import { describe, expect, it } from "vitest";
import { POST, officeLensErrorCode } from "@/app/api/spectra/lenses/office/route";
import {
  pptxProjectionFromContent as contentToPptx,
  pptxProjectionUpdateFromContent,
  xlsxProjectionUpdateFromContent,
} from "../lenses/office-content";
import { hasUnreconciledExternalRevision, shouldActivateExternalNativeRevision } from "../lenses/native-reconciliation";
import { sniffOfficeRasterMedia } from "../lenses/office-media";
import { XlsxLensError } from "../lenses/xlsx-lens";

const NATIVE_EXCEL_FILL = "#1F4E78";

describe("Office lens route projection boundary", () => {
  it("returns the Office error envelope when parsing fails before format detection", async () => {
    const response = await POST(
      new Request("http://localhost/api/spectra/lenses/office", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "OFFICE_LENS_FAILED",
    });
  });

  it("surfaces coded lens refusals instead of collapsing them", () => {
    expect(
      officeLensErrorCode(
        new XlsxLensError(
          "XLSX_FORMULA_LITERALIZATION_BLOCKED",
          "A formula cell cannot be replaced by a literal through a value edit.",
        ),
      ),
    ).toBe("XLSX_FORMULA_LITERALIZATION_BLOCKED");
    expect(officeLensErrorCode(new Error("expected array"))).toBe(
      "OFFICE_LENS_FAILED",
    );
  });

  it("sniffs JPEG bytes even when Office labelled the part as PNG", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    expect(sniffOfficeRasterMedia(jpeg)).toBe("image/jpeg");
    expect(sniffOfficeRasterMedia(png)).toBe("image/png");
    expect(sniffOfficeRasterMedia(Uint8Array.from([0x00, 0x01]))).toBeUndefined();
  });

  it("does not reconcile an external operation after it is verified", () => {
    const operation = {
      direction: "external",
      actorKind: "external-edit",
      revisionAfter: "revision-a",
    };

    expect(
      hasUnreconciledExternalRevision(
        [{ ...operation, state: "verified" }],
        "revision-a",
      ),
    ).toBe(false);
    expect(
      hasUnreconciledExternalRevision(
        [{ ...operation, state: "applied" }],
        "revision-a",
      ),
    ).toBe(true);
  });

  it("does not treat a queued Spectra write as an external Word save", () => {
    const queued = {
      direction: "cloud-to-local",
      state: "pending",
    };
    expect(
      shouldActivateExternalNativeRevision({
        operations: [queued],
        localHash: "disk",
        cloudHash: "spectra",
      }),
    ).toBe(false);
    expect(
      shouldActivateExternalNativeRevision({
        operations: [
          {
            direction: "external",
            actorKind: "external-edit",
            revisionAfter: "disk",
            state: "applied",
          },
        ],
        localHash: "disk",
        cloudHash: "spectra",
      }),
    ).toBe(true);
  });

  it("uses the native projection before an Office artifact has semantic content", () => {
    const binding = {
      version: 1 as const,
      profile: "strict-native" as const,
      macroEnabled: false,
      semanticDigest: "0".repeat(64),
    };
    const workbook = {
      sheets: [{ id: "xlsx:sheet:1", name: "Sheet1", cells: [], merges: [] }],
      definedNames: [],
      nativeBinding: {
        ...binding,
        format: "xlsx" as const,
        recognizedFormulaFunctions: [],
      },
    };
    const deck = {
      slides: [],
      nativeBinding: { ...binding, format: "pptx" as const },
    };

    expect(xlsxProjectionUpdateFromContent(null, workbook)).toEqual({
      projection: workbook,
      operations: [],
    });
    expect(pptxProjectionUpdateFromContent(null, deck)).toEqual({
      projection: deck,
      operations: [],
    });
  });

  it("keeps native presentation objects when content returns from Spectra", () => {
    const base = {
      slides: [
        {
          id: "slide-1",
          index: 0,
          title: "Native title",
          text: ["Native title", "Native body"],
          speakerNotes: "Native notes",
          notesPartName: "/ppt/notesSlides/notesSlide1.xml",
          objects: [
            {
              id: "slide-1:shape:3",
              type: "text" as const,
              x: 120,
              y: 280,
              width: 760,
              height: 130,
              rotation: 0,
              content: { text: "Native body", nativeShapeId: "3" },
              locked: false,
            },
          ],
          hasTransition: true,
          hasTiming: false,
        },
      ],
      nativeBinding: {
        version: 1 as const,
        format: "pptx" as const,
        profile: "strict-native" as const,
        macroEnabled: false,
        semanticDigest: "0".repeat(64),
      },
    };
    const result = contentToPptx(
      {
        slides: [
          {
            id: "slide-1",
            title: "Native title",
            objects: [
              {
                id: "slide-1:shape:3",
                type: "text",
                content: { text: "Edited body", nativeShapeId: "3" },
              },
            ],
          },
        ],
      },
      base,
    );
    expect(result.slides[0]!.objects[0]!.content).toMatchObject({
      text: "Edited body",
      nativeShapeId: "3",
    });
    expect(result.slides[0]!.objects[0]!.x).toBe(120);
  });

  it("carries an edited speaker note across the boundary and keeps the old one otherwise", () => {
    const base = {
      slides: [
        {
          id: "slide-1",
          index: 0,
          title: "Native title",
          text: ["Native title"],
          speakerNotes: "Native notes",
          notesPartName: "/ppt/notesSlides/notesSlide1.xml",
          objects: [],
          hasTransition: false,
          hasTiming: false,
        },
      ],
      nativeBinding: {
        version: 1 as const,
        format: "pptx" as const,
        profile: "strict-native" as const,
        macroEnabled: false,
        semanticDigest: "0".repeat(64),
      },
    };
    const edited = contentToPptx(
      { slides: [{ id: "slide-1", speakerNotes: "Open on the number." }] },
      base,
    );
    expect(edited.slides[0]!.speakerNotes).toBe("Open on the number.");
    // A slide the editor did not touch keeps the note the file already had, so a
    // save never silently empties a notes part.
    const untouched = contentToPptx({ slides: [{ id: "slide-1" }] }, base);
    expect(untouched.slides[0]!.speakerNotes).toBe("Native notes");
  });

  it("keeps a new object on an existing slide instead of rebuilding from native objects", () => {
    const base = {
      slides: [
        {
          id: "slide-1",
          index: 0,
          title: "Native title",
          text: ["Native title"],
          speakerNotes: "",
          objects: [],
          hasTransition: false,
          hasTiming: false,
        },
      ],
      nativeBinding: {
        version: 1 as const,
        format: "pptx" as const,
        profile: "strict-native" as const,
        macroEnabled: false,
        semanticDigest: "0".repeat(64),
      },
    };
    const result = contentToPptx(
      {
        slides: [
          {
            id: "slide-1",
            objects: [
              {
                id: "spectra-added",
                type: "text",
                x: 210,
                y: 120,
                width: 400,
                height: 90,
                rotation: 0,
                content: { text: "New object" },
              },
            ],
          },
        ],
      },
      base,
    );
    expect(result.slides[0]!.objects).toHaveLength(1);
    expect(result.slides[0]!.objects[0]).toMatchObject({
      id: "spectra-added",
      x: 210,
      content: { text: "New object" },
    });
  });

  it("derives typed native operations at the route boundary", () => {
    const xlsxBase = {
      sheets: [
        {
          id: "xlsx:sheet:1",
          name: "Sheet1",
          cells: [{ id: "xlsx:1:A1", ref: "A1", value: "Delete me" }],
          merges: [] as string[],
        },
      ],
      definedNames: [],
      nativeBinding: {
        version: 1 as const,
        format: "xlsx" as const,
        profile: "strict-native" as const,
        macroEnabled: false,
        semanticDigest: "0".repeat(64),
        recognizedFormulaFunctions: [],
      },
    };
    expect(
      xlsxProjectionUpdateFromContent(
        { sheets: [{ id: "xlsx:sheet:1", cells: {} }] },
        xlsxBase,
      ).operations,
    ).toEqual([{ kind: "clear-cell", sheetId: "xlsx:sheet:1", ref: "A1" }]);

    const pptxBase = {
      slides: [
        {
          id: "slide-1",
          index: 0,
          title: "One",
          text: ["One"],
          objects: [],
          hasTransition: false,
          hasTiming: false,
          speakerNotes: "",
        },
      ],
      nativeBinding: {
        version: 1 as const,
        format: "pptx" as const,
        profile: "strict-native" as const,
        macroEnabled: false,
        semanticDigest: "0".repeat(64),
      },
    };
    expect(
      pptxProjectionUpdateFromContent(
        {
          slides: [
            {
              id: "slide-1",
              objects: [
                {
                  id: "new-text",
                  type: "text",
                  x: 100,
                  y: 100,
                  width: 300,
                  height: 80,
                  rotation: 0,
                  content: { text: "Added" },
                },
              ],
            },
          ],
        },
        pptxBase,
      ).operations,
    ).toEqual([{ kind: "add-text-box", slideId: "slide-1", text: "Added" }]);
  });

  it("treats absent and explicit zero freeze panes as the same native state", () => {
    const base = {
      sheets: [
        {
          id: "xlsx:sheet:1",
          name: "Sheet1",
          cells: [],
          merges: [] as string[],
        },
      ],
      definedNames: [],
      nativeBinding: {
        version: 1 as const,
        format: "xlsx" as const,
        profile: "strict-native" as const,
        macroEnabled: false,
        semanticDigest: "0".repeat(64),
        recognizedFormulaFunctions: [],
      },
    };
    const editor = {
      sheets: [
        {
          id: "xlsx:sheet:1",
          cells: {},
          frozenRows: 0,
          frozenColumns: 0,
        },
      ],
    };

    expect(xlsxProjectionUpdateFromContent(editor, base).operations).toEqual(
      [],
    );
    expect(
      xlsxProjectionUpdateFromContent(editor, {
        ...base,
        sheets: [
          { ...base.sheets[0]!, frozenRows: 2, frozenColumns: 1 },
        ],
      }).operations,
    ).toEqual([
      {
        kind: "set-freeze-panes",
        sheetId: "xlsx:sheet:1",
        rows: 0,
        columns: 0,
      },
    ]);
  });

  it("does not treat editor format defaults as a native format write", () => {
    const base = {
      sheets: [
        {
          id: "xlsx:sheet:1",
          name: "Sheet1",
          cells: [
            {
              id: "xlsx:1:B1",
              ref: "B1",
              value: "RCV1XLSXRUN3",
              format: { fontSize: 14, fillColor: NATIVE_EXCEL_FILL },
            },
          ],
          merges: [] as string[],
        },
      ],
      definedNames: [],
      nativeBinding: {
        version: 1 as const,
        format: "xlsx" as const,
        profile: "strict-native" as const,
        macroEnabled: false,
        semanticDigest: "0".repeat(64),
        recognizedFormulaFunctions: [],
      },
    };
    const editor = {
      sheets: [
        {
          id: "xlsx:sheet:1",
          cells: {
            B1: {
              value: "RCV1XLSXRUN3",
              format: {
                bold: false,
                italic: false,
                underline: false,
                strike: false,
                fontFamily: "sans",
                fillColor: NATIVE_EXCEL_FILL,
                align: "general",
                verticalAlign: "bottom",
                wrap: false,
                rotation: 0,
                indent: 0,
                numberFormat: "general",
                fontSize: 14,
              },
            },
            Z1: { value: "P8V1-T0-WRITE" },
          },
        },
      ],
    };

    expect(xlsxProjectionUpdateFromContent(editor, base).operations).toEqual([
      {
        kind: "set-cell",
        sheetId: "xlsx:sheet:1",
        ref: "Z1",
        value: "P8V1-T0-WRITE",
      },
    ]);
  });

  /**
   * The three slide-level promotions the lens performs natively — add, remove and
   * reorder — are only real if they survive this boundary. While the projection
   * was rebuilt from `base.slides`, the lens wrote them correctly, the harness
   * proved them, and a person still saw nothing change: identity and order were
   * pinned on the way back. These cases pin the boundary instead.
   */
  describe("slide-level promotions crossing the boundary", () => {
    const nativeBinding = {
      version: 1 as const,
      format: "pptx" as const,
      profile: "strict-native" as const,
      macroEnabled: false,
      semanticDigest: "0".repeat(64),
    };

    const slide = (
      id: string,
      title: string,
      extra: Record<string, unknown> = {},
    ) => ({
      id,
      index: 0,
      title,
      text: [title],
      speakerNotes: "",
      objects: [],
      hasTransition: false,
      hasTiming: false,
      ...extra,
    });

    const base = {
      slides: [
        slide("pptx:slide:/ppt/slides/slide1.xml", "One", {
          hasTransition: true,
          hasTiming: true,
          notesPartName: "/ppt/notesSlides/notesSlide1.xml",
          speakerNotes: "First note",
          layoutPartName: "/ppt/slideLayouts/slideLayout2.xml",
        }),
        slide("pptx:slide:/ppt/slides/slide2.xml", "Two"),
        slide("pptx:slide:/ppt/slides/slide3.xml", "Three"),
      ],
      nativeBinding,
    };

    it("lets a new slide through as a new slide, claiming nothing preserved", () => {
      const result = contentToPptx(
        {
          slides: [
            { id: "pptx:slide:/ppt/slides/slide1.xml" },
            {
              id: "spectra-new-1",
              title: "Fresh",
              objects: [{ type: "text", content: { text: "Body" } }],
            },
            { id: "pptx:slide:/ppt/slides/slide2.xml" },
            { id: "pptx:slide:/ppt/slides/slide3.xml" },
          ],
        },
        base,
      );
      expect(result.slides).toHaveLength(4);
      const born = result.slides[1]!;
      expect(born.id).toBe("spectra-new-1");
      expect(born.title).toBe("Fresh");
      expect(born.text).toEqual(["Body"]);
      // A slide Spectra has just made has no PowerPoint part behind it, so it
      // must not claim a transition, timing or a notes page it cannot have.
      expect(born.hasTransition).toBe(false);
      expect(born.hasTiming).toBe(false);
      expect(born.notesPartName).toBeUndefined();
      // The existing slide beside it keeps everything the file had on it.
      expect(result.slides[0]!.hasTransition).toBe(true);
      expect(result.slides[0]!.notesPartName).toBe(
        "/ppt/notesSlides/notesSlide1.xml",
      );
      expect(result.slides[0]!.layoutPartName).toBe(
        "/ppt/slideLayouts/slideLayout2.xml",
      );
      // Index follows the new position, so the lens reorders to match.
      expect(result.slides.map((row) => row.index)).toEqual([0, 1, 2, 3]);
    });

    it("drops a slide the editor removed so a native delete reaches the file", () => {
      const result = contentToPptx(
        {
          slides: [
            { id: "pptx:slide:/ppt/slides/slide1.xml" },
            { id: "pptx:slide:/ppt/slides/slide3.xml" },
          ],
        },
        base,
      );
      expect(result.slides.map((row) => row.id)).toEqual([
        "pptx:slide:/ppt/slides/slide1.xml",
        "pptx:slide:/ppt/slides/slide3.xml",
      ]);
      expect(result.slides.map((row) => row.index)).toEqual([0, 1]);
    });

    it("carries a reorder without disturbing what each slide preserves", () => {
      const result = contentToPptx(
        {
          slides: [
            { id: "pptx:slide:/ppt/slides/slide3.xml" },
            { id: "pptx:slide:/ppt/slides/slide1.xml" },
            { id: "pptx:slide:/ppt/slides/slide2.xml" },
          ],
        },
        base,
      );
      expect(result.slides.map((row) => row.id)).toEqual([
        "pptx:slide:/ppt/slides/slide3.xml",
        "pptx:slide:/ppt/slides/slide1.xml",
        "pptx:slide:/ppt/slides/slide2.xml",
      ]);
      expect(result.slides.map((row) => row.index)).toEqual([0, 1, 2]);
      // Moving a slide is a deck-level fact. What the slide carries is not part
      // of it, so the transition, the timing and the note travel with the slide.
      const moved = result.slides[1]!;
      expect(moved.hasTransition).toBe(true);
      expect(moved.hasTiming).toBe(true);
      expect(moved.speakerNotes).toBe("First note");
    });

    it("treats an empty slide list as a truncated payload, not as erase the deck", () => {
      // PowerPoint cannot hold a zero-slide deck, so there is no honest reading
      // of an empty list as a request. Returning the base is the only outcome
      // that cannot destroy someone's work on a dropped or partial payload.
      const result = contentToPptx({ slides: [] }, base);
      expect(result).toBe(base);
      expect(result.slides).toHaveLength(3);
    });
  });
});
