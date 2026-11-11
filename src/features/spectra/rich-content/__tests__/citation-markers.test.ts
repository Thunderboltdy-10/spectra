import { describe, expect, it } from "vitest";
import { parseBlocks } from "../../ai/harness/authoring/markdown";
import { normalizeMath } from "../markdown";

describe("escaped citation markers", () => {
  it("stay text instead of becoming centred equations", () => {
    expect(normalizeMath("Text \\[1\\] more.")).toBe("Text [1] more.");
    const blocks = parseBlocks("Findings \\[1\\].\n\n\\[1\\] A source\n\n\\[2\\]");
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(JSON.stringify(blocks)).toContain("[1] A source");
  });

  it("leaves real display math alone", () => {
    const blocks = parseBlocks("\\[x^2 + 1\\]");
    expect(blocks[0]).toMatchObject({ type: "equation", attrs: { latex: "x^2 + 1" } });
  });
});
