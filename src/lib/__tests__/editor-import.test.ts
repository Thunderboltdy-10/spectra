// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { importNotionMarkdown } from "@/lib/editor/import-notion";
import { importNotionHtml } from "@/lib/editor/import-notion";
import { plainTextToTiptapJson, textFromTiptapJson } from "@/lib/editor/tiptap-import";

describe("editor imports", () => {
  it("converts markdown into tiptap json", async () => {
    const imported = await importNotionMarkdown("# Biology\n\n- ATP\n- Krebs cycle", "Biology");
    expect(imported.content.type).toBe("doc");
    expect(imported.contentPlaintext).toContain("Biology");
    expect(imported.contentPlaintext).toContain("ATP");
  });

  it("converts html into tiptap json", () => {
    const imported = importNotionHtml("<h1>Essay plan</h1><p><strong>Point one</strong></p>", "Essay plan");
    expect(imported.content.type).toBe("doc");
    expect(imported.contentPlaintext).toContain("Essay plan");
    expect(imported.contentPlaintext).toContain("Point one");
  });

  it("creates structured paragraphs from plain text", () => {
    const doc = plainTextToTiptapJson("One paragraph\n\nTwo paragraph");
    expect(doc.content?.length).toBe(2);
    expect(textFromTiptapJson(doc)).toContain("Two paragraph");
  });
});
