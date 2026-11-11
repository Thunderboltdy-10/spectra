import { describe, expect, it } from "vitest";
import { applyDocumentEdits } from "../document";
import { authorEdit } from "..";
import { healLatexEscapes } from "../locate";
import { documentFromMarkdown } from "../document";

describe("finding where a document edit lands", () => {
  const base = "# Title\n\nThe **quick** brown fox\njumps over.\n\nA second paragraph that goes on for a while and then ends here.\n\n- one\n- two";

  it("replaces a passage from its first words to its last", () => {
    const text = applyDocumentEdits(base, [{ op: "replace", from: "A second", to: "ends here.", replace: "Shorter." }]);
    expect(text).toContain("Shorter.");
    expect(text).not.toContain("goes on");
  });

  it("deletes when no replacement is given", () => {
    const text = applyDocumentEdits(base, [{ op: "replace", from: "A second", to: "ends here." }]);
    expect(text).not.toContain("second");
    expect(text).not.toContain("undefined");
  });

  it("finds a quote that dropped marks or joined lines, and leaves no mark dangling", () => {
    const text = applyDocumentEdits(base, [{ op: "replace", find: "The quick brown fox jumps over.", replace: "New line." }]);
    expect(text).toContain("New line.");
    expect(text).not.toContain("**");
  });

  it("takes whole marks when a range cuts through them", () => {
    const text = applyDocumentEdits("**Start** middle **end** tail", [{ op: "replace", from: "Start", to: "end", replace: "X" }]);
    expect(text).toBe("X tail");
  });

  it("finds typographic quotes and dashes", () => {
    const text = applyDocumentEdits("It\u2019s \u201Cfine\u201D \u2014 really", [{ op: "replace", find: `It's "fine" - really`, replace: "Yes" }]);
    expect(text).toBe("Yes");
  });

  it("says what is closest when the text is not there", () => {
    expect(() => applyDocumentEdits(base, [{ op: "replace", find: "A second paragraph that went on", replace: "x" }])).toThrow(
      /The closest text is: "A second paragraph/,
    );
  });

  it("shows each place an ambiguous quote matches", () => {
    expect(() => applyDocumentEdits("alpha one\n\nalpha two", [{ op: "replace", find: "alpha", replace: "x" }])).toThrow(
      /appears 2 times \("alpha one/,
    );
  });

  it("inserts after any unique text, not only a heading", () => {
    const text = applyDocumentEdits(base, [{ op: "insert", after: "goes on for a while", markdown: "Inserted." }]);
    expect(text.indexOf("Inserted.")).toBeGreaterThan(text.indexOf("ends here."));
    expect(text.indexOf("Inserted.")).toBeLessThan(text.indexOf("- one"));
  });

  it("names an unknown anchor with the headings there are", () => {
    expect(() => applyDocumentEdits(base, [{ op: "insert", after: "Nowhere at all", markdown: "x" }])).toThrow(/Headings: "Title"/);
  });
});

describe("applying edits one at a time", () => {
  const before = documentFromMarkdown("# A\n\nfirst paragraph\n\nsecond paragraph");

  it("keeps the edits that work and names the one that did not", () => {
    const result = authorEdit("document", before, [
      { op: "replace", find: "first", replace: "1st" },
      { op: "replace", find: "absent", replace: "x" },
      { op: "replace", find: "second", replace: "2nd" },
    ], { timeZone: "UTC" });
    expect(JSON.stringify(result.content)).toContain("1st");
    expect(JSON.stringify(result.content)).toContain("2nd");
    expect(result.failures).toHaveLength(1);
    expect(result.failures![0]).toMatch(/^Edit 2 \(replace\)/);
  });

  it("throws when none of them work", () => {
    expect(() => authorEdit("document", before, [{ op: "replace", find: "absent", replace: "x" }], { timeZone: "UTC" })).toThrow(/Edit 1 \(replace\)/);
  });
});

describe("putting LaTeX back after JSON ate a backslash", () => {
  it("restores commands that became control characters", () => {
    expect(healLatexEscapes("$\frac{1}{2}$ and $\beta$")).toBe("$\\frac{1}{2}$ and $\\beta$");
    expect(healLatexEscapes("$a \times b$, $\rho$, $x \neq y$")).toBe("$a \\times b$, $\\rho$, $x \\neq y$");
  });
  it("leaves real line breaks alone", () => {
    const text = "Costs $5\nother things\tcost $6\nnext";
    expect(healLatexEscapes(text)).toBe(text);
  });
});
