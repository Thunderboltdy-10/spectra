import { describe, expect, it } from "vitest";
import {
  SHEETS_FUNCTION_LIBRARY,
  SHEETS_GENERAL_DEFAULTS,
  sheetsCommandBindings,
  sheetsStubHandlers,
  type SheetsCommandHandlers,
} from "../commands/office/sheets-commands";
import {
  capabilityMatrixIssues,
  capabilityMatrixRows,
  capabilityMatrixSummary,
} from "../commands/office/capability-matrix";
import {
  officeCapabilityAudit,
  officeCapabilityAuditIssues,
  officeCapabilityAuditSummary,
  officeOperationsFor,
} from "../commands/office/capability-audit";
import {
  gateOperation,
  refusedOperations,
} from "../commands/office/operation-gate";
import { SHEETS_CAPABILITY_DEFERRALS } from "../commands/office/sheets-commands";
import { COMMAND_TABS, commandForBinding } from "../commands/registry";
import type { CommandContext } from "../commands/types";
import { requireArtifactTypeManifest } from "../artifacts/registry";

/**
 * The Sheets command surface, audited mechanically.
 *
 * A workbar button that looks right and does nothing photographs exactly like
 * one that works, so the proof cannot be a screenshot. These tests assert the
 * three things a screenshot cannot: every verb is one registered command, every
 * tab a person can open has something in it, and every operation the assistant
 * can perform is also reachable by hand (C1/C2).
 */

/** The manifest operation ids the artifact registry declares for sheets. */
const SHEETS_MANIFEST_OP_IDS = requireArtifactTypeManifest("sheets").operations;

/** `set_cells` as the registry spells it: `sheets.set.cells`. */
function manifestOpId(op: string) {
  return `sheets.${op.replaceAll("_", ".")}`;
}

/**
 * Operations that only read. They owe no human command: "inspect the workbook"
 * is what the grid already is.
 */
const INSPECTION_OP_IDS = new Set(
  [
    "inspect_workbook",
    "inspect_range",
    "inspect_dependencies",
    "analyze",
    "explain_formula",
    "validate",
  ].map(manifestOpId),
);

function bindings(overrides?: (handlers: SheetsCommandHandlers) => void) {
  const handlers = sheetsStubHandlers();
  overrides?.(handlers);
  return sheetsCommandBindings(handlers);
}

/** A linked workbook where the chart parts are preserved rather than editable. */
function preservedChartsContext(): CommandContext {
  return {
    workType: "sheets",
    can: () => true,
    compatibilityProfile: "strict-native",
    fidelity: { charts: "PRESERVED" },
    selection: { ids: [] },
    permissions: { role: "edit", editable: true },
  };
}

describe("sheets command bindings", () => {
  it("passes the capability matrix audit", () => {
    const rows = capabilityMatrixRows("sheets", bindings());
    const issues = capabilityMatrixIssues("sheets", rows, {
      requiredGeneral: SHEETS_GENERAL_DEFAULTS,
      manifestOps: SHEETS_MANIFEST_OP_IDS,
    });
    expect(issues).toEqual([]);
  });

  it("populates every static tab and both contextual tabs", () => {
    const rows = capabilityMatrixRows("sheets", bindings());
    const placed = new Set(rows.flatMap((row) => [row.tab, row.sourceTab]));
    for (const tab of ["General", ...COMMAND_TABS.sheets]) {
      expect(placed.has(tab), `tab ${tab} has no commands`).toBe(true);
    }
    const contextual = new Set(rows.map((row) => row.contextualTab).filter(Boolean));
    expect(contextual.has("Chart")).toBe(true);
    expect(contextual.has("Formula")).toBe(true);
  });

  it("pins the contract General defaults and nothing accidental", () => {
    const rows = capabilityMatrixRows("sheets", bindings());
    const general = rows.filter((row) => row.general).map((row) => row.commandId);
    for (const required of SHEETS_GENERAL_DEFAULTS) {
      expect(general, `${required} missing from General`).toContain(required);
    }
    // General is a favourites surface, not a dumping ground: the seven contract
    // defaults are the only commands that claim a front-row slot there. The rest
    // of General is overflow (export, zoom, clipboard), which sheds first.
    const essential = rows.filter((row) => row.general && row.priority === "essential");
    expect(essential.map((row) => row.commandId).sort()).toEqual([...SHEETS_GENERAL_DEFAULTS].sort());
  });

  it("gives the assistant no operation a person cannot reach", () => {
    const rows = capabilityMatrixRows("sheets", bindings());
    const covered = new Set(rows.flatMap((row) => row.manifestOps.map(manifestOpId)));
    const uncovered = SHEETS_MANIFEST_OP_IDS.filter(
      (op) => !INSPECTION_OP_IDS.has(op) && !covered.has(op),
    );
    expect(uncovered, "the assistant can do this and a person cannot").toEqual([]);
  });

  it("passes the office capability audit in both directions", () => {
    expect(
      officeCapabilityAuditIssues("sheets", bindings(), SHEETS_CAPABILITY_DEFERRALS),
    ).toEqual([]);
  });

  it("classifies every declared operation, with nothing AI-only", () => {
    const entries = officeCapabilityAudit(
      "sheets",
      bindings(),
      SHEETS_CAPABILITY_DEFERRALS,
    );
    const summary = officeCapabilityAuditSummary(entries);
    expect(summary.total).toBe(officeOperationsFor("sheets").length);
    expect(summary.aiOnly).toBe(0);
    expect(summary.deferred).toBe(0);
    // Nothing is left unclassified: every operation is either a command or a
    // reading of what the person already sees.
    expect(summary.registered + summary.inspection).toBe(summary.total);
    // Two of the six read-only operations have a command anyway — Analyse and
    // Explain this formula — which is stronger than owing none, so they count as
    // registered rather than as inspections.
    for (const entry of entries) {
      if (entry.status === "inspection") {
        expect(INSPECTION_OP_IDS.has(entry.operation)).toBe(true);
      }
      // An operation is a verb, so several commands may specialize it — "All
      // borders" and "Currency" are both `format_range`. What must not happen is
      // the same command claiming it twice, which would mean two execute paths
      // behind one id (C1).
      if (entry.status === "registered") {
        expect(new Set(entry.commandIds).size).toBe(entry.commandIds.length);
      }
    }
  });

  it("gates the assistant with the same sentence the person reads", () => {
    const set = bindings();
    // A linked workbook whose charts are preserved: the chart commands are
    // refused for both, in one voice.
    const refused = refusedOperations("sheets", set, "strict-native", {
      charts: "PRESERVED",
    });
    const chartOps = refused.map((entry) => entry.operation);
    expect(chartOps).toContain("sheets.create.chart");
    expect(chartOps).toContain("sheets.edit.chart");
    const gate = gateOperation({
      type: "sheets",
      operation: "create_chart",
      bindings: set,
      compatibilityProfile: "strict-native",
      fidelity: { charts: "PRESERVED" },
    });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      // The person's control and the assistant's refusal are the same string,
      // built from the same declaration. This is C2 in one assertion.
      const insert = commandForBinding(
        "sheets",
        set.find((binding) => binding.id === "chart.insert")!,
        0,
      );
      const availability = insert.availability(preservedChartsContext());
      expect(availability.state).toBe("disabled");
      expect(
        availability.state === "disabled" ? availability.reason : undefined,
      ).toBe(gate.reason);
    }
    // Cell writes are untouched by a chart-only preservation.
    expect(
      gateOperation({
        type: "sheets",
        operation: "set_cells",
        bindings: set,
        compatibilityProfile: "strict-native",
        fidelity: { charts: "PRESERVED" },
      }).allowed,
    ).toBe(true);
  });

  it("registers one implementation per id", () => {
    const ids = bindings().map((binding) => binding.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("routes every binding through a single execute", () => {
    const calls: string[] = [];
    const handlers = sheetsStubHandlers();
    // Rebuild the stub with recording handlers for the three families most often
    // duplicated in a studio: clipboard, formatting and structure.
    handlers.clipboard.paste = () => calls.push("paste");
    handlers.cellFormat.merge = () => calls.push("merge");
    handlers.structure.insertRow = () => calls.push("insertRow");
    const set = sheetsCommandBindings(handlers);
    const run = (id: string) => {
      const binding = set.find((candidate) => candidate.id === id);
      expect(binding, `${id} is not registered`).toBeTruthy();
      binding?.onSelect();
    };
    run("clipboard.paste");
    run("format.merge");
    run("insert.row");
    expect(calls).toEqual(["paste", "merge", "insertRow"]);
  });

  it("passes control values through to the handler unchanged", () => {
    const seen: Array<string | number> = [];
    const handlers = sheetsStubHandlers();
    handlers.numberFormat.set = (format) => seen.push(format);
    handlers.numberFormat.setDecimals = (decimals) => seen.push(decimals);
    handlers.formula.insertFunction = (name) => seen.push(name);
    const set = sheetsCommandBindings(handlers);
    set.find((binding) => binding.id === "format.number")?.onSelect("currency");
    set.find((binding) => binding.id === "format.decimals")?.onSelect(3);
    set.find((binding) => binding.id === "formula.insert")?.onSelect("SUMIFS");
    expect(seen).toEqual(["currency", 3, "SUMIFS"]);
  });

  it("clamps numeric controls instead of trusting the caller", () => {
    const widths: number[] = [];
    const handlers = sheetsStubHandlers();
    handlers.structure.setColumnWidth = (width) => widths.push(width);
    const set = sheetsCommandBindings(handlers);
    const width = set.find((binding) => binding.id === "format.column.width");
    width?.onSelect(9000);
    width?.onSelect(1);
    width?.onSelect("not a number");
    expect(widths).toEqual([640, 24]);
  });

  it("disables the whole mutating surface when the workbook is read-only", () => {
    const set = bindings((handlers) => {
      handlers.readOnly = true;
    });
    const mutating = set.filter((binding) => binding.requires === "edit");
    expect(mutating.length).toBeGreaterThan(20);
    // History and the shared find/replace pair stay live: undoing your way out
    // of a read-only state is not a mutation, and the shared families own their
    // own disabled logic.
    const sharedFamily = new Set(["history.undo", "history.redo", "navigate.replace", "import.copy"]);
    for (const binding of mutating) {
      if (sharedFamily.has(binding.id)) continue;
      expect(binding.disabled, `${binding.id} stays enabled while read-only`).toBe(true);
    }
  });

  it("blocks cell writes on a protected sheet but keeps the lock reversible", () => {
    const set = bindings((handlers) => {
      handlers.protectedSheet = true;
      handlers.review.protectionNote = "This sheet is protected, so cells cannot be changed.";
    });
    const sharedFamily = new Set(["history.undo", "history.redo", "navigate.replace", "import.copy"]);
    for (const binding of set) {
      if (binding.requires !== "edit" || sharedFamily.has(binding.id)) continue;
      if (binding.id === "protect.sheet") continue;
      expect(binding.disabled, `${binding.id} still writes to a protected sheet`).toBe(true);
    }
    // A lock you cannot unlock is a trap, so this one control stays live and says
    // what the click will do.
    const protect = set.find((binding) => binding.id === "protect.sheet");
    expect(protect?.disabled).toBeUndefined();
    expect(protect?.active).toBe(true);
    expect(protect?.label).toBe("Unprotect sheet");
  });

  it("states why a sheet cannot be added to a mounted workbook", () => {
    const reason = "Excel workbooks opened in Spectra keep their sheet list.";
    const set = bindings((handlers) => {
      handlers.sheet.canAdd = false;
      handlers.sheet.addBlockedReason = reason;
    });
    const add = set.find((binding) => binding.id === "sheet.new");
    expect(add?.disabled).toBe(true);
    expect(add?.hint).toBe(reason);
    expect(add?.strictNative).toEqual({
      available: false,
      reason: "Spectra does not add, remove, hide, or reorder worksheets in a linked Excel file.",
    });
  });

  it("only offers the pivot note when the workbook has pivot parts", () => {
    expect(bindings().some((binding) => binding.id === "data.pivot")).toBe(false);
    const withPivot = bindings((handlers) => {
      handlers.data.pivotPreservedNote = "Spectra keeps this pivot table exactly as Excel wrote it.";
    });
    const pivot = withPivot.find((binding) => binding.id === "data.pivot");
    expect(pivot?.disabled).toBe(true);
    expect(pivot?.touches ?? []).toEqual([]);
  });

  it("never claims to write a region Spectra only preserves", () => {
    const forbidden = new Set(["macros", "customXml", "smartArt", "ole", "pivotTables"]);
    for (const binding of bindings()) {
      for (const region of binding.touches ?? []) {
        expect(forbidden.has(region), `${binding.id} claims ${region}`).toBe(false);
      }
    }
  });

  it("marks the function library honestly against the lens", () => {
    const native = SHEETS_FUNCTION_LIBRARY.filter((spec) => spec.native).map((spec) => spec.name);
    expect(native.sort()).toEqual(
      ["ABS", "AVERAGE", "COUNT", "COUNTA", "IF", "MAX", "MIN", "ROUND", "SUM"].sort(),
    );
    const insert = bindings().find((binding) => binding.id === "formula.insert");
    const options = insert?.control?.kind === "menu" ? insert.control.options : [];
    expect(options.length).toBe(SHEETS_FUNCTION_LIBRARY.length);
    for (const option of options) {
      expect(option.hint).toBeTruthy();
    }
  });

  it("keeps a workable shape for the bar", () => {
    const summary = capabilityMatrixSummary(capabilityMatrixRows("sheets", bindings()));
    expect(summary.total).toBeGreaterThan(70);
    expect(summary.controls).toBeGreaterThan(10);
    expect(summary.nativeWriters).toBeGreaterThan(25);
  });

  it("namespaces every command under sheets.", () => {
    for (const binding of bindings()) {
      const command = commandForBinding("sheets", binding, 0);
      expect(command.id.startsWith("sheets.")).toBe(true);
      expect(command.title.length).toBeLessThanOrEqual(32);
    }
  });
});
