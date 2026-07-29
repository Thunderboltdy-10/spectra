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

  async edit(regionId: string, overlapDomains: string[], change: () => void) {
    const result = await this.editMany([{ regionId, overlapDomains }], change);
    return result.applied
      ? { applied: true as const, claim: result.claims[0]! }
      : { applied: false as const, claim: result.claim };
  }

  async editMany(regions: Array<{ regionId: string; overlapDomains: string[] }>, change: () => void) {
    if (regions.length === 0 || regions.length > 128) throw new Error("REGION_EDIT_SET_INVALID");
    const unique = [...new Map(regions.map((entry) => [entry.regionId, entry])).values()];
    const claims: RegionClaimResult[] = [];
    for (const region of unique) {
      const claim = await this.acquire(region.regionId, region.overlapDomains);
      claims.push(claim);
      if (claim.status === "queued") {
        for (const held of [...claims.slice(0, -1)].reverse()) await postSpectra({ action: "releaseRegionClaim", claimId: held.claimId, clientId: this.transport.clientId, resolution: "cancel" }).catch(() => undefined);
        return { applied: false as const, claim, claims };
      }
    }
    let renewing = true;
    const renew = window.setInterval(() => {
      if (!renewing) return;
      for (const claim of claims) void postSpectra({ action: "renewRegionClaim", claimId: claim.claimId, clientId: this.transport.clientId }).catch(() => undefined);
    }, 9_000);
    try {
      this.transport.transact(unique.map((entry) => entry.regionId).join(","), change);
      await this.transport.flush();
      for (const claim of claims) await postSpectra({ action: "releaseRegionClaim", claimId: claim.claimId, clientId: this.transport.clientId, resolution: "apply" });
      return { applied: true as const, claims };
    } catch (error) {
      for (const claim of [...claims].reverse()) await postSpectra({ action: "releaseRegionClaim", claimId: claim.claimId, clientId: this.transport.clientId, resolution: "cancel" }).catch(() => undefined);
      throw error;
    } finally {
      renewing = false;
      window.clearInterval(renew);
    }
  }

  async resolve(claimId: string, resolution: "apply" | "keep_current" | "merge" | "cancel") {
    return postSpectra({ action: "resolveRegionConflict", claimId, clientId: this.transport.clientId, resolution, newBaseStateVectorHash: resolution === "apply" || resolution === "merge" ? await stateVectorHash(this.transport) : undefined });
  }
}
