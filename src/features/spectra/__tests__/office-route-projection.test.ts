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
});
