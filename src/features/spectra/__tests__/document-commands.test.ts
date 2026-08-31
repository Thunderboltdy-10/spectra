import { describe, expect, it } from "vitest";
import {
  DOCUMENT_GENERAL_DEFAULTS,
  documentCommandBindings,
  documentCommandStubHandlers,
  documentStubHandlers,
  type DocumentCommandHandlers,
} from "../commands/office/document-commands";
import {
  capabilityMatrixIssues,
  capabilityMatrixRows,
} from "../commands/office/capability-matrix";
import {
  allTabsFor,
  commandContext,
  commandForBinding,
  COMMAND_TABS,
  executeCommand,
} from "../commands/registry";
import type { FidelityRegionKey } from "../commands/types";
import { DOCUMENT_SLASH_COMMANDS } from "../editor/slash-command-extension";
import { requireArtifactTypeManifest } from "../artifacts/registry";
import { DOCUMENT_NATIVE_REASONS } from "../capabilities";

const bindings = (patch?: (handlers: DocumentCommandHandlers) => DocumentCommandHandlers) =>
  documentCommandBindings(patch ? patch(documentStubHandlers()) : documentStubHandlers());

const commands = () =>
  bindings().map((binding, index) => commandForBinding("document", binding, index));

/** A context that grants everything, so tab and id checks are not gated. */
function fullContext(
  profile: "strict-native" | "enhanced" | "spectra-native" = "spectra-native",
  fidelity: Record<string, string> = {},
) {
  const ctx = commandContext("document", () => true, "edit");
  return { ...ctx, compatibilityProfile: profile, fidelity } as typeof ctx;
}

describe("document command set", () => {
  it("gives every command a stable, namespaced, unique id", () => {
    const ids = commands().map((command) => command.id);
    expect(ids.length).toBeGreaterThan(60);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith("document.")).toBe(true);
  });

  it("passes the capability matrix audit with no issues", () => {
    const issues = capabilityMatrixIssues(
      "document",
      capabilityMatrixRows("document", bindings()),
      {
        manifestOps: requireArtifactTypeManifest("document").operations,
        requiredGeneral: DOCUMENT_GENERAL_DEFAULTS,
      },
    );
    expect(issues).toEqual([]);
  });

  it("places every command on a tab the registry declares for a document", () => {
    const valid = new Set(allTabsFor("document"));
    const stray = commands()
      .filter((command) => !valid.has(command.defaultPlacement.tab))
      .map((command) => `${command.id}@${command.defaultPlacement.tab}`);
    expect(stray).toEqual([]);
  });

  it("ships the contract General defaults as General commands", () => {
    const general = new Set(
      commands()
        .filter((command) => command.defaultPlacement.tab === "General")
        .map((command) => command.id),
    );
    for (const id of DOCUMENT_GENERAL_DEFAULTS) expect(general.has(id)).toBe(true);
  });

  it("populates every static tab and all three contextual tabs with real work", () => {
    const byTab = new Map<string, number>();
    for (const command of commands()) {
      const tab = command.defaultPlacement.tab;
      byTab.set(tab, (byTab.get(tab) ?? 0) + 1);
    }
    for (const tab of ["General", ...COMMAND_TABS.document]) {
      expect(byTab.get(tab) ?? 0).toBeGreaterThan(2);
    }
    for (const tab of ["Table", "Image", "Equation"]) {
      expect(byTab.get(tab) ?? 0).toBeGreaterThan(1);
    }
  });

  it("keeps at most five essential commands in the General row", () => {
    const essential = bindings().filter(
      (binding, index) =>
        binding.priority === "essential" &&
        commandForBinding("document", binding, index).defaultPlacement.tab === "General",
    );
    expect(essential.length).toBeLessThanOrEqual(5);
  });

  it("gives every disabled command a sentence explaining why", () => {
    const unexplained = bindings()
      .filter((binding) => binding.disabled && (binding.hint ?? "").length <= 12)
      .map((binding) => binding.id);
    expect(unexplained).toEqual([]);
  });

  it("never claims to write a region Spectra only preserves", () => {
    const forbidden: FidelityRegionKey[] = [
      "macros",
      "customXml",
      "smartArt",
      "ole",
      "trackedChanges",
    ];
    for (const binding of bindings()) {
      for (const region of binding.touches ?? []) expect(forbidden).not.toContain(region);
    }
  });

  it("gives every strict-native refusal a concrete reason", () => {
    for (const binding of bindings()) {
      if (binding.strictNative?.available !== false) continue;
      expect((binding.strictNative.reason ?? "").length).toBeGreaterThan(24);
    }
  });

  it("declares an AI operation for every document verb the manifest names", () => {
    const declared = new Set(bindings().flatMap((binding) => [...(binding.manifestOps ?? [])]));
    for (const op of [
      "insert_blocks",
      "move_blocks",
      "format_blocks",
      "create_table",
      "insert_equation",
      "insert_callout",
      "add_citation",
      "add_embed",
      "apply_template",
      "prepare_export",
    ]) {
      expect(declared.has(op)).toBe(true);
    }
  });

  it("exports a stub whose shape matches the live handler type", () => {
    expect(documentCommandBindings(documentCommandStubHandlers).length).toBe(bindings().length);
  });
});

describe("document command dispatch", () => {
  it("routes a parameterized control through the one execute path", () => {
    const seen: string[] = [];
    const list = bindings((handlers) => ({
      ...handlers,
      format: {
        ...handlers.format,
        style: {
          ...handlers.format.style!,
          set: (value) => seen.push(`style:${value}`),
        },
      },
      page: { ...handlers.page, setColumns: (columns) => seen.push(`columns:${columns}`) },
    }));
    const style = list.find((binding) => binding.id === "format.style")!;
    const columns = list.find((binding) => binding.id === "layout.columns")!;
    const ctx = fullContext();
    executeCommand(commandForBinding("document", style, 0), ctx, "h2");
    executeCommand(commandForBinding("document", columns, 1), ctx, 2);
    expect(seen).toEqual(["style:h2", "columns:2"]);
  });

  it("registers every slash-menu verb, so the menu cannot drift from the bar", () => {
    const ids = new Set(commands().map((command) => command.id));
    const missing = DOCUMENT_SLASH_COMMANDS.filter((spec) => !ids.has(spec.commandId)).map(
      (spec) => `${spec.id} -> ${spec.commandId}`,
    );
    expect(missing).toEqual([]);
  });

  it("runs a slash verb through the same handler the bar calls", () => {
    const seen: string[] = [];
    const list = bindings((handlers) => ({
      ...handlers,
      insert: { ...handlers.insert, pageBreak: () => seen.push("pageBreak") },
    }));
    const spec = DOCUMENT_SLASH_COMMANDS.find((entry) => entry.id === "page-break")!;
    const entry = list
      .map((binding, index) => commandForBinding("document", binding, index))
      .find((command) => command.id === spec.commandId)!;
    executeCommand(entry, fullContext());
    expect(seen).toEqual(["pageBreak"]);
  });
});

describe("document honesty under strict-native", () => {
  it("refuses a template replacement, and says the file is the reason", () => {
    const binding = bindings().find((entry) => entry.id === "layout.template.essay")!;
    const availability = commandForBinding("document", binding, 0).availability(
      fullContext("strict-native"),
    );
    expect(availability.state).toBe("disabled");
    expect(availability.state === "disabled" ? availability.reason : "").toMatch(/Word file/i);
  });

  it("keeps table cell text available while refusing a shape change", () => {
    const list = bindings((handlers) => ({
      ...handlers,
      table: {
        ...handlers.table,
        nativeStructureReason:
          "Spectra edits the text inside a linked Word table, not its shape, so adding a row is unavailable here.",
      },
    }));
    const row = list.find((entry) => entry.id === "table.row.after")!;
    const availability = commandForBinding("document", row, 0).availability(
      fullContext("strict-native"),
    );
    expect(availability.state).toBe("disabled");
    expect(availability.state === "disabled" ? availability.reason : "").toBe(
      DOCUMENT_NATIVE_REASONS.tableStructure,
    );
  });

  it("disables a command whose touched region the linked file only preserves", () => {
    const binding = bindings().find((entry) => entry.id === "insert.footnote")!;
    const availability = commandForBinding("document", binding, 0).availability(
      fullContext("strict-native", { artifact: "NATIVE", footnotes: "PRESERVED" }),
    );
    expect(availability.state).toBe("disabled");
    expect(availability.state === "disabled" ? availability.reason : "").toBeTruthy();
  });

  it("leaves the comments panel reachable even when Word comment parts are preserved", () => {
    const binding = bindings().find((entry) => entry.id === "review.comments")!;
    expect(binding.touches ?? []).toEqual([]);
    const availability = commandForBinding("document", binding, 0).availability(
      fullContext("strict-native", { artifact: "NATIVE", comments: "PRESERVED" }),
    );
    expect(availability.state).toBe("enabled");
  });
});
