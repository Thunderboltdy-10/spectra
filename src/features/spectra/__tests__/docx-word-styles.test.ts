// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import * as docx from "docx";
import JSZip from "jszip";
import { Editor } from "@tiptap/core";
import { docxLens } from "../lenses/docx-lens";
import {
  docxProjectionFromContent,
  documentBlocksFromJson,
  documentContentToProseMirrorJson,
  type DocumentJsonNode,
} from "../lenses/document-projection";
import { documentSchemaExtensions } from "../editor/document-extensions";
import { wordStyleSheet } from "../editor/word-style-sheet";

async function styledEssay() {
  const document = new docx.Document({
    styles: {
      default: { document: { run: { font: "Cambria", size: 24 }, paragraph: { spacing: { after: 160 } } } },
      paragraphStyles: [
        { id: "BodyText", name: "Body Text", basedOn: "Normal", next: "BodyText", run: { font: "Georgia", size: 22 }, paragraph: { spacing: { after: 240 }, indent: { firstLine: 360 } } },
        { id: "EssayTitle", name: "Title", basedOn: "Normal", next: "Normal", run: { size: 56, color: "1F3864" } },
      ],
    },
    sections: [{
      children: [
        new docx.Paragraph({ style: "EssayTitle", children: [new docx.TextRun("The light of the festival")] }),
        new docx.Paragraph({ style: "BodyText", children: [new docx.TextRun("Opening paragraph.")] }),
        new docx.Paragraph({ children: [new docx.TextRun("A plain paragraph.")] }),
      ],
    }],
  });
  return new Uint8Array(await docx.Packer.toBuffer(document));
}

const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

describe("a Word document's own styles", () => {
  it("opens with a catalogue of its styles and marks each styled paragraph", async () => {
    const opened = await docxLens.open(await styledEssay());
    const styles = opened.projection.styles!;
    expect(styles.defaultStyleId).toBe("Normal");
    expect(styles.paragraph.Normal).toMatchObject({ fontFamily: "Cambria", fontSizePoints: 12, spacingAfterPoints: 8 });
    expect(styles.paragraph.BodyText).toMatchObject({ name: "Body Text", next: "BodyText", fontFamily: "Georgia", fontSizePoints: 11, spacingAfterPoints: 12, firstLineIndentPoints: 18 });
    expect(styles.paragraph.EssayTitle).toMatchObject({ role: "title", next: "Normal", fontSizePoints: 28, color: "1F3864" });
    const json = documentContentToProseMirrorJson(opened.projection) as DocumentJsonNode;
    expect(json.content?.map((node) => node.attrs?.styleId ?? null)).toEqual(["EssayTitle", "BodyText", null]);
  });

  it("writes nothing back for an untouched styled document", async () => {
    const opened = await docxLens.open(await styledEssay());
    const base = opened.projection;
    const json = documentContentToProseMirrorJson(base) as DocumentJsonNode;
    expect(docxProjectionFromContent({ ...base, tiptap: json, blocks: documentBlocksFromJson(json), nativeProjectionComplete: true }, base).operations).toEqual([]);
  });

  it("opens runs with only their own formatting and writes nothing for older content that spelled out the style's font", async () => {
    const opened = await docxLens.open(await styledEssay());
    const base = opened.projection;
    // Each run's font is its style's, so no run carries one.
    expect(base.blocks.flatMap((block) => block.inlineContent ?? []).some((item) => "format" in item && item.format?.fontFamily)).toBe(false);
    const json = documentContentToProseMirrorJson(base) as DocumentJsonNode;
    // Content stored before direct-only formats carried every run's resolved font and size.
    const resolved: Record<string, { fontFamily: string; fontSize: string }> = {
      EssayTitle: { fontFamily: "Cambria", fontSize: "28pt" },
      BodyText: { fontFamily: "Georgia", fontSize: "11pt" },
    };
    for (const node of json.content!) {
      const style = resolved[String(node.attrs?.styleId ?? "")] ?? { fontFamily: "Cambria", fontSize: "12pt" };
      for (const child of node.content ?? []) if (child.type === "text") child.marks = [{ type: "textStyle", attrs: style }];
    }
    expect(docxProjectionFromContent({ ...base, tiptap: json, blocks: documentBlocksFromJson(json), nativeProjectionComplete: true }, base).operations).toEqual([]);
  });

  it("writes a new paragraph in the style the writer continued", async () => {
    const opened = await docxLens.open(await styledEssay());
    const base = opened.projection;
    const json = documentContentToProseMirrorJson(base) as DocumentJsonNode;
    json.content!.splice(2, 0, { type: "paragraph", attrs: { styleId: "BodyText" }, content: [{ type: "text", text: "Second paragraph." }] });
    const { operations } = docxProjectionFromContent({ ...base, tiptap: json, blocks: documentBlocksFromJson(json), nativeProjectionComplete: true }, base);
    const output = await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations });
    const xml = await (await JSZip.loadAsync(output)).file("word/document.xml")!.async("string");
    const second = (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/gu) ?? []).find((paragraph) => paragraph.includes("Second paragraph."));
    expect(second).toContain('<w:pStyle w:val="BodyText"/>');
    // Words typed in a styled paragraph carry no font of their own: the style decides.
    expect(second).not.toContain("w:rFonts");
  });

  it("draws the page from the catalogue", async () => {
    const opened = await docxLens.open(await styledEssay());
    const sheet = wordStyleSheet(opened.projection.styles, ".page .ProseMirror");
    expect(sheet).toContain('--prose-font: "Cambria", var(--word-font-caladea), serif');
    expect(sheet).toContain("--prose-size: 12pt");
    expect(sheet).toMatch(/p\[data-style="BodyText"\]\) \{[^}]*font-family: "Georgia", serif[^}]*margin-bottom: 12pt[^}]*text-indent: 18pt/u);
    expect(sheet).toMatch(/p\[data-style="EssayTitle"\]\) \{ color: #1F3864; \}/u);
  });

  it("gives the paragraph after a title the title's next style when the writer presses Enter at its end", async () => {
    const opened = await docxLens.open(await styledEssay());
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({ element, extensions: documentSchemaExtensions(), content: documentContentToProseMirrorJson(opened.projection) });
    cleanup.push(() => { editor.destroy(); element.remove(); });
    (editor.storage as unknown as Record<string, { nextStyle: Map<string, string | null> }>).spectraParagraphFrame!.nextStyle =
      new Map([["EssayTitle", null], ["BodyText", "BodyText"]]);
    const titleEnd = editor.state.doc.child(0).nodeSize - 1;
    editor.commands.setTextSelection(titleEnd);
    editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, new KeyboardEvent("keydown", { key: "Enter" })));
    expect(editor.state.doc.child(1).attrs.styleId).toBeNull();
    expect(editor.state.doc.child(0).attrs.styleId).toBe("EssayTitle");
    // A body paragraph continues as body text.
    const bodyEnd = editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize + editor.state.doc.child(2).nodeSize - 1;
    editor.commands.setTextSelection(bodyEnd);
    editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, new KeyboardEvent("keydown", { key: "Enter" })));
    expect(editor.state.doc.child(3).attrs.styleId).toBe("BodyText");
  });
});
