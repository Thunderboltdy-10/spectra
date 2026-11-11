import { describe, expect, it } from "vitest";
import { documentFromMarkdown } from "../document";
import { lengthNote, requestedPages } from "../page-estimate";

/* F02: a one-page revision sheet ran to 1.69 pages and the reply still
   called it one page. The save result now says so plainly. */
describe("a length the student asked for (F02)", () => {
  it("reads the page count from the request", () => {
    expect(requestedPages("Make a one-page revision sheet on photosynthesis.")).toBe(1);
    expect(requestedPages("Write two pages on the causes of WW1")).toBe(2);
    expect(requestedPages("Fit it on one side please")).toBe(1);
    expect(requestedPages("Make a single page summary")).toBe(1);
    expect(requestedPages("Make a revision sheet on photosynthesis")).toBeNull();
    expect(requestedPages("Open the web page about cells")).toBeNull();
  });

  it("names the overrun, and is silent when it fits", () => {
    const paragraph = "Photosynthesis converts light energy into chemical energy in chloroplasts. ".repeat(12);
    const sections = Array.from({ length: 14 }, (_, index) => `## Part ${index + 1}\n\n${paragraph}`);
    const long = documentFromMarkdown(sections.join("\n\n"));
    const short = documentFromMarkdown(`## Core idea\n\n${paragraph}`);
    expect(lengthNote(long, "Make a one-page revision sheet")).toMatch(/asked for one page and this runs to about \d+\.\d pages/);
    expect(lengthNote(short, "Make a one-page revision sheet")).toBe("");
    expect(lengthNote(long, "Make a revision sheet")).toBe("");
  });
});
