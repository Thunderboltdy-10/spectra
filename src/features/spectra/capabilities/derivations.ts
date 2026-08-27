import { z } from "zod";
import type {
  CommandBinding,
  CommandContext,
  CommandParam,
} from "../commands/types";
import {
  DOCX_LENS_DELTA_KINDS,
  PPTX_LENS_DELTA_KINDS,
  XLSX_LENS_DELTA_KINDS,
} from "../lenses/projection-contracts";
import type { WorkType } from "../work/registry";
import { ALL_CAPABILITIES, capabilityForLocalId, officeCapabilitiesFor } from "./catalog";
import type { CapabilityDefinition, OfficeWorkType } from "./types";

type CapabilityOwnedBindingField =
  | "id"
  | "capabilityId"
  | "params"
  | "availability"
  | "touches"
  | "nativeDelta"
  | "manifestOps"
  | "risk"
  | "requires"
  | "strictNative"
  | "ai"
  | "choreography";

/** The only hand-authored remainder: how an operation appears in the workbar. */
export type CapabilityBindingPresentation = Omit<
  CommandBinding,
  CapabilityOwnedBindingField
> & { id?: string };

function ownerFromId(id: string): string {
  return id.split(".")[0] ?? id;
}

function localIdFromDefinition(definition: CapabilityDefinition, presentationId?: string) {
  if (presentationId) return presentationId;
  const prefix = `${ownerFromId(definition.id)}.`;
  return definition.id.slice(prefix.length);
}

/** Project capability truth into the existing workbar binding contract. */
export function commandBindingFromCapability(
  definition: CapabilityDefinition,
  presentation: CapabilityBindingPresentation,
): CommandBinding {
  return {
    ...presentation,
    id: localIdFromDefinition(definition, presentation.id),
    capabilityId: definition.id,
    params: definition.params as z.ZodType<CommandParam>,
    availability: definition.availability,
    ...(definition.native?.touches
      ? { touches: definition.native.touches }
      : {}),
    ...(definition.native?.delta
      ? { nativeDelta: definition.native.delta }
      : {}),
    ...(definition.manifestOperation
      ? { manifestOps: [definition.manifestOperation] }
      : {}),
    risk: definition.ai.riskClass,
    ...(definition.requires ? { requires: definition.requires } : {}),
    ...(definition.native && !definition.native.delta
      ? {
          strictNative: {
            available: false,
            reason: definition.native.unavailableReason,
          },
        }
      : {}),
    ai: definition.ai,
    ...(definition.choreography
      ? { choreography: definition.choreography }
      : {}),
  };
}

const OWNED_BINDING_FIELDS = [
  "capabilityId",
  "params",
  "availability",
  "touches",
  "nativeDelta",
  "manifestOps",
  "risk",
  "requires",
  "strictNative",
  "ai",
  "choreography",
] as const;

function presentationOnly(
  binding: CommandBinding,
): CapabilityBindingPresentation & { id: string } {
  const presentation: Record<string, unknown> = { ...binding };
  for (const field of OWNED_BINDING_FIELDS) {
    delete presentation[field];
  }
  return presentation as CapabilityBindingPresentation & { id: string };
}

function mergeManifestOps(
  specialized: string | undefined,
  original: readonly string[] | undefined,
): string[] | undefined {
  const merged: string[] = [];
  if (specialized) merged.push(specialized);
  for (const operation of original ?? []) {
    if (!merged.includes(operation)) merged.push(operation);
  }
  return merged.length ? merged : undefined;
}

/**
 * Overwrite IR-owned fields on authored workbar bindings. Presentation
 * (label, icon, tab, control, shortcut, execute) stays as written.
 */
export function projectBindingsFromIr(
  type: WorkType,
  bindings: readonly CommandBinding[],
): CommandBinding[] {
  return bindings.map((binding) => {
    if (binding.capabilityId) return binding;
    const definition = capabilityForLocalId(type, binding.id);
    if (!definition) {
      throw new Error(`CAPABILITY_DEFINITION_MISSING: ${type}.${binding.id}`);
    }
    const projected = commandBindingFromCapability(
      definition,
      presentationOnly(binding),
    );
    const manifestOps = mergeManifestOps(
      definition.manifestOperation,
      binding.manifestOps,
    );
    return manifestOps ? { ...projected, manifestOps } : projected;
  });
}

export type ProposedCapabilityOperation = {
  capabilityId: string;
  params: unknown;
};

/**
 * Generate the per-type `propose_operation` union from the IR parameter
 * schemas. No unknown-record envelope survives this projection.
 */
export function proposeOperationSchemaFor(
  type: OfficeWorkType,
): z.ZodType<ProposedCapabilityOperation> {
  const variants = officeCapabilitiesFor(type)
    .filter((definition) => definition.ai.exposed)
    .map((definition) =>
      z
        .object({
          capabilityId: z.literal(definition.id),
          params: definition.params,
        })
        .strict(),
    );
  if (variants.length === 0) {
    throw new Error(`CAPABILITY_AI_SCHEMA_EMPTY: ${type}`);
  }
  if (variants.length === 1) {
    return variants[0] as z.ZodType<ProposedCapabilityOperation>;
  }
  return z.union(
    variants as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]],
  ) as z.ZodType<ProposedCapabilityOperation>;
}

export function proposeOperationJsonSchemaFor(type: OfficeWorkType) {
  return z.toJSONSchema(proposeOperationSchemaFor(type), {
    target: "draft-7",
  });
}

const LENS_DELTA_KINDS: Record<OfficeWorkType, ReadonlySet<string>> = {
  document: new Set(DOCX_LENS_DELTA_KINDS),
  sheets: new Set(XLSX_LENS_DELTA_KINDS),
  presentation: new Set(PPTX_LENS_DELTA_KINDS),
};

function strictNativeContext(type: OfficeWorkType): CommandContext {
  return {
    workType: type,
    can: () => true,
    compatibilityProfile: "strict-native",
    fidelity: {
      artifact: "NATIVE",
      body: "NATIVE",
      styles: "NATIVE",
      lists: "NATIVE",
      numberFormats: "NATIVE",
      shapes: "NATIVE",
      slides: "NATIVE",
      speakerNotes: "NATIVE",
      cells: "NATIVE",
      formulas: "NATIVE",
      freezePanes: "NATIVE",
      merges: "NATIVE",
    },
    selection: { ids: [] },
    permissions: { role: "edit", editable: true },
  };
}

function definitionType(
  definition: CapabilityDefinition,
): OfficeWorkType | null {
  const type = definition.id.split(".")[0] as WorkType;
  return type === "document" || type === "sheets" || type === "presentation"
    ? type
    : null;
}

/**
 * Build-time ghost gate. It imports the real Zod lens schemas' derived kinds;
 * it never scans source strings or trusts a parallel handwritten lens list.
 */
export function capabilityGhostIssues(
  definitions: readonly CapabilityDefinition[] = ALL_CAPABILITIES,
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  const claimed = new Map<OfficeWorkType, Set<string>>([
    ["document", new Set()],
    ["sheets", new Set()],
    ["presentation", new Set()],
  ]);

  for (const definition of definitions) {
    if (seen.has(definition.id)) {
      issues.push(
        `${definition.id}: capability id is registered more than once.`,
      );
    }
    seen.add(definition.id);

    if (!definition.execute.editor && !definition.execute.server) {
      issues.push(`${definition.id}: capability has no execution reference.`);
    }
    if (definition.ai.exposed && !definition.ai.description.trim()) {
      issues.push(`${definition.id}: AI exposure has no description.`);
    }

    const type = definitionType(definition);
    if (!type) continue;
    if (!definition.native) continue;

    const availability = definition.availability(strictNativeContext(type));
    if (definition.native.delta) {
      if (!LENS_DELTA_KINDS[type].has(definition.native.delta)) {
        issues.push(
          `${definition.id}: names lens delta "${definition.native.delta}", which the ${type} lens schema does not implement.`,
        );
      } else {
        claimed.get(type)!.add(definition.native.delta);
      }
      if (availability.state !== "enabled") {
        issues.push(
          `${definition.id}: has a real native delta but refuses a fully native linked file.`,
        );
      }
    } else {
      if (!definition.native.unavailableReason?.trim()) {
        issues.push(
          `${definition.id}: has no native delta and no plain-language strict-native refusal.`,
        );
      }
      if (
        availability.state !== "disabled" ||
        availability.reason !== definition.native.unavailableReason
      ) {
        issues.push(
          `${definition.id}: has no native delta but does not refuse through its one availability function.`,
        );
      }
    }
  }

  for (const type of ["document", "sheets", "presentation"] as const) {
    for (const delta of LENS_DELTA_KINDS[type]) {
      if (!claimed.get(type)!.has(delta)) {
        issues.push(
          `${type}.${delta}: the lens implements this delta but no capability claims it.`,
        );
      }
    }
  }

  return issues;
}

export function assertCapabilityIrGate() {
  const issues = capabilityGhostIssues();
  if (issues.length) {
    throw new Error(`Capability IR ghost gate failed:\n${issues.join("\n")}`);
  }
}

/** @deprecated Use assertCapabilityIrGate. Kept so existing call sites compile during migration. */
export const assertOfficeFormattingCapabilityGate = assertCapabilityIrGate;
