/**
 * Golden round trip for the Document artifact and Word. Every fixture is opened
 * by the DOCX lens, loaded through the editor's real schema, projected back and
 * then edited the ways a writer edits: each edit is written into the package,
 * reopened and read back exactly.
 *
 * Local acceptance: set PROBE_FILES to a `;`-separated list of .docx copies
 * (never the originals) to run the same checks over real schoolwork.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Node as PMNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { documentSchema } from "../editor/document-extensions";
import {
  docxLens,
  docxProjectionReadbackDigest,
  docxProjectionSemanticDigest,
  docxReadbackDifference,
} from "../lenses/docx-lens";
import { GOLDEN_EDITS, type J } from "./document-word-golden-edits";
import {
  compactDocxProjectionForStorage,
  documentBlocksFromJson,
  documentContentToProseMirrorJson,
  docxProjectionFromContent,
} from "../lenses/document-projection";


const FIXTURES = path.resolve(__dirname, "fixtures");
const CORPUS = path.resolve(__dirname, "../../../../fixtures/office/docx");
const committed = [
  path.join(FIXTURES, "extended-essay.docx"),
  ...["complex-structure", "equation-omml", "footnotes-endnotes", "multilevel-numbering", "section-headers-footers", "bibliography-source", "fields-toc"]
    .map((name) => path.join(CORPUS, `${name}.docx`))
    .filter((file) => existsSync(file)),
];
const local = (process.env.PROBE_FILES ?? "").split(";").filter(Boolean);
const files = [...committed, ...local];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type Outcome = { file: string; check: string; result: string };

async function roundTrip(file: string) {
  const outcomes: Outcome[] = [];
  const name = path.basename(file);
  const note = (check: string, result: string) => outcomes.push({ file: name, check, result });
  const schema = documentSchema();
  const opened = await docxLens.open(new Uint8Array(readFileSync(file)), "strict-native");
  const content = compactDocxProjectionForStorage(opened.projection) as Record<string, unknown>;
  const json = documentContentToProseMirrorJson(content) as J;
  const node = PMNode.fromJSON(schema, json);
  node.check();
  const editorJson = node.toJSON() as J;

  const lost = new Set<string>();
  const compare = (before: J, after: J) => {
    for (const [key, value] of Object.entries(before.attrs ?? {}))
      if (value !== undefined && value !== null && !(key in (after.attrs ?? {}))) lost.add(`${before.type}.attr.${key}`);
    const marks = new Set((after.marks ?? []).map((mark) => mark.type));
    for (const mark of before.marks ?? []) if (!marks.has(mark.type)) lost.add(`${before.type}.mark.${mark.type}`);
    if ((before.content ?? []).length !== (after.content ?? []).length) lost.add(`${before.type}.children`);
    (before.content ?? []).forEach((child, index) => after.content?.[index] && compare(child, after.content[index]!));
  };
  compare(json, editorJson);
  note("schema", lost.size ? `lost ${[...lost].join(", ")}` : "ok");

  const untouched = docxProjectionFromContent(
    { ...content, tiptap: editorJson, blocks: documentBlocksFromJson(editorJson), nativeProjectionComplete: true },
    opened.projection,
  );
  note("untouched", untouched.operations.length
    ? `operations ${untouched.operations.map((operation) => operation.kind).join(",")}`
    : "ok");

  for (const [edit, apply] of Object.entries(GOLDEN_EDITS)) {
    const edited = apply(clone(editorJson));
    if (!edited) continue;
    try {
      const editedNode = PMNode.fromJSON(schema, edited);
      editedNode.check();
      const editedJson = editedNode.toJSON() as J;
      const projected = docxProjectionFromContent(
        { ...content, tiptap: editedJson, blocks: documentBlocksFromJson(editedJson), nativeProjectionComplete: true },
        opened.projection,
      );
      const output = await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations: projected.operations });
      const reopened = await docxLens.open(output, "strict-native");
      const requested = await docxProjectionSemanticDigest(projected.projection);
      const readback = await docxProjectionReadbackDigest(reopened.projection, projected.projection);
      note(edit, requested === readback ? "ok" : `readback: ${await docxReadbackDifference(reopened.projection, projected.projection)}`);
    } catch (error) {
      note(edit, `error: ${String(error).slice(0, 300)}`);
    }
  }
  return outcomes;
}

describe("Document ↔ Word golden round trip", () => {
  it.each(files)("%s round trips through the editor and back", async (file) => {
    const outcomes = await roundTrip(file);
    const failures = outcomes.filter((outcome) => outcome.result !== "ok");
    expect(failures).toEqual([]);
  }, 600_000);
});

describe("Word content the editor schema must not drop", () => {
  it("keeps a picture that shares its paragraph with words, whatever its empty locators", async () => {
    const { documentRichInlineFromJson } = await import("../../../../shared/document-projection.mjs");
    const paragraph = {
      type: "paragraph",
      content: [
        { type: "text", text: "Figure beside text " },
        { type: "nativeDocxImage", attrs: { src: "blob:x", partName: "/word/media/image1.png", occurrenceId: "", assetId: "", mediaType: "image/png", alt: "Graph" } },
      ],
    };
    const items = documentRichInlineFromJson(paragraph) as Array<{ kind: string; partName?: string }>;
    expect(items.map((item) => item.kind)).toEqual(["text", "image"]);
    expect(items[1]?.partName).toBe("/word/media/image1.png");
  });

  it("reads a Word line break as the editor's hard break, in a cell and in a heading", async () => {
    const { documentRichInlineFromJson, docxRichInlineToJson } = await import("../../../../shared/document-projection.mjs");
    const bold = { bold: true, fontFamily: "Arial" };
    const json = docxRichInlineToJson([{ kind: "text", text: "\nTitle", format: bold }], undefined) as Array<{ type: string }>;
    expect(json.map((node) => node.type)).toEqual(["hardBreak", "text"]);
    // Yjs keeps no marks on the break: it joins the words beside it.
    expect(documentRichInlineFromJson({ type: "heading", content: json })).toEqual([{ kind: "text", text: "\nTitle", format: bold }]);
  });
});
