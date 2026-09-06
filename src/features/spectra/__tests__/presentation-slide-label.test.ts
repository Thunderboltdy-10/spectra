import { describe, expect, it } from "vitest";
import {
  createPresentationSlide,
  presentationSlideLabel,
  withPresentationObjectText,
} from "../presentation/model";

describe("presentationSlideLabel", () => {
  it("prefers canvas text over generic Slide N titles", () => {
    const slide = createPresentationSlide(2);
    const textObject = slide.objects.find((object) => object.type === "text");
    expect(textObject).toBeTruthy();
    Object.assign(
      textObject!,
      withPresentationObjectText(textObject!, "QA07-slide"),
    );
    expect(presentationSlideLabel(slide, 1)).toBe("QA07-slide");
  });

  it("falls back to Slide N when copy is generic", () => {
    const slide = createPresentationSlide(1);
    expect(presentationSlideLabel(slide, 0)).toBe("Slide 1");
  });
});
