import { describe, expect, it } from "vitest";
import { MEMORY_CAPS, applyMemoryText, memorySlug } from "../memory-files";
import { parseReflection, worthReflecting } from "../../src/features/spectra/ai/harness/memory-reflection";

const about = "The about file";

describe("memory files", () => {
  it("adds a line once, however often it is told", () => {
    const first = applyMemoryText("", { add: "Studies at MIT." }, 100, about);
    expect(first).toEqual({ ok: true, text: "Studies at MIT." });
    expect(applyMemoryText("Studies at MIT.", { add: "studies at mit." }, 100, about)).toEqual({ ok: true, text: "Studies at MIT." });
    expect(applyMemoryText("Studies at MIT.", { add: "Likes maths." }, 100, about)).toEqual({ ok: true, text: "Studies at MIT.\nLikes maths." });
  });

  it("changes exact text, removes it when the replacement is empty, and refuses a guess", () => {
    expect(applyMemoryText("One\nTwo\nThree", { find: "Two\n", replace: "" }, 100, about)).toEqual({ ok: true, text: "One\nThree" });
    const missing = applyMemoryText("Likes short answers", { find: "Likes long answers", replace: "x" }, 100, about);
    expect(missing).toMatchObject({ ok: false });
    expect(!missing.ok && missing.message).toMatch(/closest line.*Likes short answers/);
    expect(applyMemoryText("aa aa", { find: "aa", replace: "b" }, 100, about)).toMatchObject({ ok: false, message: expect.stringMatching(/more than once/) });
  });

  it("refuses to grow past the cap and says what to do instead", () => {
    const result = applyMemoryText("x".repeat(MEMORY_CAPS.preferences), { add: "one more" }, MEMORY_CAPS.preferences, "The preferences file");
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/limit is 1600.*Rewrite it shorter/) });
    expect(applyMemoryText("x".repeat(50), { rewrite: "short" }, 10, about)).toEqual({ ok: true, text: "short" });
  });

  it("makes stable slugs", () => {
    expect(memorySlug("  MIT Interview — día 2 ")).toBe("mit-interview-dia-2");
  });
});

describe("reflection", () => {
  it("skips what cannot carry anything lasting", () => {
    expect(worthReflecting("ok thanks")).toBe(false);
    expect(worthReflecting("I'm applying to MIT next year")).toBe(true);
  });

  it("reads only well-formed changes, and nothing from a bad reply", () => {
    expect(parseReflection('```json\n{"changes":[{"file":"about","add":"Year 12."},{"file":"secrets","add":"x"}]}\n```')).toEqual([{ file: "about", add: "Year 12." }]);
    expect(parseReflection("No changes needed.")).toEqual([]);
    expect(parseReflection('{"changes": oops')).toEqual([]);
  });
});
