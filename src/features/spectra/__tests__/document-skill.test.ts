import { describe, expect, it } from "vitest";
import { documentSkill } from "../artifacts/skills/document";

describe("document authoring guidance", () => {
  it("preserves every requested record below a labelled native table header", () => {
    expect(documentSkill.operations.join(" ")).toMatch(
      /native table, add a labelled header row before every requested data row/i,
    );
    expect(documentSkill.validation.join(" ")).toMatch(
      /every requested record remains present as a data row/i,
    );
  });
});
