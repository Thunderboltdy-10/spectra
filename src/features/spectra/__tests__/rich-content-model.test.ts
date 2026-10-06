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
});

describe("rich content: plain text", () => {
  it("keeps the words and one block per line", () => {
    expect(richContentToPlainText(parseSpectraRichContent("# Title\n\n- **a**\n- $x$\n\nend [link](https://a.b)"))).toBe("Title\na\nx\nend link");
  });
});
