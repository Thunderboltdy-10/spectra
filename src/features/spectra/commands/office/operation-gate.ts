import { capabilityById, capabilityForLocalId, capabilitiesFor } from "../../capabilities";
import type { CapabilityDefinition } from "../../capabilities";
import type { WorkType } from "../../work/registry";
import {
  commandContext,
  commandForBinding,
  preservedRegionRefusal,
  regionBlockedBy,
} from "../registry";
import type {
  CommandBinding,
  CompatibilityProfile,
  FidelityClass,
  FidelityRegionKey,
} from "../types";
import { manifestOperationId } from "./capability-audit";

/**
 * The fidelity gate, addressed by AI operation instead of by command.
 *
 * Human availability and this gate must answer the same question with the same
 * sentence (C2). The IR is the source: a missing lens delta is a refusal even
 * when the region reads NATIVE, matching `availabilityFor`. Bindings remain a
 * fallback so a test (or a live command set) can name regions the IR has not
 * specialized yet.
 */

export function operationRegionIndex(
  type: WorkType,
  bindings: readonly CommandBinding[],
): Map<string, readonly FidelityRegionKey[]> {
  const index = new Map<string, FidelityRegionKey[]>();
  for (const [order, binding] of bindings.entries()) {
    const command = commandForBinding(type, binding, order);
    const keys = [
      ...(command.manifestOps ?? []).map((op) => manifestOperationId(type, op)),
      ...(command.capabilityId ? [command.capabilityId] : []),
      command.id,
    ];
    for (const id of keys) {
      const regions = index.get(id) ?? [];
      for (const region of command.touches ?? []) {
        if (!regions.includes(region)) regions.push(region);
      }
      index.set(id, regions);
    }
  }
  return index;
}

export type OperationGateInput = {
  type: WorkType;
  /** Capability id, local id, or manifest verb (`format_blocks` / `document.format.bold`). */
  operation: string;
  bindings?: readonly CommandBinding[];
  compatibilityProfile: CompatibilityProfile;
  fidelity: Readonly<Record<string, FidelityClass>>;
};

export type OperationGateResult =
  | { allowed: true }
  | { allowed: false; reason: string; region?: FidelityRegionKey };

function resolveCapability(
  type: WorkType,
  operation: string,
): CapabilityDefinition | undefined {
  return (
    capabilityById(operation) ??
    capabilityById(`${type}.${operation}`) ??
    capabilityForLocalId(type, operation) ??
    capabilitiesFor(type).find((definition) => {
      if (!definition.manifestOperation) return false;
      const manifest = manifestOperationId(type, definition.manifestOperation);
      return (
        manifest === operation ||
        manifest === manifestOperationId(type, operation) ||
        definition.manifestOperation === operation
      );
    })
  );
}

function matchingBindings(
  type: WorkType,
  operation: string,
  bindings: readonly CommandBinding[],
) {
  const qualified = manifestOperationId(type, operation);
  return bindings.flatMap((binding, order) => {
    const command = commandForBinding(type, binding, order);
    const keys = [
      command.id,
      command.capabilityId,
      ...(command.manifestOps ?? []).map((op) => manifestOperationId(type, op)),
    ].filter((value): value is string => Boolean(value));
    return keys.includes(operation) || keys.includes(qualified)
      ? [{ binding, command, order }]
      : [];
  });
}

/**
 * Whether the assistant may perform this operation on this artifact. The reason
 * is the same string the person reads on the disabled control, so an explanation
 * in chat and an explanation in the workbar never contradict each other.
 */
export function gateOperation(input: OperationGateInput): OperationGateResult {
  if (input.compatibilityProfile !== "strict-native") return { allowed: true };
  const ctx = commandContext(input.type, () => true, "edit", undefined, {
    compatibilityProfile: input.compatibilityProfile,
    fidelity: input.fidelity,
  });
  const definition = resolveCapability(input.type, input.operation);
  if (definition) {
    const availability = definition.availability(ctx);
    if (availability.state === "disabled") {
      const blocked = regionBlockedBy(input.fidelity, definition.native?.touches);
      return {
        allowed: false,
        reason: availability.reason,
        ...(blocked ? { region: blocked.region } : {}),
      };
    }
    if (availability.state === "hidden") {
      return {
        allowed: false,
        reason: "This change is not available with your current access.",
      };
    }
  }

  const bindings = input.bindings ?? [];
  const matches = matchingBindings(input.type, input.operation, bindings);
  for (const match of matches) {
    const availability = match.command.availability(ctx);
    if (availability.state === "disabled") {
      const blocked = regionBlockedBy(input.fidelity, match.command.touches);
      return {
        allowed: false,
        reason: availability.reason,
        ...(blocked ? { region: blocked.region } : {}),
      };
    }
  }

  if (!definition && matches.length === 0 && bindings.length > 0) {
    const operation = manifestOperationId(input.type, input.operation);
    const regions = operationRegionIndex(input.type, bindings).get(operation);
    if (!regions?.length) return { allowed: true };
    const blocked = regionBlockedBy(input.fidelity, regions);
    if (!blocked) return { allowed: true };
    return {
      allowed: false,
      reason: preservedRegionRefusal(blocked.region),
      region: blocked.region,
    };
  }

  return { allowed: true };
}

/**
 * Every operation the assistant must decline on this artifact, so a refusal can
 * be stated up front rather than discovered halfway through a plan.
 */
export function refusedOperations(
  type: WorkType,
  bindings: readonly CommandBinding[],
  compatibilityProfile: CompatibilityProfile,
  fidelity: Readonly<Record<string, FidelityClass>>,
): Array<{ operation: string; region: FidelityRegionKey; reason: string }> {
  if (compatibilityProfile !== "strict-native") return [];
  const ctx = commandContext(type, () => true, "edit", undefined, {
    compatibilityProfile,
    fidelity,
  });
  const refused: Array<{ operation: string; region: FidelityRegionKey; reason: string }> = [];
  const seen = new Set<string>();
  const push = (
    operation: string,
    reason: string,
    region?: FidelityRegionKey,
  ) => {
    if (seen.has(operation) || !region) return;
    seen.add(operation);
    refused.push({ operation, region, reason });
  };

  if (bindings.length > 0) {
    for (const [order, binding] of bindings.entries()) {
      const command = commandForBinding(type, binding, order);
      const availability = command.availability(ctx);
      if (availability.state !== "disabled") continue;
      const blocked = regionBlockedBy(fidelity, command.touches);
      const operation = command.manifestOps?.[0]
        ? manifestOperationId(type, command.manifestOps[0])
        : (command.capabilityId ?? command.id);
      push(operation, availability.reason, blocked?.region);
    }
    return refused.sort((left, right) => left.operation.localeCompare(right.operation));
  }

  for (const definition of capabilitiesFor(type)) {
    const availability = definition.availability(ctx);
    if (availability.state !== "disabled") continue;
    const blocked = regionBlockedBy(fidelity, definition.native?.touches);
    push(definition.id, availability.reason, blocked?.region);
  }
  return refused.sort((left, right) => left.operation.localeCompare(right.operation));
}

const IMPLIED_WRITE_OPERATION: Partial<Record<WorkType, string>> = {
  document: "document.rewrite.paragraph",
  sheets: "set_cells",
  presentation: "presentation.object.setText",
};

/** Whole-content AI updates have no typed capability id yet; gate the rewrite. */
export function impliedWriteOperations(type: WorkType): string[] {
  const operation = IMPLIED_WRITE_OPERATION[type];
  return operation ? [operation] : [];
}

export function gateAiArtifactMutation(input: {
  type: WorkType;
  operations?: readonly string[];
  compatibilityProfile: CompatibilityProfile;
  fidelity: Readonly<Record<string, FidelityClass>>;
  bindings?: readonly CommandBinding[];
}): OperationGateResult {
  const operations = input.operations?.length
    ? input.operations
    : impliedWriteOperations(input.type);
  for (const operation of operations) {
    const gate = gateOperation({
      type: input.type,
      operation,
      bindings: input.bindings,
      compatibilityProfile: input.compatibilityProfile,
      fidelity: input.fidelity,
    });
    if (!gate.allowed) return gate;
  }
  return { allowed: true };
}
