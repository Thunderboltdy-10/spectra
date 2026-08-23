import { allTabsFor, commandForBinding, contextualTabsFor, COMMAND_TABS } from "../registry";
import type {
  CommandBinding,
  CommandControlKind,
  FidelityRegionKey,
} from "../types";
import type { WorkType } from "../../work/registry";

/**
 * The capability matrix.
 *
 * Screenshots cannot prove a command surface is real: a button that looks right
 * and does nothing photographs exactly like one that works. So the audit is
 * mechanical. Each artifact type declares its whole command set as a pure
 * function of its handlers, this module flattens that into rows, and
 * `capabilityMatrixIssues` states — in sentences a person can act on — every
 * way the set violates the protocol.
 *
 * The rows are also the honest inventory: what exists, where it lives, what it
 * writes in a native package, and how it is reversed.
 */
export type CapabilityMatrixRow = {
  commandId: string;
  workType: WorkType;
  title: string;
  /** Where the command shows after General pinning is applied. */
  tab: string;
  /** The category it ships from, which is where "unpin" returns it. */
  sourceTab: string;
  group: string;
  order: number;
  contextualTab?: string;
  general: boolean;
  priority: "essential" | "secondary" | "advanced";
  controlKind: CommandControlKind;
  shortcut?: string;
  hint?: string;
  risk: "safe" | "confirm" | "always-confirm" | "destructive";
  undo: "yjs" | "operation-inverse" | "none(explain)";
  touches: readonly FidelityRegionKey[];
  manifestOps: readonly string[];
  exportBoundary?: "none" | "lossy-copy" | "native-sync";
  strictNative?: { available: boolean; reason?: string };
  choreographyTarget?: string;
  requires?: string;
};

export function capabilityMatrixRows(
  type: WorkType,
  bindings: readonly CommandBinding[],
): CapabilityMatrixRow[] {
  return bindings.map((binding, index) => {
    const command = commandForBinding(type, binding, index);
    return {
      commandId: command.id,
      workType: type,
      title: command.title,
      tab: command.defaultPlacement.tab,
      sourceTab: command.sourceTab ?? command.defaultPlacement.tab,
      group: command.defaultPlacement.group,
      order: command.defaultPlacement.order,
      ...(command.contextualTab ? { contextualTab: command.contextualTab } : {}),
      general: command.defaultPlacement.tab === "General",
      priority: binding.priority ?? "secondary",
      controlKind: command.presentation.kind,
      ...(command.shortcut ? { shortcut: command.shortcut } : {}),
      ...(binding.hint ? { hint: binding.hint } : {}),
      risk: command.risk,
      undo: command.undo,
      touches: command.touches ?? [],
      manifestOps: command.manifestOps ?? [],
      ...(command.exportBoundary ? { exportBoundary: command.exportBoundary } : {}),
      ...(binding.strictNative ? { strictNative: binding.strictNative } : {}),
      ...(command.choreography?.target ? { choreographyTarget: command.choreography.target } : {}),
      ...(binding.requires ? { requires: binding.requires } : {}),
    };
  });
}

/**
 * Regions that mean "this command writes bytes into a linked native package".
 * A command touching one of these owes evidence: a fixture row, a preserved
 * proof, and a reversal story. View-only regions are excluded on purpose.
 */
const NATIVE_WRITE_REGIONS = new Set<FidelityRegionKey>([
  "body", "styles", "lists", "tables", "images", "equations",
  "headersFooters", "footnotes", "fields", "sections",
  "cells", "formulas", "numberFormats", "charts", "validation",
  "conditionalFormat", "namedRanges",
  "slides", "layouts", "shapes", "speakerNotes", "media",
]);

/**
 * Regions Spectra must never claim to edit in a linked file. A command that
 * says it writes one of these is a preservation bug, not a feature.
 */
const PRESERVE_ONLY_REGIONS = new Set<FidelityRegionKey>([
  "macros", "customXml", "smartArt", "ole", "trackedChanges", "pivotTables", "masters",
]);

export type CapabilityMatrixOptions = {
  /** Manifest operation ids the AI can invoke, e.g. `document.format.blocks`. */
  manifestOps?: readonly string[];
  /** Commands the contract requires in the General favourites surface. */
  requiredGeneral?: readonly string[];
  /** Tabs allowed to ship empty, with the reason. Normally none. */
  allowEmptyTabs?: readonly string[];
};

/** The op id form used by `artifacts/registry.ts`: `sheets.set.formula`. */
function manifestOpId(type: WorkType, op: string) {
  return op.startsWith(`${type}.`) ? op : `${type}.${op.replaceAll("_", ".")}`;
}

export function capabilityMatrixIssues(
  type: WorkType,
  rows: readonly CapabilityMatrixRow[],
  options: CapabilityMatrixOptions = {},
): string[] {
  const issues: string[] = [];
  const tabs = new Set(allTabsFor(type));
  const contextual = new Set(contextualTabsFor(type));
  const seen = new Map<string, number>();

  for (const row of rows) {
    seen.set(row.commandId, (seen.get(row.commandId) ?? 0) + 1);

    if (!row.commandId.startsWith(`${type}.`)) {
      issues.push(`${row.commandId}: id is not namespaced under "${type}."`);
    }
    if (!row.title.trim()) {
      issues.push(`${row.commandId}: has no visible label.`);
    }
    if (row.title.length > 32) {
      issues.push(`${row.commandId}: label "${row.title}" is too long for the bar (32 characters).`);
    }
    if (!tabs.has(row.tab)) {
      issues.push(`${row.commandId}: tab "${row.tab}" is not a ${type} tab.`);
    }
    if (row.contextualTab && !contextual.has(row.contextualTab)) {
      issues.push(`${row.commandId}: contextual tab "${row.contextualTab}" is not declared for ${type}.`);
    }
    if (row.risk === "destructive" && !row.hint) {
      issues.push(`${row.commandId}: destructive commands must state their consequence in a hint.`);
    }
    if (row.priority === "advanced" && !row.hint && row.controlKind === "button") {
      issues.push(`${row.commandId}: overflow commands need a hint; the label alone is not enough in a menu.`);
    }
    for (const region of row.touches) {
      if (PRESERVE_ONLY_REGIONS.has(region)) {
        issues.push(
          `${row.commandId}: declares it writes "${region}", which Spectra preserves rather than edits. Demote it to read-only or drop the region.`,
        );
      }
    }
    const writesNative = row.touches.some((region) => NATIVE_WRITE_REGIONS.has(region));
    if (writesNative && row.undo === "none(explain)" && row.exportBoundary !== "lossy-copy") {
      issues.push(`${row.commandId}: writes native content but promises no undo. Give it a reversal or say why in the surface.`);
    }
    if (row.exportBoundary === "native-sync" && !row.touches.length) {
      issues.push(`${row.commandId}: claims a native-sync boundary without declaring the regions it writes.`);
    }
  }

  for (const [commandId, count] of seen) {
    if (count > 1) issues.push(`${commandId}: registered ${count} times. One command id, one implementation.`);
  }

  // Every static tab has to be worth opening.
  const populated = new Set(rows.flatMap((row) => [row.tab, row.sourceTab]));
  const allowEmpty = new Set(options.allowEmptyTabs ?? []);
  for (const tab of ["General", ...COMMAND_TABS[type]]) {
    if (!populated.has(tab) && !allowEmpty.has(tab)) {
      issues.push(`Tab "${tab}" ships with no commands. Populate it or remove it from the taxonomy.`);
    }
  }

  // General is a favourites surface, and the contract names its defaults.
  const generalIds = new Set(rows.filter((row) => row.general).map((row) => row.commandId));
  for (const required of options.requiredGeneral ?? []) {
    if (!generalIds.has(required)) {
      issues.push(`General is missing the contract default "${required}".`);
    }
  }

  // The AI vocabulary and the human vocabulary are one vocabulary.
  if (options.manifestOps?.length) {
    const claimed = new Set(
      rows.flatMap((row) => row.manifestOps.map((op) => manifestOpId(type, op))),
    );
    const known = new Set(options.manifestOps);
    for (const op of claimed) {
      if (!known.has(op)) {
        issues.push(`Command claims manifest operation "${op}", which the artifact registry does not declare.`);
      }
    }
  }

  return issues;
}

/** A compact, sorted view for review and for committed snapshots. */
export function capabilityMatrixSummary(rows: readonly CapabilityMatrixRow[]) {
  const byTab = new Map<string, CapabilityMatrixRow[]>();
  for (const row of rows) {
    const list = byTab.get(row.tab) ?? [];
    list.push(row);
    byTab.set(row.tab, list);
  }
  return {
    total: rows.length,
    general: rows.filter((row) => row.general).length,
    controls: rows.filter((row) => row.controlKind !== "button" && row.controlKind !== "toggle").length,
    nativeWriters: rows.filter((row) => row.touches.some((region) => NATIVE_WRITE_REGIONS.has(region))).length,
    tabs: Object.fromEntries(
      [...byTab.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([tab, list]) => [tab, list.length]),
    ),
  };
}
