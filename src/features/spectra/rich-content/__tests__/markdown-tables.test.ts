import { describe, expect, it } from "vitest";
import { parseSpectraRichContent } from "../markdown";

const table = (source: string) => {
  const block = parseSpectraRichContent(source).blocks.find((candidate) => candidate.type === "table");
  if (!block || block.type !== "table") throw new Error("no table");
  return block;
};

describe("markdown tables", () => {
  it("keeps a citation with a pipe in its cell", () => {
    const block = table(["| Name | Fact |", "| --- | --- |", "| Etna | Very active. [[cite:web-1|Smithsonian GVP]] |"].join("\n"));
    expect(block.rows.map((row) => row.length)).toEqual([2, 2]);
    expect(JSON.stringify(block.rows[1]![1])).toContain("Smithsonian GVP");
  });

  it("gives every row the table's width", () => {
    const block = table(["| A | B | C |", "| - | - | - |", "| 1 |", "| 1 | 2 | 3 | 4 |"].join("\n"));
    expect(block.rows.map((row) => row.length)).toEqual([4, 4, 4]);
  });
});
