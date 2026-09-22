import { describe, expect, it, vi } from "vitest";
import { formattingCapabilitiesFor } from "../capabilities";
import {
  allTabsFor,
  commandContext,
  commandForBinding,
  contextualTabsFor,
  executeCommand,
  regionBlockedBy,
  SHARED_FONT_SIZES,
  SHARED_FONT_STACKS,
  exportBindings,
  findBindings,
  historyBindings,
  importBinding,
  tabsFor,
  textFormatBindings,
  zoomBindings,
  commentsBinding,
  type CommandBinding,
} from "../commands";
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
  operationRegionIndex,
  refusedOperations,
} from "../commands/office/operation-gate";

/**
 * The protocol the three Office editors are built on. These are the invariants
 * a capability pass can quietly break: a control that stops sharing its execute
 * path, a formatting command that pretends it can rewrite a preserved region, a
 * favourites surface that drifts from the contract.
 */
describe("artifact command protocol", () => {
  it("carries a control's value through the one execute path", () => {
    const setFont = vi.fn();
    const command = commandForBinding("document", {
      id: "format.fontFamily",
      label: "Font",
      control: { kind: "select", options: [...SHARED_FONT_STACKS], value: undefined },
      onSelect: (value) => setFont(value),
    }, 0);

    expect(command.id).toBe("document.format.fontFamily");
    expect(command.presentation.kind).toBe("select");
    expect(command.presentation.control).toMatchObject({ kind: "select" });
    // A field is still a command: choreography resolves it from the registry
    // rather than from a coordinate on screen.
    expect(command.choreography).toEqual({
      target: "workbar-field",
      region: "document.format.fontFamily",
    });

    const context = commandContext("document", () => true, "edit");
    expect(executeCommand(command, context, "Georgia, serif")).toBe(true);
    expect(setFont).toHaveBeenCalledWith("Georgia, serif");
  });

  it("refuses a command that would write a preserved region, with a reason a person can read", () => {
    const binding: CommandBinding = {
      id: "format.trackedEdit",
      label: "Accept change",
      touches: ["trackedChanges"],
      onSelect: vi.fn(),
    };
    const command = commandForBinding("document", binding, 0);
    const linked = commandContext("document", () => true, "edit", undefined, {
      compatibilityProfile: "strict-native",
      fidelity: { body: "NATIVE", trackedChanges: "PRESERVED" },
    });

    const availability = command.availability(linked);
    expect(availability.state).toBe("disabled");
    expect(availability.state === "disabled" && availability.reason).toContain("tracked changes");
    expect(executeCommand(command, linked)).toBe(false);

    // The same command is enabled where the region is genuinely editable.
    const spectra = commandContext("document", () => true, "edit", undefined, {
      compatibilityProfile: "spectra-native",
      fidelity: { trackedChanges: "PRESERVED" },
    });
    expect(command.availability(spectra)).toEqual({ state: "enabled" });
    expect(regionBlockedBy({ trackedChanges: "PRESERVED" }, ["trackedChanges"])).toEqual({
      region: "trackedChanges",
      state: "PRESERVED",
    });
    expect(regionBlockedBy({ body: "NATIVE" }, ["body"])).toBeUndefined();
  });

  it("keeps one tab vocabulary per type", () => {
    expect(allTabsFor("document")).toEqual([
      "General", "Insert", "Format", "Layout", "References", "Equation", "Table", "Image",
    ]);
    // Sheets keeps Formula on screen permanently *and* raises it on a formula
    // selection. That is one tab, listed once — a strip with two "Formula" tabs
    // has a second one that appears to do nothing when clicked.
    expect(allTabsFor("sheets")).toEqual([
      "General", "Insert", "Format", "Data", "Formula", "Review", "Chart",
    ]);
    expect(tabsFor("sheets", "formula")).toEqual([
      "General", "Insert", "Format", "Data", "Formula", "Review",
    ]);
    // A contextual tab that is not already permanent still appears on selection.
    expect(tabsFor("sheets", "chart")).toEqual([
      "General", "Insert", "Format", "Data", "Formula", "Review", "Chart",
    ]);
    expect(tabsFor("sheets")).not.toContain("Chart");
    expect(contextualTabsFor("presentation")).toEqual(["Shape", "Transition"]);
  });

  it("builds the same history, find, format and export families for every type", () => {
    const noop = () => {};
    for (const type of ["document", "sheets", "presentation"] as const) {
      const history = historyBindings({ undo: noop, redo: noop, canUndo: false, canRedo: true });
      const [undo, redo] = history.map((binding) => commandForBinding(type, binding, 0));
      expect(undo?.id).toBe(`${type}.history.undo`);
      expect(redo?.id).toBe(`${type}.history.redo`);
      expect(undo?.shortcut).toBe("Mod+Z");
      expect(redo?.shortcut).toBe("Mod+Shift+Z");
      // Nothing to undo is a state, not a hidden button.
      expect(undo?.availability(commandContext(type, () => true, "edit"))).toMatchObject({
        state: "disabled",
        reason: "Nothing to undo yet",
      });
      expect(undo?.defaultPlacement.tab).toBe("General");

      const find = findBindings({ toggle: noop, toggleReplace: noop, matchCount: 3 });
      expect(find.map((binding) => commandForBinding(type, binding, 0).id)).toEqual([
        `${type}.navigate.find`,
        `${type}.navigate.replace`,
      ]);

      const exports = exportBindings({
        formats: [{ format: "pdf", label: "PDF" }],
        run: noop,
        noun: "document",
      });
      const exported = commandForBinding(type, exports[0]!, 0);
      expect(exported.exportBoundary).toBe("lossy-copy");
      expect(exports[0]!.hint).toContain("never replaced");

      const imported = commandForBinding(type, importBinding({ open: noop, noun: "document" }), 0);
      expect(imported.availability(commandContext(type, () => true, "edit", undefined, {
        compatibilityProfile: "strict-native",
        fidelity: {},
      }))).toMatchObject({ state: "disabled" });
    }
  });

  it("registers formatting as commands with real controls, not editor chains", () => {
    const setFontSize = vi.fn();
    const toggleBold = vi.fn();
    const bindings = textFormatBindings("document", {
      fontFamily: { value: undefined, set: vi.fn() },
      fontSize: { value: 11, set: setFontSize },
      bold: { active: true, toggle: toggleBold },
      italic: { toggle: vi.fn() },
      color: { value: "#101828", set: vi.fn() },
      alignment: { value: "left", set: vi.fn() },
    });

    const byId = new Map(
      bindings.map((binding) => [commandForBinding("document", binding, 0).id, binding]),
    );
    expect([...byId.keys()]).toEqual([
      "document.format.fontFamily",
      "document.format.fontSize",
      "document.format.bold",
      "document.format.italic",
      "document.format.color",
      "document.format.align",
    ]);

    // The contract's General pins ship pinned, not merely available.
    const font = commandForBinding("document", byId.get("document.format.fontFamily")!, 0);
    expect(font.defaultPlacement.tab).toBe("General");
    expect(font.sourceTab).toBe("Format");

    const size = commandForBinding("document", byId.get("document.format.fontSize")!, 1);
    const context = commandContext("document", () => true, "edit");
    executeCommand(size, context, 900);
    // Out-of-range values are clamped by the command, not by the control, so the
    // AI path cannot set a 900pt heading the picker would refuse.
    expect(setFontSize).toHaveBeenCalledWith(400);
    expect(SHARED_FONT_SIZES).toContain(11);

    const bold = commandForBinding("document", byId.get("document.format.bold")!, 2);
    expect(bold.presentation.kind).toBe("toggle");
    expect(bold.shortcut).toBe("Mod+B");
    executeCommand(bold, context, true);
    expect(toggleBold).not.toHaveBeenCalled();
    executeCommand(bold, context, false);
    expect(toggleBold).toHaveBeenCalledOnce();
  });

  it("reports every way a command set violates the protocol", () => {
    const rows = capabilityMatrixRows("document", [
      { id: "history.undo", label: "Undo", general: true, onSelect: () => {} },
      { id: "history.undo", label: "Undo again", general: true, onSelect: () => {} },
      { id: "macro.edit", label: "Edit macro", touches: ["macros"], onSelect: () => {} },
      { id: "insert.table", label: "Table", tab: "Insert", touches: ["tables"], undo: "none(explain)", onSelect: () => {} },
      { id: "layout.margins", label: "Margins", tab: "Layout", onSelect: () => {} },
      {
        id: "references.toc",
        label: "Table of contents",
        tab: "References",
        priority: "advanced",
        onSelect: () => {},
      },
      { id: "format.bold", label: "Bold", tab: "Format", onSelect: () => {} },
    ]);

    const issues = capabilityMatrixIssues("document", rows, {
      manifestOps: ["document.format.blocks"],
      requiredGeneral: ["document.history.undo", "document.navigate.find"],
    });

    expect(issues).toContain("document.history.undo: registered 2 times. One command id, one implementation.");
    expect(issues.some((issue) => issue.includes("preserves rather than edits"))).toBe(true);
    expect(issues.some((issue) => issue.includes("promises no undo"))).toBe(true);
    expect(issues).toContain('General is missing the contract default "document.navigate.find".');
    expect(issues.some((issue) => issue.includes('overflow commands need a hint'))).toBe(true);

    const summary = capabilityMatrixSummary(rows);
    expect(summary.total).toBe(7);
    // Document has no Review tab, so a review verb without an explicit tab
    // lands in General. That is the inference working, not a placement bug.
    expect(summary.tabs.General).toBe(3);
  });

  it("keeps zoom and comments a shared surface entry rather than three of them", () => {
    const setZoom = vi.fn();
    const zooms = zoomBindings({ zoom: 1, setZoom });
    const ids = zooms.map((binding) => commandForBinding("presentation", binding, 0).id);
    expect(ids).toEqual([
      "presentation.view.zoom.in",
      "presentation.view.zoom.out",
      "presentation.view.zoom.reset",
    ]);
    const zoomIn = commandForBinding("sheets", zooms[0]!, 0);
    executeCommand(zoomIn, commandContext("sheets", () => true, "edit"));
    expect(setZoom).toHaveBeenCalledWith(1.1);

    const comments = commandForBinding("sheets", commentsBinding({ toggle: vi.fn(), openCount: 2 }), 0);
    expect(comments.id).toBe("sheets.review.comments");
    expect(comments.defaultPlacement.tab).toBe("General");
    expect(comments.touches).toEqual(["comments"]);
  });
});

/**
 * The two vocabularies are one vocabulary. The failure this guards against is
 * specific and it is not symmetrical: an operation the assistant can perform and
 * a person cannot is a feature only reachable by asking the AI, and nobody can
 * check its work. So the audit names those, and a deferral has to carry a reason
 * someone could actually be told.
 */
describe("office capability audit", () => {
  it("names an operation the assistant can do and a person cannot", () => {
    const audit = officeCapabilityAudit("sheets", [
      {
        id: "sort.asc",
        capabilityId: "sheets.sort.asc",
        label: "Sort A to Z",
        onSelect: () => {},
      },
    ]);
    const sort = audit.find((entry) => entry.operation === "sheets.sort.asc");
    expect(sort).toMatchObject({
      status: "registered",
      commandIds: ["sheets.sort.asc"],
    });

    const chart = audit.find((entry) => entry.operation === "sheets.chart.insert");
    expect(chart?.status).toBe("ai-only");
    const issues = officeCapabilityAuditIssues("sheets", [
      {
        id: "sort.asc",
        capabilityId: "sheets.sort.asc",
        label: "Sort A to Z",
        onSelect: () => {},
      },
    ]);
    expect(issues.some((issue) =>
      issue.startsWith("sheets.chart.insert:") && issue.includes("a person cannot"),
    )).toBe(true);
  });

  it("treats reading what the person already sees as owing no button", () => {
    const audit = officeCapabilityAudit("document", []);
    // The outline is on screen. An "inspect outline" command would be furniture.
    expect(audit.find((entry) => entry.operation === "document.inspect.outline")?.status)
      .toBe("inspection");
    // Splitting a paragraph is pressing Enter. A button for it would also be
    // furniture, so it is declared as direct manipulation with the gesture named.
    expect(audit.find((entry) => entry.operation === "document.split.block")).toMatchObject({
      status: "direct",
      reason: "Pressing Enter.",
    });
    // Creating a table is neither: nobody types a table into existence, so it
    // owes a real command.
    expect(audit.find((entry) => entry.operation === "document.insert.table")?.status)
      .toBe("ai-only");
  });

  it("does not let direct manipulation excuse a missing command", () => {
    // A registered command still wins: once Insert table exists, the operation is
    // registered rather than explained away.
    const audit = officeCapabilityAudit("document", [
      {
        id: "insert.table",
        capabilityId: "document.insert.table",
        label: "Table",
        onSelect: () => {},
      },
    ]);
    expect(audit.find((entry) => entry.operation === "document.insert.table")).toMatchObject({
      status: "registered",
      commandIds: ["document.insert.table"],
    });
    expect(officeCapabilityAuditIssues("document", []).some((issue) =>
      issue.startsWith("document.insert.citation:"),
    )).toBe(true);
  });

  it("accepts an honest deferral and rejects a stale or unreasoned one", () => {
    const bindings: CommandBinding[] = [
      { id: "design.theme", label: "Design", manifestOps: ["apply_theme"], onSelect: () => {} },
    ];
    const deferrals = [
      { operation: "apply_master", reason: "Spectra preserves slide masters in a linked deck and never rewrites them." },
    ];
    const entries = officeCapabilityAudit("presentation", bindings, deferrals);
    expect(entries.find((entry) => entry.operation === "presentation.apply.master")).toMatchObject({
      status: "deferred",
      reason: "Spectra preserves slide masters in a linked deck and never rewrites them.",
    });
    expect(officeCapabilityAuditIssues("presentation", bindings, deferrals)
      .some((issue) => issue.includes("apply.master"))).toBe(false);

    // A deferral that outlived its fix, and one with nothing to tell anyone.
    // apply_master is the leftover aggregate this suite still names; specialized
    // verbs like apply_theme now live on their IR ids and cannot be deferred
    // under the old name.
    const stale = officeCapabilityAuditIssues("presentation", [
      { id: "design.master", label: "Master", manifestOps: ["apply_master"], onSelect: () => {} },
    ], [
      { operation: "apply_master", reason: "Later." },
    ]);
    expect(stale.some((issue) => issue.includes("stale"))).toBe(true);
    const unreasoned = officeCapabilityAuditIssues("presentation", bindings, [
      { operation: "apply_master", reason: "  " },
    ]);
    expect(unreasoned.some((issue) => issue.includes("without a reason"))).toBe(true);
  });

  it("catches a command that claims an operation the registry never declared", () => {
    const issues = officeCapabilityAuditIssues("document", [
      { id: "insert.mood", label: "Mood board", manifestOps: ["insert_mood_board"], onSelect: () => {} },
    ]);
    expect(issues.some((issue) =>
      issue.includes("document.insert.mood.board") && issue.includes("cannot reach"),
    )).toBe(true);
  });

  it("accepts specialized IR ids instead of one aggregate verb", () => {
    const issues = officeCapabilityAuditIssues("document", [
      {
        id: "insert.pageBreak",
        capabilityId: "document.insert.pageBreak",
        label: "Page break",
        onSelect: () => {},
      },
      {
        id: "insert.footnote",
        capabilityId: "document.insert.footnote",
        label: "Footnote",
        onSelect: () => {},
      },
    ]);
    expect(issues.some((issue) => issue.includes("insert.blocks"))).toBe(false);

    const audit = officeCapabilityAudit("document", [
      {
        id: "insert.pageBreak",
        capabilityId: "document.insert.pageBreak",
        label: "Page break",
        onSelect: () => {},
      },
      {
        id: "insert.footnote",
        capabilityId: "document.insert.footnote",
        label: "Footnote",
        onSelect: () => {},
      },
    ]);
    expect(audit.find((row) => row.operation === "document.insert.pageBreak")).toMatchObject({
      status: "registered",
      commandIds: ["document.insert.pageBreak"],
    });
    expect(audit.find((row) => row.operation === "document.insert.footnote")).toMatchObject({
      status: "registered",
      commandIds: ["document.insert.footnote"],
    });
  });

  it("summarises how much of a type the assistant and a person share", () => {
    for (const type of ["document", "sheets", "presentation"] as const) {
      expect(officeOperationsFor(type).length).toBeGreaterThan(15);
      const summary = officeCapabilityAuditSummary(officeCapabilityAudit(type, []));
      expect(summary.total).toBe(officeOperationsFor(type).length);
      expect(summary.registered).toBe(0);
      // With no commands at all, every operation is accounted for as a read, a
      // gesture the person already has, or a hole. Nothing falls through.
      expect(summary.inspection + summary.direct + summary.aiOnly).toBe(summary.total);
      // And each type has real holes to close, which is the size of the job.
      expect(summary.aiOnly).toBeGreaterThan(0);
      expect(summary.aiOnly).toBeGreaterThanOrEqual(
        formattingCapabilitiesFor(type).length,
      );
    }
  });

  it("refuses the assistant exactly as it refuses the person, word for word", () => {
    const bindings: CommandBinding[] = [
      {
        id: "review.accept",
        label: "Accept change",
        touches: ["trackedChanges"],
        manifestOps: ["rewrite_blocks"],
        onSelect: () => {},
      },
    ];
    const linked = {
      compatibilityProfile: "strict-native" as const,
      fidelity: { body: "NATIVE" as const, trackedChanges: "PRESERVED" as const },
    };

    // What the person sees on the disabled control.
    const command = commandForBinding("document", bindings[0]!, 0);
    const availability = command.availability(
      commandContext("document", () => true, "edit", undefined, linked),
    );
    expect(availability.state).toBe("disabled");
    const humanReason = availability.state === "disabled" ? availability.reason : "";

    // What the assistant is told when it proposes the same operation.
    const gate = gateOperation({
      type: "document",
      operation: "rewrite_blocks",
      bindings,
      ...linked,
    });
    expect(gate.allowed).toBe(false);
    expect(gate.allowed === false && gate.reason).toBe(humanReason);
    expect(humanReason).toContain("tracked changes");

    // And the whole refusal list can be stated before a plan starts, so the
    // assistant never fails at step four on something it could have said first.
    expect(refusedOperations("document", bindings, "strict-native", linked.fidelity)).toEqual([
      { operation: "document.rewrite.blocks", region: "trackedChanges", reason: humanReason },
    ]);

    // Outside strict-native the linked original is not the authority, so neither
    // surface refuses.
    expect(gateOperation({
      type: "document",
      operation: "rewrite_blocks",
      bindings,
      compatibilityProfile: "spectra-native",
      fidelity: linked.fidelity,
    })).toEqual({ allowed: true });
    expect(refusedOperations("document", bindings, "spectra-native", linked.fidelity)).toEqual([]);
  });

  it("refuses a known IR write from the definition even when no bindings are passed", () => {
    const preservedCells = gateOperation({
      type: "sheets",
      operation: "set_cells",
      bindings: [],
      compatibilityProfile: "strict-native",
      fidelity: { cells: "PRESERVED" },
    });
    expect(preservedCells.allowed).toBe(false);
    expect(preservedCells.allowed === false && preservedCells.reason).toContain(
      "cannot edit it yet",
    );

    // An operation the IR has never heard of is not silently refused: guessing
    // would block the assistant on a file it can legitimately edit.
    expect(gateOperation({
      type: "sheets",
      operation: "sheets.fiction.mutate",
      bindings: [],
      compatibilityProfile: "strict-native",
      fidelity: { cells: "PRESERVED" },
    })).toEqual({ allowed: true });

    const index = operationRegionIndex("sheets", [
      { id: "data.write", label: "Write", manifestOps: ["set_cells"], touches: ["cells"], onSelect: () => {} },
      { id: "data.fill", label: "Fill", manifestOps: ["set_cells"], touches: ["numberFormats"], onSelect: () => {} },
    ]);
    // Two commands, one operation: the gate has to consider every region either
    // of them writes, not just the first it found.
    expect(index.get("sheets.set.cells")).toEqual(["cells", "numberFormats"]);
  });
});
