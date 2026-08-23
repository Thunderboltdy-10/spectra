import { describe, expect, it } from "vitest";
import {
  documentCommandBindings,
  documentStubHandlers,
} from "../commands/office/document-commands";
import {
  sheetsCommandBindings,
  sheetsStubHandlers,
} from "../commands/office/sheets-commands";
import {
  presentationCommandBindings,
  presentationStubHandlers,
  PRESENTATION_CAPABILITY_DEFERRALS,
} from "../commands/office/presentation-commands";
import { SHEETS_CAPABILITY_DEFERRALS } from "../commands/office/sheets-commands";
import {
  capabilityMatrixIssues,
  capabilityMatrixRows,
  capabilityMatrixSummary,
} from "../commands/office/capability-matrix";
import {
  officeCapabilityAudit,
  officeCapabilityAuditIssues,
  officeCapabilityAuditSummary,
} from "../commands/office/capability-audit";
import type { OfficeCapabilityDeferral } from "../commands/office/capability-audit";
import { allTabsFor, contextualTabsFor } from "../commands";
import type { CommandBinding } from "../commands";
import type { WorkType } from "../work/registry";

/**
 * The mission gate for the three Office editors.
 *
 * The claim this pass has to earn is that a normal person can do the work in
 * Spectra, and that the assistant can do exactly what they can do and nothing
 * more. Neither half is provable from a screenshot: a bar photographs the same
 * whether its buttons are wired or inert, and an AI that quietly exceeds the
 * human surface looks like a very capable AI right up until someone tries to
 * check its work.
 *
 * So each type declares its whole command set as a pure function of its handlers,
 * and this file audits the declaration. It runs with stub handlers, which is why
 * the modules export them: no editor, no grid, no deck, no browser.
 *
 * A failure here is a real defect, not a strictness knob. Loosening an assertion
 * to get green is how the ghosts came back last time.
 */

const SETS: ReadonlyArray<{
  type: WorkType;
  bindings: readonly CommandBinding[];
  /** The contract's named General defaults for this type (§2). */
  generalDefaults: readonly string[];
  /**
   * What this type has deliberately not built, in its own words. The list lives
   * with the commands rather than here, so a deferral is written by whoever
   * decided it and the audit reads the same sentence a person would be shown.
   */
  deferrals: readonly OfficeCapabilityDeferral[];
}> = [
  {
    type: "document",
    bindings: documentCommandBindings(documentStubHandlers()),
    deferrals: [],
    generalDefaults: [
      "document.navigate.find",
      "document.history.undo",
      "document.history.redo",
      "document.format.fontFamily",
      "document.format.fontSize",
      "document.format.bold",
      "document.format.italic",
    ],
  },
  {
    type: "sheets",
    bindings: sheetsCommandBindings(sheetsStubHandlers()),
    deferrals: SHEETS_CAPABILITY_DEFERRALS,
    generalDefaults: [
      "sheets.history.undo",
      "sheets.history.redo",
      "sheets.navigate.find",
    ],
  },
  {
    type: "presentation",
    bindings: presentationCommandBindings(presentationStubHandlers()),
    deferrals: PRESENTATION_CAPABILITY_DEFERRALS,
    generalDefaults: [
      "presentation.history.undo",
      "presentation.history.redo",
    ],
  },
];

describe.each(SETS)("$type command set", ({ type, bindings, generalDefaults, deferrals }) => {
  const rows = capabilityMatrixRows(type, bindings);

  it("violates none of the protocol rules", () => {
    // The issues are sentences on purpose. A count tells you something broke; a
    // sentence tells you what to do about it.
    expect(capabilityMatrixIssues(type, rows, { requiredGeneral: generalDefaults })).toEqual([]);
  });

  it("registers one implementation per command id", () => {
    const ids = rows.map((row) => row.commandId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("places every command in a tab this type actually has", () => {
    const tabs = new Set(allTabsFor(type));
    const stray = rows.filter((row) => !tabs.has(row.tab)).map((row) => `${row.commandId} → ${row.tab}`);
    expect(stray).toEqual([]);
  });

  it("populates every tab it ships, including the contextual ones", () => {
    const populated = new Set(rows.flatMap((row) => [row.tab, row.sourceTab]));
    const empty = allTabsFor(type).filter((tab) => !populated.has(tab));
    // A tab that opens onto nothing is worse than no tab: it reads as a feature
    // that has been taken away.
    expect(empty).toEqual([]);
  });

  it("raises contextual tabs only from a selection this type can have", () => {
    const allowed = new Set(contextualTabsFor(type));
    const stray = rows
      .filter((row) => row.contextualTab && !allowed.has(row.contextualTab))
      .map((row) => `${row.commandId} → ${row.contextualTab}`);
    expect(stray).toEqual([]);
  });

  it("keeps General a favourites surface rather than a dumping ground", () => {
    const general = rows.filter((row) => row.general);
    for (const required of generalDefaults) {
      expect(general.map((row) => row.commandId)).toContain(required);
    }
    // Every pinned command still remembers the category it shipped from, so
    // unpinning returns it somewhere sensible instead of stranding it.
    for (const row of general) {
      expect(row.sourceTab).toBeTruthy();
    }
  });

  it("states a consequence before doing anything destructive", () => {
    const unexplained = rows
      .filter((row) => row.risk === "destructive" && !row.hint)
      .map((row) => row.commandId);
    expect(unexplained).toEqual([]);
  });

  it("gives every native write a reversal or an explanation", () => {
    const NATIVE = new Set([
      "body", "styles", "lists", "tables", "images", "equations", "headersFooters",
      "footnotes", "fields", "sections", "cells", "formulas", "numberFormats",
      "charts", "validation", "conditionalFormat", "namedRanges", "slides",
      "layouts", "shapes", "speakerNotes", "media",
    ]);
    const unreversible = rows
      .filter((row) =>
        row.touches.some((region) => NATIVE.has(region)) &&
        row.undo === "none(explain)" &&
        !row.hint)
      .map((row) => row.commandId);
    // "none(explain)" is a promise to explain. Without a hint there is nothing
    // to read, and the person finds out by losing work.
    expect(unreversible).toEqual([]);
  });

  it("never claims it can edit what Spectra only preserves", () => {
    const PRESERVE_ONLY = new Set([
      "macros", "customXml", "smartArt", "ole", "trackedChanges", "pivotTables", "masters",
    ]);
    const overclaimed = rows
      .flatMap((row) => row.touches.filter((region) => PRESERVE_ONLY.has(region)).map((region) => `${row.commandId}: ${region}`));
    expect(overclaimed).toEqual([]);
  });

  it("labels every command in words that fit the bar", () => {
    const bad = rows
      .filter((row) => !row.title.trim() || row.title.length > 32)
      .map((row) => `${row.commandId}: "${row.title}"`);
    expect(bad).toEqual([]);
  });

  it("leaves the assistant nothing it can do that a person cannot", () => {
    const audit = officeCapabilityAudit(type, bindings, deferrals);
    const aiOnly = audit
      .filter((entry) => entry.status === "ai-only")
      .map((entry) => entry.operation);
    // Every operation must be reachable by hand, be a read of what is already on
    // screen, be a gesture the person already has, or carry a written deferral.
    expect(aiOnly).toEqual([]);
  });

  it("names an honest path for every manifest operation", () => {
    expect(officeCapabilityAuditIssues(type, bindings, deferrals)).toEqual([]);
    const summary = officeCapabilityAuditSummary(
      officeCapabilityAudit(type, bindings, deferrals),
    );
    expect(summary.registered + summary.inspection + summary.direct + summary.deferred)
      .toBe(summary.total);
  });

  it("states a deferral in words a person could be shown, or does not defer", () => {
    // A deferral is the one honest way to have no command for an operation, and
    // it is only honest if it says what Spectra does instead. "Coming soon" and
    // "not yet supported" are the sentences this is here to keep out.
    for (const deferral of deferrals) {
      expect(deferral.reason.trim().length).toBeGreaterThan(40);
      expect(deferral.reason).toMatch(/[.!]$/);
      expect(deferral.reason.toLowerCase()).not.toMatch(
        /coming soon|not yet supported|todo|later|in a future release|for now/,
      );
    }
  });

  it("is a serious editor by size, not a demo", () => {
    const summary = capabilityMatrixSummary(rows);
    // Word, Excel and PowerPoint are not beaten with fifteen buttons. This is a
    // floor, not a target: it catches a regression that silently drops a family.
    expect(summary.total).toBeGreaterThanOrEqual(60);
    // And a serious editor is not all buttons — pickers, steppers and colour
    // wells are how formatting stops being a trip to a dialog.
    expect(summary.controls).toBeGreaterThanOrEqual(8);
  });
});
