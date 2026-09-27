import { describe, expect, it } from "vitest";
import {
  ALL_CAPABILITIES,
  APPLICATION_CAPABILITIES,
  DOCUMENT_EXPORT_COPIES,
  PRESENTATION_EXPORT_COPIES,
  SHEETS_EXPORT_COPIES,
  STUDIO_CAPABILITIES,
  capabilityGhostIssues,
  officeCapabilitiesFor,
  projectBindingsFromIr,
  proposeOperationJsonSchemaFor,
  proposeOperationSchemaFor,
} from "../capabilities";
import { APP_COMMANDS } from "../commands/app-registry";
import {
  documentCommandBindings,
  documentStubHandlers,
} from "../commands/office/document-commands";
import {
  presentationCommandBindings,
  presentationStubHandlers,
} from "../commands/office/presentation-commands";
import {
  sheetsCommandBindings,
  sheetsStubHandlers,
} from "../commands/office/sheets-commands";
import {
  DOCX_LENS_DELTA_KINDS,
  PPTX_LENS_DELTA_KINDS,
  XLSX_LENS_DELTA_KINDS,
} from "../lenses/projection-contracts";
import type { WorkType } from "../work/registry";

const OFFICE = ["document", "sheets", "presentation"] as const;
const STUDIOS = [
  "quiz",
  "flashcard_deck",
  "code",
  "whiteboard",
  "planner_task",
  "agent",
] as const;

const OFFICE_BINDINGS = {
  document: documentCommandBindings(documentStubHandlers()),
  sheets: sheetsCommandBindings(sheetsStubHandlers()),
  presentation: presentationCommandBindings(presentationStubHandlers()),
} as const;

const LENS_KINDS = {
  document: new Set(DOCX_LENS_DELTA_KINDS),
  sheets: new Set(XLSX_LENS_DELTA_KINDS),
  presentation: new Set(PPTX_LENS_DELTA_KINDS),
} as const;

const PARAM_SAMPLES: unknown[] = [
  null,
  true,
  false,
  0,
  1,
  11,
  1.5,
  "x",
  "left",
  "Georgia",
  "#101828",
  // Enumerated scalars, e.g. the native PPTX transition kinds.
  "fade",
];

describe("P3.V1 protocol conformance", () => {
  it("registers every capability id exactly once", () => {
    const ids = ALL_CAPABILITIES.map((definition) => definition.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("fails ghosts against imported lens delta kinds, not string scans", () => {
    expect(capabilityGhostIssues()).toEqual([]);
    for (const type of OFFICE) {
      for (const definition of officeCapabilitiesFor(type)) {
        const delta = definition.native?.delta;
        if (!delta) continue;
        expect((LENS_KINDS[type] as ReadonlySet<string>).has(delta)).toBe(true);
      }
    }
    expect(DOCX_LENS_DELTA_KINDS).not.toContain("format-fiction");
  });

  it("projects every Office definition into a reachable UI surface and every binding into the IR", () => {
    const canvasReachable: Record<(typeof OFFICE)[number], readonly string[]> = {
      document: ["document.rewrite.paragraph", "document.edit.tableCell"],
      sheets: [],
      presentation: [
        "presentation.table.cellText",
        "presentation.table.cellFormat",
      ],
    };

    const sheetsWithNativeObjects = sheetsCommandBindings(
      (() => {
        const handlers = sheetsStubHandlers();
        handlers.chart.nativeChartNote =
          "This chart stays in Excel; Spectra keeps its bytes.";
        handlers.data.pivotPreservedNote =
          "Spectra keeps this pivot table exactly as Excel wrote it.";
        return handlers;
      })(),
    );

    for (const type of OFFICE) {
      const bindings =
        type === "sheets" ? sheetsWithNativeObjects : OFFICE_BINDINGS[type];
      const fromBar = bindings.map((binding) => binding.capabilityId);
      expect(fromBar.every(Boolean)).toBe(true);
      expect(new Set(fromBar).size).toBe(fromBar.length);

      const fromIr = officeCapabilitiesFor(type).map(
        (definition) => definition.id,
      );
      const reachable = new Set([...fromBar, ...canvasReachable[type]]);
      expect([...fromIr].sort()).toEqual([...reachable].sort());
    }

    expect(
      officeCapabilitiesFor("presentation").map((definition) => definition.id),
    ).toEqual(
      expect.arrayContaining(
        PRESENTATION_EXPORT_COPIES.map((copy) => `presentation.export.${copy.format}`),
      ),
    );
    expect(
      officeCapabilitiesFor("sheets").map((definition) => definition.id),
    ).not.toContain("sheets.export.pdf");
    expect(
      officeCapabilitiesFor("document").map((definition) => definition.id),
    ).toEqual(
      expect.arrayContaining(
        DOCUMENT_EXPORT_COPIES.map((copy) => `document.export.${copy.format}`),
      ),
    );
    expect(SHEETS_EXPORT_COPIES.map((copy) => copy.format)).toEqual([
      "xlsx",
      "csv",
      "ods",
    ]);
  });

  it("keeps every AI-exposed Office definition inside the generated propose_operation schema", () => {
    for (const type of OFFICE) {
      const schema = proposeOperationSchemaFor(type);
      const json = JSON.stringify(proposeOperationJsonSchemaFor(type));
      expect(json).not.toContain('"additionalProperties":true');

      for (const definition of officeCapabilitiesFor(type)) {
        if (!definition.ai.exposed) continue;
        expect(json).toContain(definition.id);
        expect(definition.ai.description.trim().length).toBeGreaterThan(0);
        const accepted = PARAM_SAMPLES.filter(
          (params) =>
            schema.safeParse({ capabilityId: definition.id, params }).success,
        );
        expect(accepted.length).toBeGreaterThan(0);
        expect(
          schema.safeParse({
            capabilityId: definition.id,
            params: { not: "a scalar the IR declared" },
          }).success,
        ).toBe(false);
      }
    }
  });

  it("renders shared formatting through one label, shortcut, and control kind (D41)", () => {
    const shared = [
      {
        local: "format.fontFamily",
        label: "Font",
        kind: "select",
      },
      {
        local: "format.fontSize",
        label: "Size",
        kind: "numeric",
      },
      {
        local: "format.bold",
        label: "Bold",
        kind: "toggle",
        shortcut: "Mod+B",
      },
      {
        local: "format.italic",
        label: "Italic",
        kind: "toggle",
        shortcut: "Mod+I",
      },
    ] as const;

    for (const spec of shared) {
      for (const type of OFFICE) {
        const binding = OFFICE_BINDINGS[type].find(
          (candidate) => candidate.capabilityId === `${type}.${spec.local}`,
        );
        expect(binding, `${type}.${spec.local} missing from workbar`).toBeTruthy();
        expect(binding!.label).toBe(spec.label);
        expect(binding!.control?.kind ?? "toggle").toBe(spec.kind);
        if ("shortcut" in spec) expect(binding!.shortcut).toBe(spec.shortcut);
      }
    }
  });

  it("projects every application definition onto the shared app command surface", () => {
    const fromCommands = APP_COMMANDS.map((command) => command.capabilityId ?? command.id);
    const fromIr = APPLICATION_CAPABILITIES.map((definition) => definition.id);
    expect([...fromCommands].sort()).toEqual([...fromIr].sort());

    for (const definition of APPLICATION_CAPABILITIES) {
      const command = APP_COMMANDS.find((candidate) => candidate.id === definition.id);
      expect(command).toBeTruthy();
      expect(command!.availability).toBe(definition.availability);
      expect(command!.risk).toBe(definition.ai.riskClass);
      if (definition.ai.exposed) {
        expect(definition.ai.description.trim().length).toBeGreaterThan(0);
        expect(command!.aiAuthority).toBe("allowed");
      } else {
        expect(command!.aiAuthority).toBe("prohibited");
      }
    }
  });

  it("lets every non-Office studio definition project through the same binding helper", () => {
    for (const type of STUDIOS) {
      const definitions = STUDIO_CAPABILITIES.filter((definition) =>
        definition.id.startsWith(`${type}.`),
      );
      expect(definitions.length).toBeGreaterThan(0);
      const projected = projectBindingsFromIr(
        type as WorkType,
        definitions.map((definition) => ({
          id: definition.id.slice(`${type}.`.length),
          label: definition.ai.description,
          onSelect: () => {},
        })),
      );
      expect(projected.map((binding) => binding.capabilityId)).toEqual(
        definitions.map((definition) => definition.id),
      );
    }
  });
});
