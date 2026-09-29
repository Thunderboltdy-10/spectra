"use client";

import type { ArtifactCollaborationTransport } from "./types";

/**
 * Applies a human edit to the live room, labelled with the semantic regions it
 * touches (the transport records them as the edit's authored regions).
 */
export class ArtifactRegionController {
  constructor(private readonly transport: ArtifactCollaborationTransport) {}

  async edit(regionId: string, overlapDomains: string[], change: () => void) {
    return this.editMany([{ regionId, overlapDomains }], change);
  }

  async editMany(
    regions: Array<{ regionId: string; overlapDomains: string[] }>,
    change: () => void,
  ) {
    if (regions.length === 0 || regions.length > 128) throw new Error("REGION_EDIT_SET_INVALID");
    const unique = [...new Set(regions.map((entry) => entry.regionId))];
    // Human authoring is optimistic and broadcast-first. Waiting for one HTTP
    // claim round trip per semantic region before touching Yjs made normal
    // typing take seconds (or minutes on a busy account), even though the
    // gateway already reauthorizes every frame and rejects overlap with an
    // active AI claim. AI operations still acquire durable region leases on
    // their server path; the append mutation requires those leases.
    this.transport.transact(unique.join(","), change);
    // A Yjs provider acknowledgement is only transport acceptance. Hold this
    // semantic edit until the gateway's spectra.durable_ack confirms the
    // corresponding Convex append; native materialization and local-cache
    // eviction must never run in the acknowledgement gap.
    await this.transport.flush();
    return { applied: true as const };
  }
}
