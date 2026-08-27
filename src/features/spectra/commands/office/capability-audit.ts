import { requireArtifactTypeManifest } from "../../artifacts/registry";
import { officeCapabilitiesFor } from "../../capabilities";
import { commandForBinding } from "../registry";
import type { CapabilityAuditEntry } from "../app-registry";
import type { CommandBinding } from "../types";
import type { WorkType } from "../../work/registry";

/**
 * The office capability audit.
 *
 * `APPLICATION_CAPABILITY_AUDIT` proves the AI's app-surface vocabulary and the
 * human command namespace are one namespace. This is the same proof for the
 * three Office artifact types, and it runs in both directions, because both
 * directions are dishonest in their own way:
 *
 *   AI can, human cannot   The assistant edits something the person has no way
 *                          to edit or even see. The person cannot check the
 *                          assistant's work, and "ask the AI" becomes the only
 *                          path to a feature. This is the failure that matters.
 *   Human can, AI cannot   A command the assistant cannot name, so "make this
 *                          bold" fails while the button beside it works. The
 *                          person has no way to know which is which.
 *
 * A third case is legitimate and must not be forced into a command: an
 * operation that only *reads* what the person is already looking at. Nobody
 * needs an "inspect outline" button — they have the outline. Those are declared
 * as inspections, not smuggled in as missing.
 *
 * A fourth is subtler and matters just as much. Some edits are already reachable
 * by hand in the most direct way there is: splitting a paragraph is pressing
 * Enter, rewriting one is typing in it, editing a table cell is clicking the
 * cell. Those are not missing capabilities, and a "Split paragraph" button would
 * be furniture — a control nobody presses, competing for width with one they do.
 * They are declared here as direct manipulation, so the audit does not push a
 * fake button into the bar to satisfy itself.
 */

/** How an operation reaches a person. */
export type OfficeCapabilityStatus =
  /** A workbar command declares it. Human and AI share one execute path. */
  | "registered"
  /** Read-only: the AI reads what the person already sees. No command owed. */
  | "inspection"
  /** The person already does this by typing or dragging in the canvas. */
  | "direct"
  /** Deliberately not built yet, with a reason a person could be told. */
  | "deferred"
  /** The AI can do it and the person cannot. Always a bug. */
  | "ai-only";

export type OfficeCapabilityAuditEntry = Omit<CapabilityAuditEntry, "status"> & {
  workType: WorkType;
  /** The fully qualified manifest operation, e.g. `document.format.blocks`. */
  operation: string;
  status: OfficeCapabilityStatus;
  /**
   * Every command that implements this operation. Many is normal and correct: an
   * operation is a semantic verb, and `insert_blocks` is honestly served by
   * "Page break", "Footnote", "Divider" and the rest. What would be a C1 failure
   * is one *command* with two execute paths, and that is checked by id, not here.
   */
  commandIds: readonly string[];
};

/**
 * Operations that read state the person is already looking at, or that produce
 * advice rather than an edit. These owe no button; the surface *is* the answer.
 * Anything not listed here has to be reachable by a human hand.
 */
const INSPECTION_OPERATIONS: Record<string, readonly string[]> = {
  document: [
    "inspect_outline",
    "inspect_blocks",
    "inspect_selection",
    "summarize",
    "check_accessibility",
    "check_sources",
    "check_layout",
    "validate",
  ],
  sheets: [
    "inspect_workbook",
    "inspect_range",
    "inspect_dependencies",
    "analyze",
    "explain_formula",
    "validate",
  ],
  presentation: [
    "inspect_deck",
    "plan_narrative",
    "check_overflow",
    "check_contrast",
    "check_reading_order",
    "check_source_coverage",
  ],
};

/**
 * Edits the person performs directly in the canvas, with the keyboard or the
 * pointer. Each entry names the gesture, because "direct" is only honest if
 * someone can say what the gesture is — if nobody can, it is an ai-only bug
 * wearing a better label.
 */
const DIRECT_MANIPULATION_OPERATIONS: Record<string, Readonly<Record<string, string>>> = {
  document: {
    "rewrite.paragraph": "Typing in the paragraph.",
    "edit.tableCell": "Clicking the cell and typing.",
    split_block: "Pressing Enter.",
    merge_blocks: "Pressing Backspace at the start of a paragraph.",
  },
  sheets: {
    set_cells: "Selecting a cell and typing.",
    set_formula: "Typing = in a cell.",
    fill_range: "Dragging the fill handle.",
    clear_range: "Selecting a range and pressing Delete.",
  },
  presentation: {
    create_outline: "Adding slides and typing their titles.",
    rewrite_object: "Clicking into the text box and typing.",
    move_object: "Dragging the shape.",
    resize_object: "Dragging a selection handle.",
    write_speaker_notes: "Typing in the notes pane.",
  },
};

/**
 * Operations with no command *on purpose*, each with the sentence a person would
 * be told. An entry here is a promise: the reason is honest, and it is removed
 * in the same change that ships the command.
 */
export type OfficeCapabilityDeferral = { operation: string; reason: string };

export function officeOperationsFor(type: WorkType): readonly string[] {
  const manifestOperations = requireArtifactTypeManifest(type).operations;
  if (type !== "document" && type !== "sheets" && type !== "presentation") {
    return manifestOperations;
  }
  const definitions = officeCapabilitiesFor(type);
  const replacedAggregates = new Set(
    definitions
      .map((definition) => definition.manifestOperation)
      .filter((operation): operation is string => Boolean(operation))
      .map((operation) => manifestOperationId(type, operation)),
  );
  return [
    ...manifestOperations.filter((operation) => !replacedAggregates.has(operation)),
    ...definitions
      .filter((definition) => definition.ai.exposed)
      .map((definition) => definition.id),
  ];
}

/** `document.format.blocks` from `format_blocks`, matching the registry's form. */
export function manifestOperationId(type: WorkType, operation: string) {
  return operation.startsWith(`${type}.`)
    ? operation
    : `${type}.${operation.replaceAll("_", ".")}`;
}

export function officeCapabilityAudit(
  type: WorkType,
  bindings: readonly CommandBinding[],
  deferrals: readonly OfficeCapabilityDeferral[] = [],
): OfficeCapabilityAuditEntry[] {
  const byOperation = new Map<string, string[]>();
  for (const [index, binding] of bindings.entries()) {
    const command = commandForBinding(type, binding, index);
    if (command.capabilityId) {
      const list = byOperation.get(command.capabilityId) ?? [];
      list.push(command.id);
      byOperation.set(command.capabilityId, list);
      continue;
    }
    for (const op of command.manifestOps ?? []) {
      const id = manifestOperationId(type, op);
      const list = byOperation.get(id) ?? [];
      list.push(command.id);
      byOperation.set(id, list);
    }
  }
  const inspections = new Set(
    (INSPECTION_OPERATIONS[type] ?? []).map((op) => manifestOperationId(type, op)),
  );
  const direct = new Map(
    Object.entries(DIRECT_MANIPULATION_OPERATIONS[type] ?? {}).map(
      ([op, gesture]) => [manifestOperationId(type, op), gesture],
    ),
  );
  const deferred = new Map(
    deferrals.map((entry) => [manifestOperationId(type, entry.operation), entry.reason]),
  );

  return officeOperationsFor(type).map((operation) => {
    const commandIds = byOperation.get(operation) ?? [];
    const gesture = direct.get(operation);
    const deferralReason = deferred.get(operation);
    const status: OfficeCapabilityStatus = commandIds.length
      ? "registered"
      : inspections.has(operation)
        ? "inspection"
        : gesture
          ? "direct"
          : deferralReason
            ? "deferred"
            : "ai-only";
    const reason = status === "direct" ? gesture : deferralReason;
    return {
      workType: type,
      domain: operation.split(".")[1] ?? type,
      action: operation.slice(type.length + 1),
      operation,
      commandId: commandIds[0] ?? "",
      commandIds,
      status,
      ...(reason ? { reason } : {}),
    };
  });
}

/**
 * Every way the two vocabularies have drifted, as sentences someone can act on.
 * An empty array is the whole point of the module.
 */
export function officeCapabilityAuditIssues(
  type: WorkType,
  bindings: readonly CommandBinding[],
  deferrals: readonly OfficeCapabilityDeferral[] = [],
): string[] {
  const issues: string[] = [];
  const entries = officeCapabilityAudit(type, bindings, deferrals);
  const declared = new Set(officeOperationsFor(type));
  const manifestDeclared = new Set(requireArtifactTypeManifest(type).operations);

  if (type === "document" || type === "sheets" || type === "presentation") {
    for (const definition of officeCapabilitiesFor(type)) {
      if (!definition.ai.exposed) continue;
      if (!declared.has(definition.id)) {
        issues.push(`${definition.id}: capability is missing from the generated Office operation vocabulary.`);
      }
      if (definition.manifestOperation) {
        const aggregate = manifestOperationId(type, definition.manifestOperation);
        if (!manifestDeclared.has(aggregate)) {
          issues.push(
            `${definition.id}: specializes manifest operation "${aggregate}", which the artifact registry does not have.`,
          );
        }
      }
    }
  }

  for (const entry of entries) {
    if (entry.status === "ai-only") {
      issues.push(
        `${entry.operation}: the assistant can do this and a person cannot. Register a command for it, or declare it as an inspection, a direct gesture, or a deferral with a reason.`,
      );
    }
    if (entry.status === "deferred" && !entry.reason?.trim()) {
      issues.push(`${entry.operation}: deferred without a reason a person could be told.`);
    }
  }

  // A deferral that survived its own fix is a lie with a shelf life.
  const registered = new Set(
    entries.filter((entry) => entry.status === "registered").map((entry) => entry.operation),
  );
  for (const deferral of deferrals) {
    const operation = manifestOperationId(type, deferral.operation);
    if (!declared.has(operation)) {
      issues.push(`Deferral names "${operation}", which ${type} does not declare as an operation.`);
    }
    if (registered.has(operation)) {
      issues.push(`Deferral for "${operation}" is stale: a command now implements it. Remove the deferral.`);
    }
  }

  // The other direction: a command naming an operation the registry never
  // declared. The AI dispatcher would never route to it, so the command looks
  // AI-reachable and is not.
  for (const [index, binding] of bindings.entries()) {
    const command = commandForBinding(type, binding, index);
    if (command.capabilityId) continue;
    for (const op of command.manifestOps ?? []) {
      const operation = manifestOperationId(type, op);
      if (!manifestDeclared.has(operation)) {
        issues.push(
          `${command.id}: declares manifest operation "${operation}", which the artifact registry does not have. The assistant cannot reach this command.`,
        );
      }
    }
  }

  return issues;
}

/** Counts for a quick read of how much of a type the assistant can actually do. */
export function officeCapabilityAuditSummary(entries: readonly OfficeCapabilityAuditEntry[]) {
  const count = (status: OfficeCapabilityStatus) =>
    entries.filter((entry) => entry.status === status).length;
  return {
    total: entries.length,
    registered: count("registered"),
    inspection: count("inspection"),
    direct: count("direct"),
    deferred: count("deferred"),
    aiOnly: count("ai-only"),
  };
}
