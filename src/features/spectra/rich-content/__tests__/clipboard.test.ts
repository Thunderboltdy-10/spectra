// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cleanOfficeHtml, pastedFiles, pastedText } from "../clipboard";

const word = (body: string) =>
  `<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><!--StartFragment-->${body}<!--EndFragment--></body></html>`;
const bullet = (text: string, level = 1) =>
  `<p class=MsoListParagraph style="text-indent:-18.0pt;mso-list:l0 level${level} lfo1"><![if !supportLists]><span style="font-family:Symbol">·<span style="font:7.0pt">&nbsp;&nbsp;</span></span><![endif]>${text}<o:p></o:p></p>`;
const numbered = (marker: string, text: string) =>
  `<p class=MsoListParagraph style="mso-list:l1 level1 lfo2"><![if !supportLists]><span>${marker}<span>&nbsp;</span></span><![endif]>${text}<o:p></o:p></p>`;

describe("pasting from Word", () => {
  it("makes Word's list paragraphs real nested lists", () => {
    const html = cleanOfficeHtml(word(`<p class=MsoNormal>Intro<o:p></o:p></p>${bullet("One")}${bullet("Inner", 2)}${bullet("Two")}<p class=MsoNormal>After</p>`));
    expect(html).toBe("<p>Intro</p><ul><li><p>One</p><ul><li><p>Inner</p></li></ul></li><li><p>Two</p></li></ul><p>After</p>");
  });

  it("tells numbered lists from bullets", () => {
    const html = cleanOfficeHtml(word(`${numbered("1.", "First")}${numbered("2.", "Second")}`));
    expect(html).toBe("<ol><li><p>First</p></li><li><p>Second</p></li></ol>");
  });

  it("keeps bold, italics and colour but drops Word's own styling", () => {
    const html = cleanOfficeHtml(word(`<p class=MsoNormal style="margin:0;mso-pagination:none"><b>Bold</b> <span style="color:red;mso-bidi-font-weight:bold">red</span><o:p></o:p></p>`));
    expect(html).toBe('<p><b>Bold</b> <span style="color:red">red</span></p>');
  });

  it("leaves other HTML alone", () => {
    expect(cleanOfficeHtml("<p><b>Web</b> text</p>")).toBe("<p><b>Web</b> text</p>");
  });
});

describe("what a paste carries", () => {
  const data = (text: string, file?: File) => {
    const files = file ? [file] : [];
    return {
      getData: (type: string) => (type === "text/plain" ? text : ""),
      files: Object.assign(files, { item: (index: number) => files[index] ?? null }),
    } as unknown as DataTransfer;
  };
  const picture = new File(["png"], "image.png", { type: "image/png" });

  it("is text when Word adds a picture of the selection", () => {
    expect(pastedFiles(data("Some text", picture))).toEqual([]);
    expect(pastedText(data("Some text", picture))).toBe("Some text");
  });

  it("is the file when there is nothing else", () => {
    expect(pastedFiles(data("", picture))).toEqual([picture]);
    expect(pastedFiles(data("  \n", picture))).toEqual([picture]);
  });
});
