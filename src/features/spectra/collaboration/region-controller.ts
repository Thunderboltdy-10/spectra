"use client";

import * as Y from "yjs";
import { postSpectra } from "../data/api";
import type { ArtifactCollaborationTransport } from "./types";

export type RegionClaimResult = {
  claimId: string;
  status: "active" | "queued";
  leaseExpiresAt: number;
  conflict: null | { claimId: string; actorKind: "human" | "ai"; regionId: string; leaseExpiresAt: number; queuePosition: number };
};

async function stateVectorHash(transport: ArtifactCollaborationTransport) {
  const stateVector = Y.encodeStateVector(transport.document);
  const bytes = new Uint8Array(stateVector.byteLength);
  bytes.set(stateVector);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  const binary = String.fromCharCode(...new Uint8Array(digest));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export class ArtifactRegionController {
  constructor(private readonly artifactId: string, private readonly transport: ArtifactCollaborationTransport, private readonly partitionKey = "root") {}

  async acquire(regionId: string, overlapDomains: string[]) {
    return postSpectra<RegionClaimResult>({
      action: "acquireRegionClaim",
      artifactId: this.artifactId,
      partitionKey: this.partitionKey,
      clientId: this.transport.clientId,
      regionId,
      overlapDomains,
      baseStateVectorHash: await stateVectorHash(this.transport),
    });
  }

  async edit(
    regionId: string,
    overlapDomains: string[],
    change: () => void,
  ): Promise<
    | { applied: true; claim?: undefined }
    | { applied: false; claim: RegionClaimResult }
  > {
    await this.editMany([{ regionId, overlapDomains }], change);
    return { applied: true as const };
  }

  async editMany(
    regions: Array<{ regionId: string; overlapDomains: string[] }>,
    change: () => void,
  ): Promise<
    | { applied: true; claims: RegionClaimResult[] }
    | {
        applied: false;
        claim: RegionClaimResult;
        claims: RegionClaimResult[];
      }
  > {
    if (regions.length === 0 || regions.length > 128) throw new Error("REGION_EDIT_SET_INVALID");
    const unique = [...new Map(regions.map((entry) => [entry.regionId, entry])).values()];
    // Human authoring is optimistic and broadcast-first. Waiting for one HTTP
    // claim round trip per semantic region before touching Yjs made normal
    // typing take seconds (or minutes on a busy account), even though the
    // gateway already reauthorizes every frame and rejects overlap with an
    // active AI claim. AI operations still acquire durable region leases on
    // their server path; the append mutation requires those leases.
    this.transport.transact(
      unique.map((entry) => entry.regionId).join(","),
      change,
    );
    return { applied: true as const, claims: [] as RegionClaimResult[] };
  }

  async resolve(claimId: string, resolution: "apply" | "keep_current" | "merge" | "cancel") {
    return postSpectra({ action: "resolveRegionConflict", claimId, clientId: this.transport.clientId, resolution, newBaseStateVectorHash: resolution === "apply" || resolution === "merge" ? await stateVectorHash(this.transport) : undefined });
  }
}
