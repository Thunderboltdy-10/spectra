import { describe, expect, it } from "vitest";
import { authorNew, authorEdit } from "../authoring";

describe("a document the AI creates with a look", () => {
  it("carries the look's Word styles and keeps them through edits", () => {
    const created = authorNew("document", { markdown: "# Osmosis\n\nWater moves across a membrane.", look: "notes" }, { timeZone: "UTC" });
    const styles = (created.content as { styles?: { defaultStyleId: string; paragraph: Record<string, { fontFamily?: string }> } }).styles;
    expect(styles?.paragraph.Normal?.fontFamily).toBe("Calibri");
    expect(styles?.paragraph.Heading1).toBeDefined();
    const edited = authorEdit("document", created.content, [{ op: "replace", find: "Water moves", replace: "Water diffuses" }], { timeZone: "UTC" });
    expect((edited.content as { styles?: unknown }).styles).toEqual(styles);
  });

  it("refuses a look it does not have, and needs none", () => {
    expect(() => authorNew("document", { markdown: "Hi", look: "magazine" }, { timeZone: "UTC" })).toThrow(/essay/);
    expect((authorNew("document", { markdown: "Hi" }, { timeZone: "UTC" }).content as { styles?: unknown }).styles).toBeUndefined();
  });
});
