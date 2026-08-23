import { commandForBinding, preservedRegionRefusal, regionBlockedBy } from "../registry";
import type { CommandBinding, CompatibilityProfile, FidelityClass, FidelityRegionKey } from "../types";
import type { WorkType } from "../../work/registry";
import { manifestOperationId } from "./capability-audit";

/**
 * The fidelity gate, addressed by AI operation instead of by command.
 *
 * `commandForBinding` already refuses a command that would write a region the
 * linked file only preserves. That refusal has to be the *same* refusal when the
 * assistant asks, or C2 collapses in the worst direction: the button is greyed
 * out with an honest explanation, and then the assistant cheerfully does it
 * anyway and the person's footnotes are gone. Same question, same answer, one
 * sentence — built from the command set the person is looking at, so the two
 * cannot drift.
 *
 * The command bindings are pure functions of their handlers, which is why every
 * office module exports stub handlers: this gate can be built with no live
 * editor, on a server, from the same declarations the workbar renders.
 */

/** Which regions each manifest operation writes, taken from the command set. */
export function operationRegionIndex(
  type: WorkType,
  bindings: readonly CommandBinding[],
): Map<string, readonly FidelityRegionKey[]> {
  const index = new Map<string, FidelityRegionKey[]>();
  for (const [order, binding] of bindings.entries()) {
    const command = commandForBinding(type, binding, order);
    for (const op of command.manifestOps ?? []) {
      const id = manifestOperationId(type, op);
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
  /** `document.format.blocks` or the bare `format_blocks`; both resolve. */
  operation: string;
  bindings: readonly CommandBinding[];
  compatibilityProfile: CompatibilityProfile;
  fidelity: Readonly<Record<string, FidelityClass>>;
};

export type OperationGateResult =
  | { allowed: true }
  | { allowed: false; reason: string; region?: FidelityRegionKey };

/**
 * Whether the assistant may perform this operation on this artifact. The reason
 * is the same string the person reads on the disabled control, so an explanation
 * in chat and an explanation in the workbar never contradict each other.
 */
export function gateOperation(input: OperationGateInput): OperationGateResult {
  if (input.compatibilityProfile !== "strict-native") return { allowed: true };
  const operation = manifestOperationId(input.type, input.operation);
  const regions = operationRegionIndex(input.type, input.bindings).get(operation);
  if (!regions?.length) return { allowed: true };
  const blocked = regionBlockedBy(input.fidelity, regions);
  if (!blocked) return { allowed: true };
  return {
    allowed: false,
    reason: preservedRegionRefusal(blocked.region),
    region: blocked.region,
  };
}

/**
 * Every operation the assistant must decline on this artifact, so a refusal can
 * be stated up front rather than discovered halfway through a plan. An assistant
 * that knows the whole list can say "I can rewrite the body, but the tracked
 * changes in this file stay as they are" instead of failing at step four.
 */
export function refusedOperations(
  type: WorkType,
  bindings: readonly CommandBinding[],
  compatibilityProfile: CompatibilityProfile,
  fidelity: Readonly<Record<string, FidelityClass>>,
): Array<{ operation: string; region: FidelityRegionKey; reason: string }> {
  if (compatibilityProfile !== "strict-native") return [];
  const refused: Array<{ operation: string; region: FidelityRegionKey; reason: string }> = [];
  for (const [operation, regions] of operationRegionIndex(type, bindings)) {
    const blocked = regionBlockedBy(fidelity, regions);
    if (blocked) {
      refused.push({
        operation,
        region: blocked.region,
        reason: preservedRegionRefusal(blocked.region),
      });
    }
  }
  return refused.sort((left, right) => left.operation.localeCompare(right.operation));
}
