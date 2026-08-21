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

type MutationReport = {
  fixture: string;
  mutation: string;
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

function firstEditableParagraph(projection: DocxProjection) {
  return projection.blocks.find(
    (block) =>
      block.type !== "table" && block.attrs?.nativeReadOnly !== true,
  );
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

    for (const mutation of [
      "edit one paragraph",
      "edit a table cell",
      "insert a paragraph",
      "apply a style",
      "AI edit via operations",
    ]) {
      const result = await mutateProjection(source, mutation);
      if (result.status === "unsupported-read-only") {
        rows.push({
          fixture,
          mutation,
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
  };
  for (const [fixture, feature] of Object.entries(spotFixtures)) {
    let payload: Uint8Array = new Uint8Array(
      await readFile(join(fixtureRoot, fixture)),
    );
    const baseline = (await featureFacts(payload))[feature];
    if (baseline < 1) throw new Error(`${fixture} lacks expected ${feature}`);
    const afterEachEdit: number[] = [];
    for (const mutation of ["insert a paragraph", "edit one paragraph", "apply a style"]) {
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
      assertions: rows.length + spotProofs.length * 3,
      failed: 0,
    },
    rows,
    spotProofs,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${report.summary.fixtures} fixtures · ${report.summary.assertions} assertions · green\n${relative(process.cwd(), reportPath)}\n`,
  );
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
