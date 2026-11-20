import { describe, expect, it } from "vitest";
import { comparePackages, compareXml } from "@ariadng/office/preservation";
import { parseXml } from "@ariadng/office/xml";
import { Document } from "@ariadng/office/docx";
import { comparePackageVerdicts, xmlTreesEquivalent } from "../lenses/package-verdicts";

const pairs: Array<[string, string]> = [
  ['<a xmlns="urn:x" b="1" c="2"><d/>text</a>', '<x:a xmlns:x="urn:x" c="2" b="1"><x:d/>text</x:a>'],
  ['<a><!-- note --><b>one</b>  </a>', "<a><b>one</b></a>"],
  ['<a xml:space="preserve"><b> </b></a>', "<a><b> </b></a>"],
  ['<a xml:space="preserve"> <b/></a>', '<a xml:space="preserve"><b/></a>'],
  ['<a xmlns:p="urn:1"><p:b/></a>', '<a xmlns:p="urn:2"><p:b/></a>'],
  ['<a xmlns:p="urn:1" p:k="v"/>', '<a xmlns:q="urn:1" q:k="v"/>'],
  ['<a k="v"/>', '<a k="w"/>'],
  ['<a k="v"/>', "<a/>"],
  ["<a>t<![CDATA[u]]></a>", "<a>tu</a>"],
  ["<a><b/><c/></a>", "<a><c/><b/></a>"],
  ["<a><b/>x</a>", "<a>x<b/></a>"],
];

describe("package verdicts", () => {
  it.each(pairs)("agrees with the library's L1 comparison: %s vs %s", (left, right) => {
    const expected = compareXml(parseXml(left), parseXml(right)).length === 0;
    expect(xmlTreesEquivalent(parseXml(left).root, parseXml(right).root)).toBe(expected);
  });

  it("gives comparePackages' verdict for every part of an edited document", async () => {
    const document = Document.create();
    document.addParagraph("First.");
    const before = await document.save();
    document.addParagraph("Second.");
    const after = await document.save();
    const strip = (comparison: Awaited<ReturnType<typeof comparePackages>>) =>
      comparison.parts.map(({ name, verdict, note }) => ({ name, verdict, ...(note ? { note } : {}) }));
    for (const [left, right] of [[before, after], [before, before], [after, before]] as const)
      expect(strip(await comparePackageVerdicts(left, right))).toEqual(strip(await comparePackages(left, right)));
  });
});
