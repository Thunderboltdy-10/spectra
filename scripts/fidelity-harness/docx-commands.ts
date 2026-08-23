import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Document, WML_NAMESPACE } from "@ariadng/office/docx";
import { comparePackages } from "@ariadng/office/preservation";
import type { XmlElement } from "@ariadng/office/xml";
import {
  docxLens,
  type DocxProjection,
  type DocxProjectionBlock,
} from "../../src/features/spectra/lenses/docx-lens";
import {
  documentCommandBindings,
  documentStubHandlers,
} from "../../src/features/spectra/commands/office/document-commands";
import { commandForBinding } from "../../src/features/spectra/commands/registry";
import { gateOperation } from "../../src/features/spectra/commands/office/operation-gate";
import type { FidelityClass } from "../../src/features/spectra/commands/types";

/**
 * Command-level evidence for the document.
 *
 * The inventory's rule is that a promotion with no fixture is not a promotion.
 * Each `.fixture.json` beside a Word file names the commands that write into it,
 * the Word property each write is supposed to produce, and the parts that must
 * come back byte-identical. This module runs those rows against real
 * Word-authored files: it drives the projection the studio produces through the
 * lens, compares the saved package part by part, reopens the result and looks
 * for the property in the file rather than in the projection.
 *
 * A `refusedRegion` row is the other half, and the more important one. A button
 * that is greyed out with an honest sentence is worthless if the assistant does
 * the same edit anyway, so the row asserts that the operation gate refuses the
 * AI for the region the lens declared PRESERVED — the person and the assistant
 * hearing the same no.
 */

export type DocxFixtureMutationRow = {
  commandId: string;
  /** The artifact-registry operation the command declares. */
  operation: string;
  /** Part names this command is allowed to reserialize. */
  touch: string[];
  /** Part names that must be byte-identical afterwards. */
  preserve?: string[];
  /**
   * The Word property the write must produce, looked for in the saved file.
   * `attribute` is required whenever the property may already exist, because a
   * reused element proves nothing on its own.
   */
  proof?: {
    container: "pPr" | "rPr";
    property: string;
    attribute?: { name: string; value: string };
  };
};

export type DocxFixtureRefusalRow = {
  commandId: string;
  /** The fidelity region the linked file preserves. */
  region: string;
};

export type DocxFixtureSidecar = {
  source?: string;
  contains?: string[];
  expected?: Record<string, string>;
  mutations?: DocxFixtureMutationRow[];
  refusedRegions?: DocxFixtureRefusalRow[];
};

export type DocxCommandAssertion = {
  fixture: string;
  commandId: string;
  operation: string;
  changedParts: string[];
  /** Every part the row claimed to touch actually changed. */
  touchedAsDeclared: boolean;
  /** Nothing outside the claim changed. */
  noCollateralChange: boolean;
  /** Every part the row claimed to preserve is byte-identical. */
  preserved: boolean;
  /** The write is visible in the reopened file, not only in the projection. */
  readBack: boolean;
  notes?: string;
};

export type DocxRefusalAssertion = {
  fixture: string;
  commandId: string;
  region: string;
  /** The lens declared this region PRESERVED for this file. */
  regionPreserved: boolean;
  /** The control is not enabled for the person. */
  humanRefused: boolean;
  /** Every operation the command declares is refused for the assistant too. */
  assistantRefused: boolean;
  /** The sentence the person reads on the disabled control. */
  reason?: string;
  /** Operations the command declares; empty means the assistant cannot ask. */
  operations: string[];
  notes?: string;
};

const documentCommands = documentCommandBindings(documentStubHandlers()).map(
  (binding, order) => commandForBinding("document", binding, order),
);
const commandsById = new Map(documentCommands.map((command) => [command.id, command]));

function descendants(root: XmlElement): XmlElement[] {
  const found = [root];
  for (const child of root.children) {
    if (child.kind === "element") found.push(...descendants(child));
  }
  return found;
}

/** How many times the claimed Word property appears in the main part. */
async function propertyCount(payload: Uint8Array, proof: NonNullable<DocxFixtureMutationRow["proof"]>) {
  const document = await Document.open(payload);
  return descendants(document.body()).filter(
    (element) =>
      element.namespaceUri() === WML_NAMESPACE &&
      element.localName === proof.property &&
      element.parent?.namespaceUri() === WML_NAMESPACE &&
      element.parent?.localName === proof.container &&
      (!proof.attribute ||
        element.getAttributeNs(WML_NAMESPACE, proof.attribute.name) ===
          proof.attribute.value),
  ).length;
}

/** The fidelity map the studio contract builds, keyed the same way. */
function fidelityByFeature(entries: readonly { feature: string; class: string }[]) {
  return entries.reduce<Record<string, FidelityClass>>(
    (result, entry) => {
      if (
        entry.class === "NATIVE" ||
        entry.class === "EQUIVALENT" ||
        entry.class === "PRESERVED" ||
        entry.class === "EXTENSION"
      )
        result[entry.feature] = entry.class;
      return result;
    },
    { artifact: "NATIVE" },
  );
}

/**
 * The paragraph a person would actually be formatting.
 *
 * Editable is not enough: a paragraph whose only run holds a picture or a text
 * box has no text to select, so pressing Bold there proves nothing about
 * character formatting. Prefer a paragraph with real text and fall back only
 * when the fixture has none.
 */
function firstEditableParagraph(projection: DocxProjection) {
  const editable = projection.blocks.filter(
    (block) => block.type !== "table" && block.attrs?.nativeReadOnly !== true,
  );
  return editable.find((block) => block.text.trim().length > 0) ?? editable[0];
}

function withAttrs(block: DocxProjectionBlock, patch: Record<string, unknown>) {
  return { ...block, attrs: { ...(block.attrs ?? {}), ...patch } };
}

function mergeFormat(block: DocxProjectionBlock, key: string, patch: Record<string, unknown>) {
  const current = (block.attrs?.[key] ?? {}) as Record<string, unknown>;
  return withAttrs(block, { [key]: { ...current, ...patch } });
}

/**
 * What each command does to the projection. This is the studio's own shape, not
 * a harness invention: the format bar writes exactly these attributes, so a row
 * that passes here is evidence for the button rather than for the test.
 */
/**
 * Bold, italic, underline and strike are toggles, so the row flips whatever the
 * file already resolves to. On a heading that a Word style already makes bold,
 * that means proving the *off* write — `w:b w:val="0"`, which is the only form
 * Word reads as "not bold here" when the style says otherwise (§17.7.3).
 */
function toggle(block: DocxProjectionBlock, field: "bold" | "italic" | "underline" | "strike") {
  const current = (block.attrs?.format ?? {}) as Record<string, unknown>;
  return mergeFormat(block, "format", { [field]: current[field] !== true });
}

const EDITS: Record<string, (block: DocxProjectionBlock) => DocxProjectionBlock> = {
  "document.format.bold": (block) => toggle(block, "bold"),
  "document.format.italic": (block) => toggle(block, "italic"),
  "document.format.underline": (block) => toggle(block, "underline"),
  "document.format.strike": (block) => toggle(block, "strike"),
  "document.format.fontFamily": (block) =>
    mergeFormat(block, "format", { fontFamily: "Georgia" }),
  "document.format.fontSize": (block) =>
    mergeFormat(block, "format", { fontSizePoints: 13 }),
  "document.format.color": (block) => mergeFormat(block, "format", { color: "1F3A2E" }),
  "document.format.highlight": (block) =>
    mergeFormat(block, "format", { shading: "FEF0C7" }),
  "document.format.align": (block) =>
    mergeFormat(block, "paragraphFormat", { alignment: "center" }),
  "document.format.lineSpacing": (block) =>
    mergeFormat(block, "paragraphFormat", { lineSpacing: 1.5 }),
  "document.format.paragraphSpacing": (block) =>
    mergeFormat(block, "paragraphFormat", { spacingAfterPoints: 18 }),
  // Indent is a step, not a target: the button moves the paragraph one level
  // from wherever the file already has it. Reading the projected level first is
  // what the studio does, so the row proves the step rather than a fixed value.
  "document.format.indent.increase": (block) =>
    mergeFormat(block, "paragraphFormat", {
      indentLevel:
        Number(
          (block.attrs?.paragraphFormat as { indentLevel?: number } | undefined)
            ?.indentLevel ?? 0,
        ) + 1,
    }),
  "document.format.border": (block) =>
    mergeFormat(block, "paragraphFormat", { border: "all" }),
  "document.format.shading": (block) =>
    mergeFormat(block, "paragraphFormat", { shading: "F2F4F7" }),
  "document.format.style": (block) => withAttrs(block, { styleId: "Heading2" }),
};

export async function runDocxCommandFixtures(fixtureDir: string) {
  const assertions: DocxCommandAssertion[] = [];
  const refusals: DocxRefusalAssertion[] = [];
  const failures: string[] = [];
  const names = await readdir(fixtureDir);
  const sidecars = names.filter((name) => name.endsWith(".fixture.json")).sort();

  for (const file of sidecars) {
    const stem = file.replace(/\.fixture\.json$/, "");
    const sidecar = JSON.parse(
      await readFile(join(fixtureDir, file), "utf8"),
    ) as DocxFixtureSidecar;
    if (!sidecar.mutations?.length && !sidecar.refusedRegions?.length) continue;
    const documentName = names.find((name) =>
      new RegExp(`^${stem}\\.(docx|docm|dotx|dotm)$`, "i").test(name),
    );
    if (!documentName) {
      failures.push(`${stem}: the sidecar names no Word file beside it`);
      continue;
    }
    const source = new Uint8Array(await readFile(join(fixtureDir, documentName)));
    const opened = await docxLens.open(source, "strict-native");

    for (const row of sidecar.mutations ?? []) {
      const note = (notes: string) => {
        failures.push(`${stem} · ${row.commandId}: ${notes}`);
        assertions.push({
          fixture: stem,
          commandId: row.commandId,
          operation: row.operation,
          changedParts: [],
          touchedAsDeclared: false,
          noCollateralChange: false,
          preserved: false,
          readBack: false,
          notes,
        });
      };
      const command = commandsById.get(row.commandId);
      if (!command) {
        note("no document command has this id, so the row indexes nothing");
        continue;
      }
      if (!(command.manifestOps ?? []).includes(row.operation)) {
        note(`the command does not declare the operation "${row.operation}"`);
        continue;
      }
      const edit = EDITS[row.commandId];
      if (!edit) {
        note("no evidence path is registered for this command id");
        continue;
      }
      const paragraph = firstEditableParagraph(opened.projection);
      if (!paragraph) {
        note("this fixture has no paragraph the lens may write to");
        continue;
      }
      const before = row.proof ? await propertyCount(source, row.proof) : 0;
      const output = await docxLens.materialize({
        projection: {
          ...opened.projection,
          blocks: opened.projection.blocks.map((block) =>
            block.id === paragraph.id ? edit(block) : block,
          ),
        },
        carry: opened.preservedCarry,
      });
      const comparison = await comparePackages(source, output);
      const changedParts = comparison.parts
        .filter((part) => part.verdict !== "identical")
        .map((part) => part.name);
      const touchedAsDeclared = row.touch.every((part) =>
        changedParts.some((changed) => changed === part.replace(/^\//, "")),
      );
      const noCollateralChange = changedParts.every((changed) =>
        row.touch.some((part) => part.replace(/^\//, "") === changed),
      );
      const preserved = (row.preserve ?? []).every((part) => {
        const wanted = part.replace(/^\//, "").toLowerCase();
        return comparison.parts
          .filter((candidate) => candidate.name.toLowerCase().startsWith(wanted))
          .every((candidate) => candidate.verdict === "identical");
      });
      const readBack = row.proof
        ? (await propertyCount(output, row.proof)) > before
        : (await docxLens.open(output)).projection.blocks.length > 0;
      const assertion: DocxCommandAssertion = {
        fixture: stem,
        commandId: row.commandId,
        operation: row.operation,
        changedParts,
        touchedAsDeclared,
        noCollateralChange,
        preserved,
        readBack,
      };
      assertions.push(assertion);
      if (!touchedAsDeclared || !noCollateralChange || !preserved || !readBack)
        failures.push(
          `${stem} · ${row.commandId}: ${JSON.stringify({
            touchedAsDeclared,
            noCollateralChange,
            preserved,
            readBack,
            changedParts,
          })}`,
        );
    }

    const fidelity = fidelityByFeature(opened.fidelityMap.entries);
    const bindings = documentCommandBindings(documentStubHandlers());
    for (const row of sidecar.refusedRegions ?? []) {
      const command = commandsById.get(row.commandId);
      if (!command) {
        failures.push(`${stem} · ${row.commandId}: no document command has this id`);
        continue;
      }
      // The row is only meaningful if the lens really preserves the region. A
      // refusal proved against a region the file does not have proves nothing.
      const regionPreserved = fidelity[row.region] === "PRESERVED";
      const humanState = command.availability({
        workType: "document",
        can: () => true,
        compatibilityProfile: "strict-native",
        fidelity,
        selection: { ids: [] },
        permissions: { role: "edit", editable: true },
      });
      const humanRefused = humanState.state !== "enabled";
      const operations = [...(command.manifestOps ?? [])];
      const gates = operations.map((operation) =>
        gateOperation({
          type: "document",
          operation,
          bindings,
          compatibilityProfile: "strict-native",
          fidelity,
        }),
      );
      // No declared operation is not a hole: the assistant has no way to ask for
      // this at all, which is a stronger refusal than a gated one.
      const assistantRefused = gates.every((gate) => !gate.allowed);
      const reason =
        humanState.state === "disabled"
          ? humanState.reason
          : gates.find((gate) => !gate.allowed && "reason" in gate)?.reason;
      refusals.push({
        fixture: stem,
        commandId: row.commandId,
        region: row.region,
        regionPreserved,
        humanRefused,
        assistantRefused,
        operations,
        ...(reason ? { reason } : {}),
      });
      if (!regionPreserved || !humanRefused || !assistantRefused)
        failures.push(
          `${stem} · ${row.commandId}: ${JSON.stringify({
            region: row.region,
            regionPreserved,
            humanRefused,
            assistantRefused,
          })}. The person and the assistant must hear the same no.`,
        );
    }
  }

  return { assertions, refusals, failures };
}
