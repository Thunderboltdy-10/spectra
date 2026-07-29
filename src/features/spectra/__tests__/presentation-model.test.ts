import { describe, expect, it } from "vitest";

import { createPresentationObject } from "../presentation/model";

describe("presentation object insertion", () => {
  it("cascades new layers so successive objects remain discoverable", () => {
    const first = createPresentationObject("text", 1);
    const second = createPresentationObject("text", 2);
    const third = createPresentationObject("shape", 3);

    expect([second.x, second.y]).toEqual([first.x + 22, first.y + 22]);
    expect([third.x, third.y]).toEqual([344, 224]);
  });
});
