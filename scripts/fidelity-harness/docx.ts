import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Document, WML_NAMESPACE } from "@ariadng/office/docx";
import { comparePackages } from "@ariadng/office/preservation";
import type { XmlElement } from "@ariadng/office/xml";
import {
  DocxLensError,
  docxLens,
  type DocxProjection,
} from "../../src/features/spectra/lenses/docx-lens";
import {
  documentCommandBindings,
  documentStubHandlers,
} from "../../src/features/spectra/commands/office/document-commands";
import { commandForBinding } from "../../src/features/spectra/commands/registry";
import { runDocxCommandFixtures } from "./docx-commands";

/**
 * Every mutation names the manifest operation it exercises and the workbar
 * commands that declare that operation, so the report can be read the way a
 * reviewer actually asks the question: "this button says it writes to Word —
 * where is the proof?" A native write with no fixture row is a claim with no
 * evidence, and the row is indexed by command id so the absence is visible.
 */
const documentCommands = documentCommandBindings(documentStubHandlers()).map(
  (binding, order) => commandForBinding("document", binding, order),
);

function commandsForOperation(operation: string) {
  return documentCommands
    .filter((command) => (command.manifestOps ?? []).includes(operation))
    .map((command) => command.id)
    .sort();
}

type MutationReport = {
  fixture: string;
  mutation: string;
  /** The artifact-registry operation this mutation stands as evidence for. */
  operation?: string;
  /** Workbar commands that declare that operation. */
  commandIds?: string[];
  status:
    | "round-trip preservation"
    | "mutation safety"
    | "unsupported-but-preserved"
    | "unsupported-read-only"
    | "genuinely unsupported file";
  changedParts: string[];
  semanticDigest?: string;
  detail: string;
};

const fixtureRoot = join(process.cwd(), "fixtures", "office", "docx");
const reportPath = join(fixtureRoot, "harness-report.json");
const forbidden = new Set(["password-protected.docx", "corrupt.docx"]);

function elements(root: XmlElement): XmlElement[] {
  const result = [root];
  for (const child of root.children) {
    if (child.kind === "element") result.push(...elements(child));
  }
  return result;
}

async function featureFacts(payload: Uint8Array) {
  const document = await Document.open(payload);
  const main = elements(document.body());
  const countWml = (...names: string[]) =>
    main.filter(
      (element) =>
        element.namespaceUri() === WML_NAMESPACE && names.includes(element.localName),
    ).length;
  const parts = document.office.package.parts();
  let bibliographySources = 0;
  for (const part of parts.filter((candidate) =>
    candidate.name.toLowerCase().startsWith("/customxml/"),
  )) {
    const text = new TextDecoder().decode(await part.read());
    bibliographySources += (text.match(/<(?:\w+:)?Source\b/g) ?? []).length;
  }
  return {
    field: countWml("fldChar", "instrText"),
    trackedChange: countWml(
      "ins",
      "del",
      "moveFrom",
      "moveTo",
      "rPrChange",
      "pPrChange",
      "tblPrChange",
      "trPrChange",
      "tcPrChange",
    ),
    contentControl: countWml("sdt"),
    // A text box lives in the same part Spectra rewrites, and its anchor is an
    // ordinary editable paragraph. So "only document.xml changed" proves nothing
    // here; the box has to be counted before and after each edit.
    textBox: countWml("txbxContent"),
    bibliographySource: bibliographySources,
    embeddedOle: parts.filter((part) =>
      part.name.toLowerCase().includes("/embeddings/"),
    ).length,
    customXml: parts.filter((part) =>
      part.name.toLowerCase().startsWith("/customxml/"),
    ).length,
    macro: parts.filter((part) => /vbaProject\.bin$/i.test(part.name)).length,
  };
}

function cloneProjection(projection: DocxProjection) {
  return structuredClone(projection);
}

/**
 * The paragraph a person would be editing.
 *
 * A paragraph whose only run holds a picture or a text box is editable but has
 * no text, so formatting it proves nothing. Prefer one with text; fall back for
 * fixtures that have none.
 */
function firstEditableParagraph(projection: DocxProjection) {
  const editable = projection.blocks.filter(
    (block) => block.type !== "table" && block.attrs?.nativeReadOnly !== true,
  );
  return editable.find((block) => block.text.trim().length > 0) ?? editable[0];
}

function firstEditableTable(projection: DocxProjection) {
  return projection.blocks.find(
    (block) => block.type === "table" && block.attrs?.nativeReadOnly !== true,
  );
}

async function verifyOutput(
  source: Uint8Array,
  output: Uint8Array,
  allowedChangedParts = new Set(["word/document.xml"]),
) {
  const comparison = await comparePackages(source, output);
  const changed = comparison.parts
    .filter((part) => part.verdict !== "identical")
    .map((part) => part.name);
  const collateral = changed.filter((part) => !allowedChangedParts.has(part));
  if (collateral.length)
    throw new Error(`collateral package rewrite: ${collateral.join(", ")}`);
  await docxLens.open(output);
  return changed;
}

async function mutateProjection(
  source: Uint8Array,
  mutation: string,
) {
  const opened = await docxLens.open(source);
  const projection = cloneProjection(opened.projection);
  const paragraph = firstEditableParagraph(projection);
  if (!paragraph)
    return { status: "unsupported-read-only" as const, detail: "no safely editable paragraph", output: source };

  if (mutation === "edit one paragraph") {
    paragraph.text = `${paragraph.text} [Spectra paragraph edit]`;
  } else if (mutation === "edit a table cell") {
    const table = firstEditableTable(projection);
    if (!table)
      return { status: "unsupported-read-only" as const, detail: "no safely editable table region", output: source };
    const rows = table.text.split(/\r?\n/);
    const cells = (rows[0] ?? "").split("|");
    cells[0] = `${cells[0]?.trim() ?? ""} [Spectra cell edit]`;
    rows[0] = cells.join(" | ");
    table.text = rows.join("\n");
  } else if (mutation === "insert a paragraph") {
    projection.blocks.push({
      id: `spectra:insert:${projection.blocks.length}`,
      type: "paragraph",
      text: "Inserted by the Spectra fidelity harness.",
    });
  } else if (mutation === "apply a style") {
    paragraph.attrs = { ...paragraph.attrs, styleId: "Heading2" };
  } else if (mutation === "format the runs") {
    // Direct run formatting, the way the Format tab writes it: the projection
    // carries what the file already agreed on, and only the changed properties
    // become `w:rPr` mutations.
    paragraph.attrs = {
      ...paragraph.attrs,
      format: {
        ...(paragraph.attrs?.format as Record<string, unknown> | undefined),
        bold: true,
        italic: true,
        underline: true,
        fontFamily: "Georgia",
        fontSizePoints: 13,
        color: "1F3A2E",
        shading: "FEF0C7",
      },
    };
  } else if (mutation === "format the paragraph") {
    paragraph.attrs = {
      ...paragraph.attrs,
      paragraphFormat: {
        ...(paragraph.attrs?.paragraphFormat as Record<string, unknown> | undefined),
        alignment: "center",
        lineSpacing: 1.5,
        spacingAfterPoints: 12,
        indentLevel: 1,
        border: "all",
        shading: "F2F4F7",
      },
    };
  } else if (mutation === "AI edit via operations") {
    const output = await docxLens.mutate(opened.preservedCarry, {
      kind: "ai-edit",
      operations: [
        {
          kind: "replace-paragraph",
          regionId: paragraph.id,
          text: `${paragraph.text} [AI edit]`,
        },
        { kind: "insert-paragraph", text: "AI inserted this safe paragraph." },
      ],
    });
    return { status: "mutation safety" as const, detail: "AI received only lens-valid operations", output };
  }
  return {
    status: "mutation safety" as const,
    detail: "targeted semantic mutation materialized",
    output: await docxLens.materialize({
      projection,
      carry: opened.preservedCarry,
    }),
  };
}

async function run() {
  const fixtureNames = (await readdir(fixtureRoot))
    .filter((name) => /\.(?:docx|docm)$/i.test(name))
    .sort();
  const rows: MutationReport[] = [];

  for (const fixture of fixtureNames) {
    const source = new Uint8Array(await readFile(join(fixtureRoot, fixture)));
    if (forbidden.has(fixture)) {
      let error: unknown;
      try {
        await docxLens.open(source);
      } catch (caught) {
        error = caught;
      }
      const expectedCode = fixture.startsWith("password")
        ? "DOCX_PASSWORD_PROTECTED"
        : "DOCX_CORRUPT";
      if (!(error instanceof DocxLensError) || error.code !== expectedCode)
        throw new Error(`${fixture} did not fail honestly as ${expectedCode}`);
      rows.push({
        fixture,
        mutation: "open",
        status: "genuinely unsupported file",
        changedParts: [],
        detail: error.message,
      });
      continue;
    }

    const opened = await docxLens.open(source);
    const noOp = await docxLens.materialize({
      projection: cloneProjection(opened.projection),
      carry: opened.preservedCarry,
    });
    if (!Buffer.from(source).equals(Buffer.from(noOp)))
      throw new Error(`${fixture} no-op was not byte-identical`);
    rows.push({
      fixture,
      mutation: "no-op open+save",
      status: "round-trip preservation",
      changedParts: [],
      semanticDigest: opened.projection.nativeBinding.semanticDigest,
      detail: "package bytes identical",
    });

    for (const [mutation, operation] of [
      ["edit one paragraph", "rewrite_blocks"],
      ["edit a table cell", "edit_table_cell"],
      ["insert a paragraph", "insert_blocks"],
      ["apply a style", "format_blocks"],
      ["format the runs", "format_blocks"],
      ["format the paragraph", "format_blocks"],
      ["AI edit via operations", "rewrite_blocks"],
    ] as const) {
      const result = await mutateProjection(source, mutation);
      const indexed = {
        operation,
        ...(commandsForOperation(operation).length
          ? { commandIds: commandsForOperation(operation) }
          : {}),
      };
      if (result.status === "unsupported-read-only") {
        rows.push({
          fixture,
          mutation,
          ...indexed,
          status: result.status,
          changedParts: [],
          detail: result.detail,
        });
        continue;
      }
      const changedParts = await verifyOutput(source, result.output);
      const reopened = await docxLens.open(result.output);
      rows.push({
        fixture,
        mutation,
        ...indexed,
        status: result.status,
        changedParts,
        semanticDigest: reopened.projection.nativeBinding.semanticDigest,
        detail: result.detail,
      });
    }
  }

  const spotFixtures: Record<string, keyof Awaited<ReturnType<typeof featureFacts>>> = {
    "fields-toc.docx": "field",
    "tracked-changes.docx": "trackedChange",
    "bibliography-source.docx": "bibliographySource",
    "embedded-ole.docx": "embeddedOle",
    "content-controls-customxml.docx": "customXml",
    "floating-textbox.docx": "textBox",
  };
  const spotProofs: Array<{
    fixture: string;
    xpath: string;
    baseline: number;
    afterEachEdit: number[];
  }> = [];
  const xpathByFeature: Record<string, string> = {
    field: "count(/w:document/w:body//w:fldChar | /w:document/w:body//w:instrText)",
    trackedChange: "count(/w:document/w:body//w:ins | /w:document/w:body//w:del)",
    bibliographySource: "count(/pkg:package/pkg:part[@name='/customXml/item1.xml']//b:Source)",
    embeddedOle: "count(/pkg:package/pkg:part[contains(@name,'/embeddings/')])",
    customXml: "count(/pkg:package/pkg:part[starts-with(@name,'/customXml/')])",
    textBox: "count(/w:document/w:body//w:txbxContent)",
  };
  for (const [fixture, feature] of Object.entries(spotFixtures)) {
    let payload: Uint8Array = new Uint8Array(
      await readFile(join(fixtureRoot, fixture)),
    );
    const baseline = (await featureFacts(payload))[feature];
    if (baseline < 1) throw new Error(`${fixture} lacks expected ${feature}`);
    const afterEachEdit: number[] = [];
    for (const mutation of [
      "insert a paragraph",
      "edit one paragraph",
      "apply a style",
      "format the runs",
      "format the paragraph",
    ]) {
      const result = await mutateProjection(payload, mutation);
      if (result.status === "unsupported-read-only")
        throw new Error(`${fixture} cannot run spot-proof mutation ${mutation}`);
      payload = result.output;
      const count = (await featureFacts(payload))[feature];
      if (count !== baseline)
        throw new Error(`${fixture} lost ${feature} after ${mutation}: ${baseline} -> ${count}`);
      afterEachEdit.push(count);
    }
    spotProofs.push({
      fixture,
      xpath: xpathByFeature[feature],
      baseline,
      afterEachEdit,
    });
  }

  const commandEvidence = await runDocxCommandFixtures(fixtureRoot);

  const report = {
    harness: "Spectra DOCX fidelity harness v1",
    generatedAt: new Date().toISOString(),
    source: "Microsoft Open XML SDK public test assets (MIT)",
    vocabulary: [
      "render fidelity",
      "semantic fidelity",
      "mutation safety",
      "round-trip preservation",
      "unsupported-but-preserved",
      "unsupported-read-only",
      "genuinely unsupported file",
    ],
    summary: {
      fixtures: fixtureNames.length,
      assertions:
        rows.length +
        spotProofs.length * 5 +
        commandEvidence.assertions.length +
        commandEvidence.refusals.length,
      failed: commandEvidence.failures.length,
    },
    rows,
    spotProofs,
    commandFixtures: commandEvidence.assertions,
    refusalFixtures: commandEvidence.refusals,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  // The report is written first so a failure leaves the evidence on disk to read,
  // then the failure is raised: a harness that prints green with failed rows in
  // its own report is worse than no harness.
  if (commandEvidence.failures.length)
    throw new Error(
      `command fixture evidence failed:\n${commandEvidence.failures.join("\n")}`,
    );
  process.stdout.write(
    `${report.summary.fixtures} fixtures · ${report.summary.assertions} assertions · green\n${relative(process.cwd(), reportPath)}\n`,
  );
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
