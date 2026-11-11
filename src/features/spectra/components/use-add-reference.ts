"use client";

import { useMutation } from "convex/react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import type { SpectraArtifact } from "../data/api";
import type { ArtifactTypeKey } from "../artifacts/types";
import type { CompatibilityProfile } from "../commands/types";
import type { ReferenceNode } from "../references";
import type { ArtifactEmbedInteraction } from "../../../../shared/artifact-embed";
import { isArtifactTypeKey } from "../artifacts/registry";
import { getWorkReferenceContract } from "../references";
import { getWorkDefinition } from "../work/registry";
import { embedCapabilitiesFor } from "../capabilities";
import { spectraBus } from "../events";

export type AddReferenceOptions = {
  containerRegionId?: string;
  mode?: "compact" | "expanded";
  /** Defaults to using the work where it sits whenever its type allows it. */
  interaction?: ArtifactEmbedInteraction;
  versionPolicy?: "live" | "pinned";
  pinnedVersionId?: string;
  view?: string;
  /** Lay it on this embed's card as another tab. */
  stackOnto?: string;
};

/** Whether an embedded work of this type can be used where it sits (answered, turned, run). */
export function referenceSupportsInteraction(type: string) {
  return isArtifactTypeKey(type) && embedCapabilitiesFor(type, "interact").length > 0;
}

/**
 * Adds a work to a page as a live reference: the embed record first, then the
 * node in the host's editor, removing the record again if the editor refuses
 * it. The inline picker and the References panel both add through here.
 */
export function useAddReference({
  containerType = "artifact",
  containerId,
  containerWorkType,
  compatibilityProfile = "spectra-native",
}: {
  containerType?: "artifact" | "thread";
  containerId: string;
  containerWorkType?: ArtifactTypeKey;
  compatibilityProfile?: CompatibilityProfile;
}) {
  const createReference = useMutation(api.artifactEmbeds.create);
  const removeReference = useMutation(api.artifactEmbeds.remove);

  return async function addReference(source: SpectraArtifact, options: AddReferenceOptions = {}) {
    if (compatibilityProfile === "strict-native")
      throw new Error("This file keeps strict native compatibility. Change it to Enhanced before adding a live reference.");
    if (!isArtifactTypeKey(source.blueprintKey)) throw new Error("This kind of artifact cannot be shown here.");
    const contract = getWorkReferenceContract(source.blueprintKey);
    const view = options.view ?? contract.targets[0]?.views[0];
    const mode = options.mode ?? "compact";
    const interaction = options.interaction ?? (referenceSupportsInteraction(source.blueprintKey) ? "interact" : "read");
    const versionPolicy = options.versionPolicy ?? "live";
    const containerRegionId = options.containerRegionId ?? "artifact:structure";
    const displayPreferences = view ? { view } : undefined;
    const placementOperationId = containerType === "artifact" ? crypto.randomUUID() : undefined;
    const result = await createReference({
      containerType,
      containerId,
      containerRegionId,
      sourceArtifactId: source._id as Id<"spectraArtifacts">,
      mode,
      interaction,
      versionPolicy,
      pinnedVersionId:
        versionPolicy === "pinned" ? (options.pinnedVersionId as Id<"spectraArtifactVersions">) : undefined,
      contextPolicy: "summary",
      displayPreferences,
      placementOperationId,
    });
    if (containerType !== "artifact" || (containerWorkType !== "document" && containerWorkType !== "whiteboard"))
      return result.embedId;
    try {
      const reference: ReferenceNode = {
        embedId: result.embedId,
        placementOperationId,
        containerType,
        containerId,
        containerRegionId,
        sourceArtifactId: source._id,
        mode,
        interaction,
        versionPolicy,
        ...(versionPolicy === "pinned" ? { pinnedVersionId: options.pinnedVersionId } : {}),
        contextPolicy: "summary",
        displayPreferences,
        state: "ready",
      };
      const listeners = await spectraBus.commandAsync("reference.insert", {
        hostWorkId: containerId,
        reference,
        stackOnto: options.stackOnto,
        target: {
          workId: source._id,
          workType: source.blueprintKey,
          kind: contract.targets[0]?.kind ?? "work:root",
          path: ["work", "root"],
          stableIds: { workId: source._id },
          fallbackExcerpt: source.title,
          schemaVersion: getWorkDefinition(source.blueprintKey).model.schemaVersion,
        },
      });
      if (listeners === 0) throw new Error("The page is not ready for a reference yet.");
      return result.embedId;
    } catch (error) {
      await removeReference({ embedId: result.embedId as Id<"artifactEmbeds"> }).catch(() => undefined);
      throw error;
    }
  };
}
