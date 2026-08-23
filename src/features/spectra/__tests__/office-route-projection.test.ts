import { describe, expect, it } from "vitest";
import { contentToPptx } from "@/app/api/spectra/lenses/office/route";

describe("Office lens route projection boundary", () => {
  it("keeps native presentation objects when content returns from Spectra", () => {
    const base = {
      slides: [{
        id: "slide-1",
        index: 0,
        title: "Native title",
        text: ["Native title", "Native body"],
        speakerNotes: "Native notes",
        notesPartName: "/ppt/notesSlides/notesSlide1.xml",
        objects: [{
          id: "slide-1:shape:3",
          type: "text" as const,
          x: 120,
          y: 280,
          width: 760,
          height: 130,
          rotation: 0,
          content: { text: "Native body", nativeShapeId: "3" },
          locked: false,
        }],
        hasTransition: true,
        hasTiming: false,
      }],
      nativeBinding: {
        version: 1 as const,
        format: "pptx" as const,
        profile: "strict-native" as const,
        macroEnabled: false,
        semanticDigest: "0".repeat(64),
      },
    };
    const result = contentToPptx({
      slides: [{
        id: "slide-1",
        title: "Native title",
        objects: [{
          id: "slide-1:shape:3",
          type: "text",
          content: { text: "Edited body", nativeShapeId: "3" },
        }],
      }],
    }, base);
    expect(result.slides[0]!.objects[0]!.content).toMatchObject({
      text: "Edited body",
      nativeShapeId: "3",
    });
    expect(result.slides[0]!.objects[0]!.x).toBe(120);
  });

  it("carries an edited speaker note across the boundary and keeps the old one otherwise", () => {
    const base = {
      slides: [{
        id: "slide-1",
        index: 0,
        title: "Native title",
        text: ["Native title"],
        speakerNotes: "Native notes",
        notesPartName: "/ppt/notesSlides/notesSlide1.xml",
        objects: [],
        hasTransition: false,
        hasTiming: false,
      }],
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

    const slide = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
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
            { id: "spectra-new-1", title: "Fresh", objects: [{ type: "text", content: { text: "Body" } }] },
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
      expect(result.slides[0]!.notesPartName).toBe("/ppt/notesSlides/notesSlide1.xml");
      expect(result.slides[0]!.layoutPartName).toBe("/ppt/slideLayouts/slideLayout2.xml");
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
