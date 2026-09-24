import { describe, expect, it } from "vitest";
import {
  assertExplicitParagraphLiteralPresent,
  explicitParagraphLiteral,
} from "../../../../shared/explicit-document-content";

describe("explicit paragraph text guard", () => {
  const prompt =
    "Append exactly one plain-text paragraph to the end of this document: S9-OFFICE native write acceptance marker 2026-09-23-1. Preserve every existing comment, tracked change, citation, footnote, and paragraph. Do not edit another artifact.";

  it("extracts the literal paragraph from a preservation request", () => {
    expect(explicitParagraphLiteral(prompt)).toBe(
      "S9-OFFICE native write acceptance marker 2026-09-23-1",
    );
  });

  it("rejects an empty appended block before the mutation can run", () => {
    expect(() =>
      assertExplicitParagraphLiteralPresent(prompt, {
        changes: [
          {
            path: "/blocks/-",
            value: { id: "new-paragraph", type: "paragraph", text: "" },
          },
        ],
      }),
    ).toThrow("omitted the exact paragraph text requested");
  });

  it("accepts the exact text in a new block", () => {
    expect(() =>
      assertExplicitParagraphLiteralPresent(prompt, {
        changes: [
          {
            path: "/blocks/-",
            value: {
              id: "new-paragraph",
              type: "paragraph",
              text: "S9-OFFICE native write acceptance marker 2026-09-23-1",
            },
          },
        ],
      }),
    ).not.toThrow();
  });

  it("does not impose literal matching on ordinary paragraph requests", () => {
    expect(() =>
      assertExplicitParagraphLiteralPresent(
        "Add a short concluding paragraph about the experiment.",
        { changes: [] },
      ),
    ).not.toThrow();
  });
});
