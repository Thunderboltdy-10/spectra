import { describe, expect, it } from "vitest";
import { documentSchema } from "@/features/spectra/editor/document-extensions";
import { applyDocumentEdits, documentFromMarkdown, documentToMarkdown } from "../document";
import { authorNew } from "../index";
import { parseBlocks, serializeBlocks, type PmNode } from "../markdown";
import { sequentialIdFactory } from "../shared";

/*
 * The Markdown the AI writes reaches every document feature a writer has in
 * the bar: table looks and column alignment, footnotes, page breaks, a
 * contents list, captions, alignment, colour and scripts. Each one reads back
 * the way it was written, so an edit keeps it.
 */

const FEATURES = [
  "# Enzyme activity {.center}",
  "",
  "[[toc]]",
  "",
  "## Method",
  "",
  "Water is H<sub>2</sub>O and the area is 4 m<sup>2</sup>.^[Measured with a calibrated ruler.] The <span style=\"color: #C00000\">red</span> line marks the optimum.",
  "",
  "| Temperature (°C) | Rate (s⁻¹) | Notes |",
  "| --- | :---: | ---: |",
  "| 20 | 0.12 | slow |",
  "| 40 | 0.31 | best |",
  "| 60 | 0.05 | denatured |",
  "{style=banded}",
  "",
  "Table 1: Rate of reaction at each temperature {.caption}",
  "",
  "[[page-break]]",
  "",
  "## Results",
  "",
  "The rate peaks near 40 °C. {.justify}",
].join("\n");

function doc(markdown: string) {
  return documentFromMarkdown(markdown, undefined, sequentialIdFactory()).tiptap as PmNode & { content: PmNode[] };
}

const find = (node: PmNode, type: string): PmNode[] =>
  node.type === type ? [node] : (node.content ?? []).flatMap((child) => find(child, type));

describe("document Markdown reaches every feature", () => {
  it("builds valid editor content for each feature", () => {
    const content = doc(FEATURES);
    expect(() => documentSchema().nodeFromJSON(content).check()).not.toThrow();

    const [title] = content.content;
    expect(title).toMatchObject({ type: "heading", attrs: { level: 1, textAlign: "center" } });
    expect(title!.content).toEqual([{ type: "text", text: "Enzyme activity" }]);

    // The contents list is built from the headings after it.
    expect(content.content[1]).toMatchObject({ type: "heading", content: [{ text: "Contents" }] });
    expect(content.content.slice(2, 4).map((node) => node.content?.[0]?.text)).toEqual(["Method", "Results"]);
    expect(content.content[2]!.attrs).toMatchObject({ indentLevel: 1 });

    const [note] = find(content, "footnote");
    expect(note!.attrs).toEqual({ text: "Measured with a calibrated ruler." });
    const marks = find(content, "text").flatMap((text) => text.marks ?? []);
    expect(marks).toContainEqual({ type: "subscript" });
    expect(marks).toContainEqual({ type: "superscript" });
    expect(marks).toContainEqual({ type: "textStyle", attrs: { color: "#C00000" } });

    const [table] = find(content, "table");
    expect(table!.attrs).toMatchObject({ lines: "horizontal", fillsSet: true });
    const rows = table!.content!;
    expect(rows.map((row) => row.content![0]!.attrs?.background ?? null)).toEqual(["#D9E2F3", null, "#F2F2F2", null]);
    expect(rows[1]!.content!.map((cell) => cell.content![0]!.attrs?.textAlign ?? null)).toEqual([null, "center", "right"]);

    expect(find(content, "pageBreak")).toHaveLength(1);
    const caption = content.content.find((node) => node.attrs?.blockStyle === "caption");
    expect(caption?.content?.[0]?.text).toBe("Table 1: Rate of reaction at each temperature");
    expect(content.content.at(-1)!.attrs).toMatchObject({ textAlign: "justify" });
  });

  it("reads each feature back as it was written", () => {
    const markdown = documentToMarkdown({ tiptap: doc(FEATURES) });
    expect(markdown).toContain("# Enzyme activity {.center}");
    expect(markdown).toContain("H<sub>2</sub>O");
    expect(markdown).toContain("m<sup>2</sup>.^[Measured with a calibrated ruler.]");
    expect(markdown).toContain('<span style="color: #C00000">red</span>');
    expect(markdown).toContain("| --- | :---: | ---: |\n| 20 | 0.12 | slow |");
    expect(markdown).toContain("| 60 | 0.05 | denatured |\n{style=banded}");
    expect(markdown).toContain("Table 1: Rate of reaction at each temperature {.caption}");
    expect(markdown).toContain("[[page-break]]");
    expect(markdown).toContain("The rate peaks near 40 °C. {.justify}");
    // Reading it back again changes nothing.
    expect(documentToMarkdown({ tiptap: doc(markdown) })).toBe(markdown);
  });

  it("takes footnotes written the GitHub way", () => {
    const [paragraph] = parseBlocks("Osmosis needs a membrane.[^1] Diffusion does not.[^b]\n\n[^1]: Partially permeable.\n[^b]: Any medium [see below].");
    expect(find(paragraph!, "footnote").map((note) => note.attrs?.text)).toEqual(["Partially permeable.", "Any medium [see below]."]);
  });

  it("writes table lines, colours and fills that match no ready-made look", () => {
    const [table] = parseBlocks("| A | B |\n| --- | --- |\n| 1 | 2 |\n{lines=outer line-color=#1f4e79 header-fill=#fff2cc}");
    expect(table!.attrs).toMatchObject({ lines: "outer", lineColor: "#1F4E79", fillsSet: true });
    expect(serializeBlocks([table!])).toContain("{lines=outer line-color=#1F4E79 header-fill=#FFF2CC}");
  });

  it("keeps literal braces, carets and angle brackets as text", () => {
    const source = "A set {.x} stays, 2^[3] is maths-like text and <sup> is a tag name.";
    const [paragraph] = parseBlocks(serializeBlocks(parseBlocks(source.replace(/[\^<]/g, "\\$&"))));
    expect(find(paragraph!, "text").map((text) => text.text).join("")).toBe(source);
  });

  it("leaves a rewritten block left-aligned when its {.center} goes", () => {
    const before = documentFromMarkdown("Centred words. {.center}\n\nMore.", undefined, sequentialIdFactory());
    const after = documentFromMarkdown(
      applyDocumentEdits(documentToMarkdown(before), [{ op: "replace", find: "Centred words. {.center}", replace: "Plain words." }]),
      before,
      sequentialIdFactory(),
    );
    const first = (after.tiptap as PmNode).content![0]!;
    expect(first.content?.[0]?.text).toBe("Plain words.");
    expect(first.attrs?.textAlign ?? null).toBeNull();
  });

  it("captions in the Caption style of a document created with a look", () => {
    const created = authorNew("document", { markdown: "Figure 1: The apparatus {.caption}", look: "essay" }, { timeZone: "UTC", ids: sequentialIdFactory() });
    const [caption] = (created.content.tiptap as PmNode).content!;
    expect(caption!.attrs).toMatchObject({ styleId: "Caption", blockStyle: null });
    expect(documentToMarkdown(created.content)).toBe("Figure 1: The apparatus {.caption}");
  });
});
