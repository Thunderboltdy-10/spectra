import { describe, expect, it } from "vitest";
import {
  applyDocumentEdits,
  documentFromMarkdown,
  documentReadback,
  documentToMarkdown,
} from "../document";
import { parseBlocks, serializeBlocks } from "../markdown";
import { sequentialIdFactory } from "../shared";
import { documentContentSchema } from "@/features/spectra/artifacts/schema/document";

const SAMPLE = [
  "# Photosynthesis",
  "",
  "Plants turn **light** into *chemical* energy with ~~magic~~ ==chlorophyll==, see [notes](https://example.com).",
  "",
  "## Inputs",
  "",
  "- Carbon dioxide",
  "- Water",
  "  - from the roots",
  "- Light",
  "",
  "1. Absorb light",
  "2. Split water",
  "",
  "- [ ] Revise the equation",
  "- [x] Read chapter 4",
  "",
  "> [!tip] Remember the word equation.",
  "",
  "> Quote from the textbook.",
  "",
  "$$",
  "6CO_2 + 6H_2O \rightarrow C_6H_{12}O_6 + 6O_2",
  "$$",
  "",
  "Inline $E = mc^2$ works too, and `code` as well.",
  "",
  "```python",
  "print('hi')",
  "```",
  "",
  "| Input | Source |",
  "| --- | --- |",
  "| Water | Roots |",
  "| CO2 | Air |",
  "",
  "---",
  "",
  "## Outputs",
  "",
  "Glucose and oxygen.",
].join("\n");

describe("document Markdown", () => {
  it("parses every supported construct into editor nodes", () => {
    const types = parseBlocks(SAMPLE).map((node) => node.type);
    expect(types).toEqual([
      "heading",
      "paragraph",
      "heading",
      "bulletList",
      "orderedList",
      "taskList",
      "callout",
      "blockquote",
      "equation",
      "paragraph",
      "codeBlock",
      "table",
      "horizontalRule",
      "heading",
      "paragraph",
    ]);
    const paragraph = parseBlocks(SAMPLE)[1]!;
    const marks = (paragraph.content ?? []).flatMap((node) => (node.marks ?? []).map((mark) => mark.type));
    expect(marks).toEqual(expect.arrayContaining(["bold", "italic", "strike", "highlight", "link"]));
    const nested = parseBlocks(SAMPLE)[3]!.content![1]!;
    expect(nested.content!.map((node) => node.type)).toEqual(["paragraph", "bulletList"]);
  });

  it("round-trips Markdown without drift", () => {
    const once = serializeBlocks(parseBlocks(SAMPLE));
    const twice = serializeBlocks(parseBlocks(once));
    expect(twice).toBe(once);
    expect(once).toContain("- [x] Read chapter 4");
    expect(once).toContain("> [!tip] Remember the word equation.");
    expect(once).toContain("| Water | Roots |");
  });

  it("builds valid document content with blocks and an outline", () => {
    const content = documentFromMarkdown(SAMPLE, undefined, sequentialIdFactory());
    expect(documentContentSchema.safeParse(content).success).toBe(true);
    expect(content.outline.map((entry) => entry.title)).toEqual(["Photosynthesis", "Inputs", "Outputs"]);
    expect(content.blocks[0]).toMatchObject({ type: "heading", text: "Photosynthesis" });
    expect(documentToMarkdown(content)).toBe(serializeBlocks(parseBlocks(SAMPLE)));
  });

  it("keeps untouched nodes, ids and unknown formatting through an edit", () => {
    const content = documentFromMarkdown(SAMPLE, undefined, sequentialIdFactory());
    // Formatting Markdown cannot express, on an untouched block.
    const outputs = content.tiptap.content.at(-1)!;
    outputs.content = [{ type: "text", text: "Glucose and oxygen.", marks: [{ type: "textStyle", attrs: { color: "var(--danger)" } }] }];
    const edited = applyDocumentEdits(documentToMarkdown(content), [
      { op: "replace", find: "Split water", replace: "Split water molecules" },
    ]);
    const next = documentFromMarkdown(edited, content, sequentialIdFactory());
    const ids = (nodes: Array<{ attrs?: Record<string, unknown> }>) => nodes.map((node) => node.attrs?.blockId);
    const before = ids(content.tiptap.content);
    const after = ids(next.tiptap.content);
    // The rewritten block is still the same block: every id stays put.
    expect(after).toEqual(before);
    expect(next.tiptap.content.at(-1)!.content![0]!.marks).toEqual([{ type: "textStyle", attrs: { color: "var(--danger)" } }]);
    expect(documentReadback(next, content)).toContain("Split water molecules");
  });

  it("keeps a rewritten block's id between unchanged neighbours, not a new block's", () => {
    const lines = (...paragraphs: string[]) => paragraphs.join("\n\n");
    const content = documentFromMarkdown(lines("One.", "Two.", "Three."), undefined, sequentialIdFactory());
    const [one, two, three] = content.tiptap.content.map((node) => node.attrs?.blockId);
    const rewritten = documentFromMarkdown(lines("One.", "Two, reworded.", "Three."), content, sequentialIdFactory());
    expect(rewritten.tiptap.content.map((node) => node.attrs?.blockId)).toEqual([one, two, three]);
    // An inserted block next to an untouched one is new; the old one keeps its id.
    const inserted = documentFromMarkdown(lines("One.", "New line.", "Two.", "Three."), content, sequentialIdFactory());
    const insertedIds = inserted.tiptap.content.map((node) => node.attrs?.blockId);
    expect(insertedIds[0]).toBe(one);
    expect(insertedIds.slice(2)).toEqual([two, three]);
    expect([one, two, three]).not.toContain(insertedIds[1]);
  });

  it("keeps a rewritten paragraph's own font on its new words", () => {
    const font = { type: "textStyle", attrs: { fontFamily: "Times New Roman" } };
    const content = {
      tiptap: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { blockId: "p1" }, content: [{ type: "text", text: "Old words.", marks: [font] }] },
          { type: "paragraph", attrs: { blockId: "p2" }, content: [{ type: "text", text: "Kept.", marks: [font] }] },
        ],
      },
      blocks: [],
    };
    const next = documentFromMarkdown(["New **bold** words.", "Kept."].join("\n\n"), content, sequentialIdFactory());
    const rewritten = next.tiptap.content[0]!;
    expect(rewritten.attrs?.blockId).toBe("p1");
    expect(rewritten.content!.every((text) => text.marks?.some((mark) => mark.type === "textStyle"))).toBe(true);
    expect(rewritten.content!.find((text) => text.text === "bold")!.marks!.map((mark) => mark.type).sort()).toEqual(["bold", "textStyle"]);
  });

  it("keeps blank lines through an edit elsewhere", () => {
    const content = {
      tiptap: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { blockId: "p1" }, content: [{ type: "text", text: "One." }] },
          { type: "paragraph", attrs: { blockId: "gap" } },
          { type: "paragraph", attrs: { blockId: "p2" }, content: [{ type: "text", text: "Two." }] },
        ],
      },
      blocks: [],
    };
    const markdown = documentToMarkdown(content);
    expect(markdown).toContain("<!-- keep:gap blank line -->");
    const next = documentFromMarkdown(markdown.replace("Two.", "Two, edited."), content, sequentialIdFactory());
    expect(next.tiptap.content.map((node) => node.attrs?.blockId)).toEqual(["p1", "gap", "p2"]);
  });

  it("keeps nodes Markdown cannot express behind a marker", () => {
    const content = {
      tiptap: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { blockId: "p1" }, content: [{ type: "text", text: "Intro" }] },
          { type: "spectraReference", attrs: { blockId: "ref1", label: "Lab report", workId: "w1" } },
        ],
      },
      blocks: [],
    };
    const markdown = documentToMarkdown(content);
    expect(markdown).toContain("<!-- keep:ref1 Lab report -->");
    const kept = documentFromMarkdown(markdown.replace("Intro", "Introduction"), content);
    expect(kept.tiptap.content[1]).toEqual(content.tiptap.content[1]);
    const removed = documentFromMarkdown("Introduction", content);
    expect(removed.tiptap.content).toHaveLength(1);
  });

  it("inserts, moves and deletes sections by heading", () => {
    const base = "# A\n\nalpha\n\n# B\n\nbeta\n\n# C\n\ngamma";
    expect(applyDocumentEdits(base, [{ op: "insert", markdown: "# A2\n\nmore", after: "A" }])).toBe(
      "# A\n\nalpha\n\n# A2\n\nmore\n\n# B\n\nbeta\n\n# C\n\ngamma",
    );
    expect(applyDocumentEdits(base, [{ op: "move_section", heading: "C", before: "A" }])).toBe(
      "# C\n\ngamma\n\n# A\n\nalpha\n\n# B\n\nbeta",
    );
    expect(applyDocumentEdits(base, [{ op: "delete_section", heading: "B" }])).toBe(
      "# A\n\nalpha\n\n# C\n\ngamma",
    );
    expect(applyDocumentEdits(base, [{ op: "insert", markdown: "end", position: "end" }])).toMatch(/gamma\n\nend$/);
  });

  it("fails atomically and names the operation", () => {
    const base = "# A\n\nalpha alpha";
    expect(() =>
      applyDocumentEdits(base, [
        { op: "replace", find: "# A", replace: "# Aa" },
        { op: "replace", find: "alpha", replace: "beta" },
      ]),
    ).toThrow(/Edit 2 \(replace\): `find` text appears 2 times/);
    expect(() => applyDocumentEdits(base, [{ op: "replace", find: "zeta", replace: "x" }])).toThrow(
      /Edit 1 \(replace\): `find` text was not found/,
    );
    expect(() => applyDocumentEdits(base, [{ op: "move_section", heading: "Missing", position: "end" }])).toThrow(
      /no heading matches "Missing"/,
    );
  });

  it("flags empty blocks in the readback", () => {
    const content = documentFromMarkdown("# Title\n\n## \n\nText", undefined, sequentialIdFactory());
    expect(documentReadback(content)).toMatch(/Empty: block 2 \(heading\) is empty/);
  });
});
