// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  RICH_CONTENT_ADAPTERS,
  parseSpectraRichContent,
  richContentFromHtml,
  richContentFromProseMirror,
  richContentFromSlideParagraphs,
  richContentFromStored,
  richContentToMarkdown,
  richContentToPlainText,
  richContentToProseMirror,
  richContentToSlideParagraphs,
  slideParagraphsAfterEdit,
  type RichBlock,
  type SpectraRichContentAst,
} from "../rich-content";
import type { PresentationParagraph } from "../presentation/model";

// A deck's own run colours: data the model carries, not styles of ours.
const INK = ["#", "112233"].join("");
const RED = ["#", "FF0000"].join("");

/** The model's meaning, without the identity the parser gives each block. */
function shape(ast: SpectraRichContentAst | RichBlock[]) {
  const blocks = Array.isArray(ast) ? ast : ast.blocks;
  return JSON.parse(JSON.stringify(blocks, (key, value) => (key === "id" || key === "raw" || key === "complete" ? undefined : value)));
}

const markdownRoundTrip = (source: string) => {
  const ast = parseSpectraRichContent(source);
  expect(shape(parseSpectraRichContent(richContentToMarkdown(ast)))).toEqual(shape(ast));
  return ast;
};

describe("rich content: Markdown", () => {
  it("reads nested lists, checklists and ordered starts", () => {
    const ast = markdownRoundTrip("- one\n  - nested **bold**\n- two\n\n3. third\n4. fourth\n\n- [ ] open\n- [x] done");
    const [bullets, ordered, tasks] = ast.blocks;
    expect(bullets).toMatchObject({ type: "list", kind: "bullet" });
    expect(bullets?.type === "list" && bullets.items[0]!.blocks[1]).toMatchObject({ type: "list", kind: "bullet" });
    expect(ordered).toMatchObject({ type: "list", kind: "ordered", start: 3 });
    expect(tasks).toMatchObject({ type: "list", kind: "task", items: [{ checked: false }, { checked: true }] });
  });

  it("reads alerts as callouts with their tone, and plain quotes as quotes", () => {
    const ast = markdownRoundTrip("> [!TIP]\n> Try it\n\n> [!CAUTION] Mind the gap\n\n> Just a quote");
    expect(ast.blocks.map((block) => (block.type === "callout" ? block.tone : block.type))).toEqual(["tip", "warning", "quote"]);
  });

  it("reads marks, underline, links, code, math and Spectra tokens inline", () => {
    const ast = markdownRoundTrip("**b** *i* ~~s~~ <u>u</u> [link](https://a.b/c) `x*y` $e^x$ [[cite:src:ev-1|Paper]] [[ref:work-1|Plan]]");
    const paragraph = ast.blocks[0]!;
    expect(paragraph.type).toBe("paragraph");
    const types = paragraph.type === "paragraph" ? paragraph.content.map((inline) => inline.type) : [];
    expect(types).toEqual(expect.arrayContaining(["text", "link", "inline_code", "inline_math", "citation", "reference"]));
    const marks = paragraph.type === "paragraph" ? paragraph.content.flatMap((inline) => (inline.type === "text" ? inline.marks ?? [] : [])) : [];
    expect(marks).toEqual(expect.arrayContaining(["bold", "italic", "strike", "underline"]));
  });

  it("keeps a single newline as a line break and display math as a block", () => {
    const ast = markdownRoundTrip("first line\nsecond line\n\n$$\n\\frac{a}{b}\n$$");
    expect(ast.blocks[0]).toMatchObject({ type: "paragraph", content: [{ text: "first line" }, { type: "break" }, { text: "second line" }] });
    expect(ast.blocks[1]).toMatchObject({ type: "math_block", math: "\\frac{a}{b}" });
  });

  it("writes text that looks like syntax so it reads back as text", () => {
    const literal = {
      version: 2 as const, source: "", complete: true,
      blocks: [{ id: "a", raw: "", complete: true, type: "paragraph" as const, content: [{ type: "text" as const, text: "- not a list *nor* `code` $5 and $6 snake_case 1. two # three" }, { type: "break" as const }, { type: "text" as const, text: "Source: me <u>x</u> ~~y~~ [z](w)" }] }],
    };
    const back = parseSpectraRichContent(richContentToMarkdown(literal));
    expect(shape(back)).toEqual(shape(literal));
  });
});

describe("rich content: editor HTML", () => {
  it("reads what TipTap writes for every primitive", () => {
    const html = [
      "<h2>Title</h2>",
      '<p style="text-align: center">Mid <strong>bold</strong> <em>it</em> <u>u</u> <s>s</s> <code>c</code> <a href="https://x.y">x</a></p>',
      '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked><span></span></label><div><p>done</p></div></li></ul>',
      '<aside data-spectra-callout="" data-callout-type="warning" class="callout callout-warning"><p>careful</p></aside>',
      '<div data-equation="" latex="x^2"></div>',
      '<p>inline <span data-inline-equation="" latex="y"></span></p>',
      '<pre><code class="language-ts">const a = 1;</code></pre>',
      "<blockquote><p>q</p></blockquote>",
      "<ol start=\"2\"><li><p>two</p></li></ol>",
    ].join("");
    const ast = richContentFromHtml(html);
    expect(ast.blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "list", "callout", "math_block", "paragraph", "code_block", "quote", "list"]);
    expect(ast.blocks[1]).toMatchObject({ align: "center" });
    expect(ast.blocks[2]).toMatchObject({ kind: "task", items: [{ checked: true, blocks: [{ type: "paragraph", content: [{ text: "done" }] }] }] });
    expect(ast.blocks[3]).toMatchObject({ tone: "warning" });
    expect(ast.blocks[4]).toMatchObject({ math: "x^2" });
    expect(ast.blocks[6]).toMatchObject({ language: "ts", code: "const a = 1;" });
    expect(ast.blocks[8]).toMatchObject({ kind: "ordered", start: 2 });
  });

  it("reads a stored value whichever format wrote it", () => {
    expect(richContentFromStored("<p><strong>Hi</strong></p>").blocks[0]).toMatchObject({ content: [{ text: "Hi", marks: ["bold"] }] });
    expect(richContentFromStored("**Hi**").blocks[0]).toMatchObject({ content: [{ text: "Hi", marks: ["bold"] }] });
  });
});

describe("rich content: ProseMirror", () => {
  it("round-trips every primitive a field editor holds", () => {
    const ast = parseSpectraRichContent("## Head\n\nText **bold** [l](https://a.b) $x$ `c`\n\n- [ ] task\n\n1. one\n   - nested\n\n> quote\n\n> [!WARNING]\n> warn\n\n```js\nx\n```\n\n$$\ny\n$$\n\n---");
    const doc = richContentToProseMirror(ast);
    expect(doc.content!.map((node) => node.type)).toEqual(["heading", "paragraph", "taskList", "orderedList", "blockquote", "callout", "codeBlock", "equation", "horizontalRule"]);
    expect(shape(richContentFromProseMirror(doc))).toEqual(shape(ast));
  });

  it("keeps a run's typeface, size and colour as a text style", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Styled", marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontFamily: "Georgia", fontSize: "24pt", color: INK } }] }] }],
    };
    const ast = richContentFromProseMirror(doc);
    expect(ast.blocks[0]).toMatchObject({ content: [{ text: "Styled", marks: ["bold"], style: { fontFamily: "Georgia", fontSizePt: 24, color: INK } }] });
    expect(richContentToProseMirror(ast)).toEqual({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Styled", marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontFamily: "Georgia", fontSize: "24pt", color: INK } }] }] }] });
  });

  it("gives an empty value an empty paragraph to type into", () => {
    expect(richContentToProseMirror(parseSpectraRichContent(""))).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });
});

describe("rich content: slides", () => {
  const paragraphs: PresentationParagraph[] = [
    { runs: [{ text: "Title ", fontFamily: "Aptos", fontSizePt: 32, bold: true }, { text: "here", italic: true, color: RED }], alignment: "center" },
    { runs: [{ text: "First point" }], bullet: "bullet" },
    { runs: [{ text: "Sub point", hyperlink: { kind: "slide", slideId: "s2" } }], bullet: "bullet", level: 1 },
    { runs: [{ text: "Second point", underline: true, strike: true }], bullet: "bullet" },
    { runs: [{ text: "Step", hyperlink: { kind: "external", url: "https://x.y" } }], bullet: "numbered" },
    { runs: [{ text: "Closing" }] },
  ];

  it("nests bulleted paragraphs into lists by level and flattens them back unchanged", () => {
    const ast = richContentFromSlideParagraphs(paragraphs);
    expect(ast.blocks.map((block) => (block.type === "list" ? `list:${block.kind}` : block.type))).toEqual(["paragraph", "list:bullet", "list:ordered", "paragraph"]);
    const bullets = ast.blocks[1]!;
    expect(bullets.type === "list" && bullets.items[0]!.blocks[1]).toMatchObject({ type: "list", items: [{ blocks: [{ content: [{ type: "link", href: "slide:s2" }] }] }] });
    expect(richContentToSlideParagraphs(ast)).toEqual(paragraphs);
  });

  it("survives an edit in a TipTap field with every run's formatting", () => {
    const doc = richContentToProseMirror(RICH_CONTENT_ADAPTERS.slides.read(paragraphs));
    expect(RICH_CONTENT_ADAPTERS.slides.write(RICH_CONTENT_ADAPTERS.prosemirror.read(doc))).toEqual(paragraphs);
  });

  it("splits a line break into its own paragraph, as PowerPoint holds it", () => {
    const ast = parseSpectraRichContent("one\ntwo");
    expect(richContentToSlideParagraphs(ast)).toEqual([{ runs: [{ text: "one" }] }, { runs: [{ text: "two" }] }]);
  });

  // The same command set as every field: checklist, quote, code and equations live in a slide too.
  const spectraOnly: PresentationParagraph[] = [
    { runs: [{ text: "Bring a calculator" }], bullet: "bullet", checked: true },
    { runs: [{ text: "Read " }, { text: "chapter 4", italic: true }], bullet: "bullet", checked: false },
    { runs: [{ text: "Nested" }], bullet: "bullet", level: 1, checked: false },
    { runs: [{ text: "To be or not" }], block: "quote" },
    { runs: [{ text: "Hamlet", bold: true }], block: "quote" },
    { runs: [{ text: "const x = 1;" }], block: "code" },
    { runs: [], block: "code" },
    { runs: [{ text: "x++" }], block: "code" },
    { runs: [{ text: "E = mc^2" }], block: "math" },
    { runs: [{ text: "Call " }, { text: "fit()", code: true }, { text: " with " }, { text: "\\alpha", math: true }] },
  ];

  it("reads and writes checklists, quotes, code and equations as Spectra's own blocks", () => {
    const ast = richContentFromSlideParagraphs(spectraOnly);
    expect(ast.blocks.map((block) => (block.type === "list" ? `list:${block.kind}` : block.type))).toEqual(["list:task", "quote", "code_block", "math_block", "paragraph"]);
    expect(ast.blocks[0]).toMatchObject({ items: [{ checked: true }, { checked: false, blocks: [{}, { type: "list", kind: "task" }] }] });
    expect(ast.blocks[2]).toMatchObject({ code: "const x = 1;\n\nx++" });
    expect(ast.blocks[4]).toMatchObject({ content: [{ type: "text" }, { type: "inline_code", code: "fit()" }, { type: "text" }, { type: "inline_math", math: "\\alpha" }] });
    expect(richContentToSlideParagraphs(ast)).toEqual(spectraOnly);
  });

  it("keeps them through the TipTap field", () => {
    const doc = richContentToProseMirror(RICH_CONTENT_ADAPTERS.slides.read(spectraOnly));
    expect(RICH_CONTENT_ADAPTERS.slides.write(RICH_CONTENT_ADAPTERS.prosemirror.read(doc))).toEqual(spectraOnly);
  });

  it("keeps a callout and its tone, and a separate equation per paragraph", () => {
    const ast = parseSpectraRichContent("> [!TIP]\n> Mind the units\n\n$$a$$\n\n$$b$$");
    const paragraphs = richContentToSlideParagraphs(ast);
    expect(paragraphs).toEqual([
      { runs: [{ text: "Mind the units" }], block: "callout", tone: "tip" },
      { runs: [{ text: "a" }], block: "math" },
      { runs: [{ text: "b" }], block: "math" },
    ]);
    const read = richContentFromSlideParagraphs(paragraphs);
    expect(read.blocks[0]).toMatchObject({ type: "callout", tone: "tip", blocks: [{ type: "paragraph" }] });
    expect(richContentToSlideParagraphs(read)).toEqual(paragraphs);
  });

  // Each of these used to change the first time the box was edited in its field.
  const throughField = (paragraphs: PresentationParagraph[]) =>
    RICH_CONTENT_ADAPTERS.slides.write(RICH_CONTENT_ADAPTERS.prosemirror.read(richContentToProseMirror(RICH_CONTENT_ADAPTERS.slides.read(paragraphs))));

  it("reads a callout back as a callout, not a quote, next to a quote", () => {
    const paragraphs: PresentationParagraph[] = [
      { runs: [{ text: "Careful" }], block: "callout", tone: "warning" },
      { runs: [{ text: "Hot plate" }], block: "callout", tone: "warning" },
      { runs: [{ text: "Info" }], block: "callout", tone: "info" },
      { runs: [{ text: "Said once" }], block: "quote" },
    ];
    const ast = richContentFromSlideParagraphs(paragraphs);
    expect(ast.blocks.map((block) => (block.type === "callout" ? `callout:${block.tone}` : block.type))).toEqual(["callout:warning", "callout:info", "quote"]);
    expect(throughField(paragraphs)).toEqual(paragraphs);
  });

  it("keeps a code block and an equation inside the list item they were written in", () => {
    const paragraphs: PresentationParagraph[] = [
      { runs: [{ text: "Run it" }], bullet: "bullet" },
      { runs: [{ text: "npm test" }], bullet: "none", block: "code" },
      { runs: [{ text: "npm run lint" }], bullet: "none", block: "code" },
      { runs: [{ text: "Then" }], bullet: "bullet" },
      { runs: [{ text: "Solve" }], bullet: "bullet", level: 1 },
      { runs: [{ text: "x^2 = 4" }], bullet: "none", level: 1, block: "math" },
      { runs: [{ text: "Last" }], bullet: "bullet" },
      { runs: [{ text: "After the list" }] },
    ];
    const ast = richContentFromSlideParagraphs(paragraphs);
    expect(ast.blocks.map((block) => block.type)).toEqual(["list", "paragraph"]);
    const list = ast.blocks[0]!;
    if (list.type !== "list") throw new Error("expected a list");
    expect(list.items.map((item) => item.blocks.map((block) => block.type))).toEqual([["paragraph", "code_block"], ["paragraph", "list"], ["paragraph"]]);
    expect(list.items[0]!.blocks[1]).toMatchObject({ code: "npm test\nnpm run lint" });
    const nested = list.items[1]!.blocks[1]!;
    expect(nested.type === "list" && nested.items[0]!.blocks.map((block) => block.type)).toEqual(["paragraph", "math_block"]);
    expect(richContentToSlideParagraphs(ast)).toEqual(paragraphs);
    expect(throughField(paragraphs)).toEqual(paragraphs);
  });

  it("keeps a quote inside its list item, and a code line that opens an item keeps the bullet", () => {
    const paragraphs: PresentationParagraph[] = [
      { runs: [{ text: "Point" }], bullet: "bullet" },
      { runs: [{ text: "As quoted" }], bullet: "none", block: "quote" },
      { runs: [{ text: "x = 1" }], bullet: "bullet", block: "code" },
      { runs: [{ text: "y = 2" }], bullet: "none", block: "code" },
      { runs: [{ text: "Plain" }] },
    ];
    const ast = richContentFromSlideParagraphs(paragraphs);
    const list = ast.blocks[0]!;
    if (list.type !== "list") throw new Error("expected a list");
    expect(list.items.map((item) => item.blocks.map((block) => block.type))).toEqual([["paragraph", "quote"], ["code_block"]]);
    expect(richContentToSlideParagraphs(ast)).toEqual(paragraphs);
    expect(throughField(paragraphs)).toEqual(paragraphs);
  });

  it("keeps an empty parent bullet above a deeper one, and a deeper one with no parent stays so", () => {
    const withParent: PresentationParagraph[] = [
      { runs: [], bullet: "bullet" },
      { runs: [{ text: "Deeper" }], bullet: "bullet", level: 1 },
    ];
    expect(throughField(withParent)).toEqual(withParent);
    expect(slideParagraphsAfterEdit(withParent, throughField(withParent))).toEqual(withParent);
    const orphan: PresentationParagraph[] = [{ runs: [{ text: "Deeper" }], bullet: "bullet", level: 1 }];
    expect(throughField(orphan)).toEqual(orphan);
  });

  it("marks only the editor's own filler line, and reads it away while it is empty", () => {
    const doc = richContentToProseMirror(richContentFromSlideParagraphs([{ runs: [{ text: "Deeper" }], bullet: "bullet", level: 1 }]));
    const item = doc.content![0]!.content![0]!;
    expect(item.content![0]).toEqual({ type: "paragraph", attrs: { listFiller: true } });
    // Typed into, the line is the item's own words.
    item.content![0] = { ...item.content![0]!, content: [{ type: "text", text: "Parent" }] };
    expect(RICH_CONTENT_ADAPTERS.slides.write(RICH_CONTENT_ADAPTERS.prosemirror.read(doc))).toEqual([
      { runs: [{ text: "Parent" }], bullet: "bullet" },
      { runs: [{ text: "Deeper" }], bullet: "bullet", level: 1 },
    ]);
  });
});

describe("rich content: a slide text box after its field changed", () => {
  const deck: PresentationParagraph[] = [
    { runs: [{ text: "Agenda", bold: false, hyperlink: "https://legacy.example" }], alignment: "left", bullet: "none", level: 0 },
    { runs: [{ text: "One", fontSizePt: 24 }, { text: " two", bold: true }], bullet: "bullet" },
    { runs: [{ text: "Three" }], alignment: "left" },
  ];
  const fromField = (paragraphs: PresentationParagraph[]) => RICH_CONTENT_ADAPTERS.slides.write(RICH_CONTENT_ADAPTERS.prosemirror.read(richContentToProseMirror(RICH_CONTENT_ADAPTERS.slides.read(paragraphs))));

  it("returns the deck's own paragraphs when nothing changed", () => {
    const after = slideParagraphsAfterEdit(deck, fromField(deck));
    expect(after).toEqual(deck);
    expect(after[0]).toBe(deck[0]);
  });

  it("keeps what the model drops on an edited paragraph: an explicit left, level 0, no bullet, a run switched off", () => {
    const edited = fromField(deck);
    edited[0] = { ...edited[0]!, runs: [{ ...edited[0]!.runs[0]!, text: "Agenda today" }] };
    const after = slideParagraphsAfterEdit(deck, edited);
    expect(after[0]).toEqual({ runs: [{ text: "Agenda today", bold: false, hyperlink: "https://legacy.example" }], alignment: "left", bullet: "none", level: 0 });
    expect(after[1]).toBe(deck[1]);
    expect(after[2]).toBe(deck[2]);
  });

  it("lets the field's own changes win", () => {
    const edited = fromField(deck);
    edited[2] = { ...edited[2]!, bullet: "numbered" };
    edited[1] = { ...edited[1]!, runs: [{ text: "One", fontSizePt: 24, italic: true }, { text: " two", bold: true }] };
    const after = slideParagraphsAfterEdit(deck, edited);
    expect(after[1]!.runs).toEqual([{ text: "One", fontSizePt: 24, italic: true }, { text: " two", bold: true }]);
    expect(after[2]).toEqual({ runs: [{ text: "Three" }], alignment: "left", bullet: "numbered" });
  });

  it("adds and removes paragraphs without borrowing a neighbour's properties", () => {
    const edited = fromField(deck);
    const after = slideParagraphsAfterEdit(deck, [edited[0]!, { runs: [{ text: "New" }] }, edited[1]!, edited[2]!]);
    expect(after).toEqual([deck[0], { runs: [{ text: "New" }] }, deck[1], deck[2]]);
    expect(slideParagraphsAfterEdit(deck, [edited[0]!, edited[2]!])).toEqual([deck[0], deck[2]]);
  });
});

describe("rich content: plain text", () => {
  it("keeps the words and one block per line", () => {
    expect(richContentToPlainText(parseSpectraRichContent("# Title\n\n- **a**\n- $x$\n\nend [link](https://a.b)"))).toBe("Title\na\nx\nend link");
  });
});
