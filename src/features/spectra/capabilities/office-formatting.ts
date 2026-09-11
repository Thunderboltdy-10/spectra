import { z } from "zod";
import { preservedRegionRefusal } from "../commands/registry";
import type {
  CapabilityDefinition,
  NativeCapability,
  OfficeWorkType,
} from "./types";
import { availabilityFor } from "./native";
import { PRESENTATION_TEXT_FORMAT_NATIVE_REASON } from "./office-reasons";

export { PRESENTATION_TEXT_FORMAT_NATIVE_REASON };

const FORMATTING_IDS = [
  "format.style",
  "format.fontFamily",
  "format.fontSize",
  "format.bold",
  "format.italic",
  "format.underline",
  "format.strike",
  "format.color",
  "format.highlight",
  "format.align",
  "format.lineSpacing",
  "format.list.bullet",
  "format.list.numbered",
  "format.indent.increase",
  "format.indent.decrease",
  "format.clear",
] as const;

export type FormattingCapabilityLocalId = (typeof FORMATTING_IDS)[number];

const PARAMS_BY_ID = {
  "format.style": z.string().min(1).max(160),
  "format.fontFamily": z.string().min(1).max(300),
  "format.fontSize": z.number().min(4).max(400),
  "format.bold": z.boolean(),
  "format.italic": z.boolean(),
  "format.underline": z.boolean(),
  "format.strike": z.boolean(),
  "format.color": z.string().nullable(),
  "format.highlight": z.string().nullable(),
  "format.align": z.enum(["left", "center", "right", "justify"]),
  "format.lineSpacing": z.number().min(0.5).max(4),
  "format.list.bullet": z.boolean(),
  "format.list.numbered": z.boolean(),
  "format.indent.increase": z.null(),
  "format.indent.decrease": z.null(),
  "format.clear": z.null(),
} satisfies Record<FormattingCapabilityLocalId, z.ZodType>;

const DESCRIPTION_BY_ID: Record<FormattingCapabilityLocalId, string> = {
  "format.style":
    "Apply a named text or paragraph style to the current selection.",
  "format.fontFamily": "Set the font family for the current selection.",
  "format.fontSize": "Set the font size for the current selection.",
  "format.bold": "Set bold formatting on the current selection.",
  "format.italic": "Set italic formatting on the current selection.",
  "format.underline": "Set underline formatting on the current selection.",
  "format.strike": "Set strikethrough formatting on the current selection.",
  "format.color": "Set or clear the text colour on the current selection.",
  "format.highlight": "Set or clear the highlight on the current selection.",
  "format.align": "Set horizontal alignment for the current selection.",
  "format.lineSpacing": "Set line spacing for the current selection.",
  "format.list.bullet":
    "Turn a bulleted list on or off for the current selection.",
  "format.list.numbered":
    "Turn a numbered list on or off for the current selection.",
  "format.indent.increase":
    "Increase the indentation of the current selection.",
  "format.indent.decrease":
    "Decrease the indentation of the current selection.",
  "format.clear": "Clear direct formatting from the current selection.",
};

const DOCUMENT_FORMATTING_IDS = FORMATTING_IDS;
const SHEETS_FORMATTING_IDS = [
  "format.fontFamily",
  "format.fontSize",
  "format.bold",
  "format.italic",
  "format.underline",
  "format.strike",
  "format.color",
  "format.align",
  "format.clear",
] as const satisfies readonly FormattingCapabilityLocalId[];
const PRESENTATION_FORMATTING_IDS = [
  "format.fontFamily",
  "format.fontSize",
  "format.bold",
  "format.italic",
  "format.underline",
  "format.strike",
  "format.color",
  "format.align",
  "format.lineSpacing",
  "format.list.bullet",
  "format.list.numbered",
  "format.clear",
] as const satisfies readonly FormattingCapabilityLocalId[];

function documentNative(
  id: FormattingCapabilityLocalId,
): NativeCapability<"document"> {
  if (id === "format.style") {
    return { touches: ["styles"], delta: "apply-style" };
  }
  if (id === "format.list.bullet" || id === "format.list.numbered") {
    return {
      touches: ["lists"],
      unavailableReason: preservedRegionRefusal("lists"),
    };
  }
  if (
    id === "format.align" ||
    id === "format.lineSpacing" ||
    id === "format.indent.increase" ||
    id === "format.indent.decrease"
  ) {
    return { touches: ["body"], delta: "format-paragraph" };
  }
  return { touches: ["body"], delta: "format-runs" };
}

function nativeFor<T extends OfficeWorkType>(
  type: T,
  id: FormattingCapabilityLocalId,
): NativeCapability<T> {
  if (type === "document") {
    return documentNative(id) as NativeCapability<T>;
  }
  if (type === "sheets") {
    // Preserve the current cell-format gate exactly. The editor's format patch
    // carries both style and number-format state through one lens delta.
    return {
      touches: ["styles", "numberFormats"],
      delta: "set-cell-format",
    } as unknown as NativeCapability<T>;
  }
  return {
    touches: ["shapes"],
    delta: "format-text",
  } as unknown as NativeCapability<T>;
}

function definitionsFor<T extends OfficeWorkType>(
  type: T,
  ids: readonly FormattingCapabilityLocalId[],
): readonly CapabilityDefinition<T>[] {
  const definitions = ids.map((localId) => {
    const id = `${type}.${localId}` as const;
    const native = nativeFor(type, localId);
    return {
      id,
      params: PARAMS_BY_ID[localId],
      scope: "artifact",
      availability: availabilityFor(native as NativeCapability<OfficeWorkType>),
      native,
      execute: { editor: id },
      ai: {
        exposed: true,
        description: DESCRIPTION_BY_ID[localId],
        riskClass: "safe",
      },
      choreography: {
        target:
          localId === "format.fontFamily" ||
          localId === "format.fontSize" ||
          localId === "format.color" ||
          localId === "format.highlight" ||
          localId === "format.align" ||
          localId === "format.lineSpacing" ||
          localId === "format.style"
            ? "workbar-field"
            : "workbar-command",
        region: id,
      },
      requires: "edit",
      ...(type === "document"
        ? { manifestOperation: "format_blocks" }
        : type === "sheets"
          ? { manifestOperation: "format_range" }
          : {}),
    };
  });
  // TypeScript does not reduce a conditional property through a generic even
  // though T is constrained to OfficeWorkType. This generator creates `id`
  // and `native` from the same T, so preserve that correlation at this one
  // construction boundary instead of widening CapabilityDefinition globally.
  return definitions as unknown as readonly CapabilityDefinition<T>[];
}

export const DOCUMENT_FORMATTING_CAPABILITIES = definitionsFor(
  "document",
  DOCUMENT_FORMATTING_IDS,
);
export const SHEETS_FORMATTING_CAPABILITIES = definitionsFor(
  "sheets",
  SHEETS_FORMATTING_IDS,
);
export const PRESENTATION_FORMATTING_CAPABILITIES = definitionsFor(
  "presentation",
  PRESENTATION_FORMATTING_IDS,
);

export const OFFICE_FORMATTING_CAPABILITIES = [
  ...DOCUMENT_FORMATTING_CAPABILITIES,
  ...SHEETS_FORMATTING_CAPABILITIES,
  ...PRESENTATION_FORMATTING_CAPABILITIES,
] as const;

const CAPABILITIES_BY_TYPE = {
  document: DOCUMENT_FORMATTING_CAPABILITIES,
  sheets: SHEETS_FORMATTING_CAPABILITIES,
  presentation: PRESENTATION_FORMATTING_CAPABILITIES,
} as const;

export function formattingCapabilitiesFor<T extends OfficeWorkType>(
  type: T,
): readonly CapabilityDefinition<T>[] {
  return CAPABILITIES_BY_TYPE[type] as readonly CapabilityDefinition<T>[];
}

export function formattingCapability<T extends OfficeWorkType>(
  type: T,
  localId: FormattingCapabilityLocalId,
): CapabilityDefinition<T> {
  const id = `${type}.${localId}`;
  const definition = formattingCapabilitiesFor(type).find(
    (candidate) => candidate.id === id,
  );
  if (!definition) {
    throw new Error(`CAPABILITY_DEFINITION_MISSING: ${id}`);
  }
  return definition;
}
