import type { SpectraArtifact } from "../data/api";

/**
 * Ownership is an authoritative publish capability even when a partially
 * hydrated artifact has not populated its capability list yet. A collaborator
 * must still carry the explicit capability returned by authority.
 */
export function canPublishAgentArtifact(
  artifact: Pick<SpectraArtifact, "ownership" | "capabilities">,
) {
  return artifact.ownership === "owned" ||
    artifact.capabilities?.includes("publish") === true;
}
