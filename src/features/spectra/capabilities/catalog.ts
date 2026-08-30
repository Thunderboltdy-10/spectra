import type { WorkType } from "../work/registry";
import { APPLICATION_CAPABILITIES } from "./application";
import { OFFICE_FORMATTING_CAPABILITIES } from "./office-formatting";
import { OFFICE_REMAINING_CAPABILITIES } from "./office-remaining";
import { STUDIO_CAPABILITIES, stableCapabilityId } from "./studios";
import { CODE_STUDIO_CAPABILITIES } from "./studio-code";
import { WHITEBOARD_CAPABILITIES } from "./studio-whiteboard";
import type {
  CapabilityDefinition,
  CapabilityOwner,
  OfficeWorkType,
} from "./types";
import type { ArtifactEmbedInteraction } from "../../../../shared/artifact-embed";

export const ALL_CAPABILITIES: readonly CapabilityDefinition[] = [
  ...OFFICE_FORMATTING_CAPABILITIES,
  ...OFFICE_REMAINING_CAPABILITIES,
  ...APPLICATION_CAPABILITIES,
  ...STUDIO_CAPABILITIES,
  ...CODE_STUDIO_CAPABILITIES,
  ...WHITEBOARD_CAPABILITIES,
];

const BY_ID = new Map<string, CapabilityDefinition>(
  ALL_CAPABILITIES.map((definition) => [definition.id, definition]),
);

export function capabilityById(id: string): CapabilityDefinition | undefined {
  return BY_ID.get(id);
}

export function knownCapabilityIds(): ReadonlySet<string> {
  return new Set(BY_ID.keys());
}

export function capabilitiesFor(
  type: CapabilityOwner,
): readonly CapabilityDefinition[] {
  const prefix = `${type}.`;
  return ALL_CAPABILITIES.filter((definition) =>
    definition.id.startsWith(prefix),
  );
}

export function officeCapabilitiesFor<T extends OfficeWorkType>(
  type: T,
): readonly CapabilityDefinition<T>[] {
  return capabilitiesFor(type) as readonly CapabilityDefinition<T>[];
}

export function capabilityForLocalId(
  type: WorkType,
  localId: string,
): CapabilityDefinition | undefined {
  return capabilityById(stableCapabilityId(type, localId));
}

export function embedCapabilitiesFor(
  type: WorkType,
  interaction: ArtifactEmbedInteraction,
) {
  return capabilitiesFor(type).filter((definition) =>
    definition.embed?.levels.includes(interaction),
  );
}

export function embedCapabilityEnabled(
  type: WorkType,
  interaction: ArtifactEmbedInteraction,
  localId: string,
) {
  const definition = capabilityForLocalId(type, localId);
  return Boolean(definition?.embed?.levels.includes(interaction));
}

export function suggestedEmbedInteraction(type: WorkType) {
  return embedCapabilitiesFor(type, "interact").length
    ? ("interact" as const)
    : ("read" as const);
}
