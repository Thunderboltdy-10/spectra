import { describe, expect, it } from "vitest";
import { plainTextFromStored } from "../rich-content/adapters";

/* F07: Runs showed "Created **Live verification biology notes** with…". */
describe("a run summary in plain words (F07)", () => {
  it("takes Markdown marks off", () => {
    expect(plainTextFromStored("Created **Live verification biology notes** with exactly those two sentences.")).toBe(
      "Created Live verification biology notes with exactly those two sentences.",
    );
  });
});
