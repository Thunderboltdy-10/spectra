import { describe, expect, it } from "vitest";
import {
  OFFICE_FORMATTING_CAPABILITIES,
  PRESENTATION_TEXT_FORMAT_NATIVE_REASON,
  capabilityGhostIssues,
  formattingCapabilitiesFor,
  proposeOperationJsonSchemaFor,
  proposeOperationSchemaFor,
  type CapabilityDefinition,
} from "../capabilities";
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
} from "../commands/office/presentation-commands";
import {
  officeCapabilityAudit,
  officeOperationsFor,
} from "../commands/office/capability-audit";
import { commandContext, commandForBinding } from "../commands/registry";
import type { CommandBinding } from "../commands/types";

const SETS = [
  {
    type: "document" as const,
    bindings: documentCommandBindings(documentStubHandlers()),
  },
  {
    type: "sheets" as const,
    bindings: sheetsCommandBindings(sheetsStubHandlers()),
  },
  {
    type: "presentation" as const,
    bindings: presentationCommandBindings(presentationStubHandlers()),
  },
];

function visualSignature(binding: CommandBinding) {
  return [
    binding.id,
    binding.label,
    binding.tab ?? "",
    binding.contextualTab ?? "",
    binding.group ?? "",
    binding.priority ?? "secondary",
    binding.general ? "general" : "",
    binding.keepLabel ? "label" : "",
    binding.shortcut ?? "",
    binding.control?.kind ??
      (binding.active === undefined ? "button" : "toggle"),
  ].join("|");
}

describe("Office formatting capability IR", () => {
  it("projects every definition into the existing workbar exactly once", () => {
    for (const { type, bindings } of SETS) {
      const projected = bindings.filter((binding) => binding.capabilityId);
      expect(projected.map((binding) => binding.capabilityId)).toEqual(
        formattingCapabilitiesFor(type).map((definition) => definition.id),
      );
      expect(new Set(projected.map((binding) => binding.id)).size).toBe(
        projected.length,
      );
      for (const binding of projected) {
        const command = commandForBinding(type, binding, 0);
        expect(command.capabilityId).toBe(binding.capabilityId);
        expect(command.params).toBeTruthy();
        expect(command.nativeDelta).toBe(binding.nativeDelta);
      }
    }
  });

  it("retargets the capability audit from the aggregate manifest verb to IR ids", () => {
    const vocabulary = officeOperationsFor("document");
    expect(vocabulary).toContain("document.format.bold");
    expect(vocabulary).not.toContain("document.format.blocks");
    expect(vocabulary).toContain("document.insert.blocks");

    const entry = officeCapabilityAudit(
      "document",
      documentCommandBindings(documentStubHandlers()),
    ).find((candidate) => candidate.operation === "document.format.bold");
    expect(entry).toMatchObject({
      status: "registered",
      commandIds: ["document.format.bold"],
    });
  });

  it("keeps the authored workbar presentation unchanged", () => {
    const signatures = Object.fromEntries(
      SETS.map(({ type, bindings }) => [
        type,
        bindings.filter((binding) => binding.capabilityId).map(visualSignature),
      ]),
    );
    expect(signatures).toEqual({
      document: [
        "format.style|Style|Format||Styles|essential||||select",
        "format.fontFamily|Font|Format||Font|secondary|general|label||select",
        "format.fontSize|Size|Format||Font|secondary|general|label||numeric",
        "format.bold|Bold|Format||Font|essential|general||Mod+B|toggle",
        "format.italic|Italic|Format||Font|essential|general||Mod+I|toggle",
        "format.underline|Underline|Format||Font|essential|||Mod+U|toggle",
        "format.strike|Strikethrough|Format||Font|secondary|||Mod+Shift+X|toggle",
        "format.color|Text colour|Format||Font|secondary||||color",
        "format.highlight|Highlight|Format||Font|secondary||||color",
        "format.align|Alignment|Format||Paragraph|essential||||segmented",
        "format.lineSpacing|Line spacing|Format||Paragraph|secondary||||menu",
        "format.list.bullet|Bulleted list|Format||Lists|essential||||toggle",
        "format.list.numbered|Numbered list|Format||Lists|essential||||toggle",
        "format.indent.increase|Increase indent|Format||Paragraph|secondary||||button",
        "format.indent.decrease|Decrease indent|Format||Paragraph|secondary||||button",
        "format.clear|Clear formatting|Format||Font|secondary||||button",
      ],
      sheets: [
        "format.fontFamily|Font|Format||Font|essential||||select",
        "format.fontSize|Size|Format||Font|essential||label||numeric",
        "format.bold|Bold|Format||Font|essential|||Mod+B|toggle",
        "format.italic|Italic|Format||Font|essential|||Mod+I|toggle",
        "format.underline|Underline|Format||Font|essential|||Mod+U|toggle",
        "format.strike|Strikethrough|Format||Font|essential|||Mod+Shift+X|toggle",
        "format.color|Text colour|Format||Font|secondary||||color",
        "format.align|Alignment|Format||Paragraph|essential||||segmented",
        "format.clear|Clear formatting|Format||Font|secondary||||button",
      ],
      presentation: [
        "format.fontFamily|Font||Shape|Font|essential||||select",
        "format.fontSize|Size||Shape|Font|essential||label||numeric",
        "format.bold|Bold||Shape|Font|essential|||Mod+B|toggle",
        "format.italic|Italic||Shape|Font|essential|||Mod+I|toggle",
        "format.underline|Underline||Shape|Font|essential|||Mod+U|toggle",
        "format.strike|Strikethrough||Shape|Font|essential|||Mod+Shift+X|toggle",
        "format.color|Text colour||Shape|Font|secondary||||color",
        "format.align|Alignment||Shape|Paragraph|essential||||segmented",
        "format.lineSpacing|Line spacing||Shape|Paragraph|secondary||||menu",
        "format.list.bullet|Bulleted list||Shape|Lists|essential||||toggle",
        "format.list.numbered|Numbered list||Shape|Lists|essential||||toggle",
        "format.clear|Clear formatting||Shape|Font|secondary||||button",
      ],
    });
  });

  it("generates typed propose_operation variants from the one params schema", () => {
    const documentSchema = proposeOperationSchemaFor("document");
    expect(
      documentSchema.safeParse({
        capabilityId: "document.format.bold",
        params: true,
      }).success,
    ).toBe(true);
    expect(
      documentSchema.safeParse({
        capabilityId: "document.format.bold",
        params: "yes",
      }).success,
    ).toBe(false);
    expect(
      documentSchema.safeParse({
        capabilityId: "document.format.fontSize",
        params: 900,
      }).success,
    ).toBe(false);
    expect(
      documentSchema.safeParse({
        capabilityId: "sheets.format.bold",
        params: true,
      }).success,
    ).toBe(false);

    const json = JSON.stringify(proposeOperationJsonSchemaFor("document"));
    expect(json).toContain("document.format.bold");
    expect(json).toContain('"type":"boolean"');
    expect(json).not.toContain('additionalProperties":true');

    for (const type of ["document", "sheets", "presentation"] as const) {
      const generated = JSON.stringify(proposeOperationJsonSchemaFor(type));
      for (const definition of formattingCapabilitiesFor(type)) {
        if (definition.ai.exposed) expect(generated).toContain(definition.id);
      }
    }
  });

  it("fails ghosts against imported lens delta schemas", () => {
    expect(capabilityGhostIssues()).toEqual([]);
    const broken = {
      ...OFFICE_FORMATTING_CAPABILITIES[0],
      native: {
        ...OFFICE_FORMATTING_CAPABILITIES[0].native,
        delta: "format-fiction",
      },
    } as unknown as CapabilityDefinition;
    expect(capabilityGhostIssues([broken])).toEqual(
      expect.arrayContaining([
        expect.stringContaining("lens schema does not implement"),
      ]),
    );
    const withoutStyle = OFFICE_FORMATTING_CAPABILITIES.filter(
      (definition) => definition.id !== "document.format.style",
    );
    expect(capabilityGhostIssues(withoutStyle)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "document.apply-style: the lens implements this formatting delta but no capability claims it",
        ),
      ]),
    );
  });

  it("uses the same refusal for an IR definition and its workbar command", () => {
    const definition = formattingCapabilitiesFor("presentation").find(
      (candidate) => candidate.id === "presentation.format.bold",
    )!;
    const binding = SETS.find(
      (entry) => entry.type === "presentation",
    )!.bindings.find((candidate) => candidate.id === "format.bold")!;
    const ctx = {
      ...commandContext("presentation", () => true, "edit"),
      compatibilityProfile: "strict-native" as const,
      fidelity: { shapes: "NATIVE" as const },
    };
    const fromDefinition = definition.availability(ctx);
    const fromCommand = commandForBinding(
      "presentation",
      binding,
      0,
    ).availability(ctx);
    expect(fromDefinition).toEqual({
      state: "disabled",
      reason: PRESENTATION_TEXT_FORMAT_NATIVE_REASON,
    });
    expect(fromCommand).toEqual(fromDefinition);
  });
});
