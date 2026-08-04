import type { ArtifactCollaborationTransport } from "../../collaboration/types";
import { HocuspocusArtifactTransport } from "../../collaboration/hocuspocus-transport";
import { CloudflareRealtimeProvider } from "./cloudflare-realtime-provider";

export type RealtimeProviderKind = "hocuspocus" | "cloudflare";

export function configuredRealtimeProviderKind(): RealtimeProviderKind {
  return process.env.NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME === "true"
    ? "cloudflare"
    : "hocuspocus";
}

/**
 * Phase 3 activation boundary. Document and code sessions are ready for the
 * native Cloudflare room path; an explicit false value remains the emergency
 * compatibility rollback until the Phase 12 removal gate.
 */
export function realtimeProviderForWorkType(typeKey: string): RealtimeProviderKind {
  if (
    (typeKey === "document" || typeKey === "code") &&
    process.env.NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME !== "false"
  )
    return "cloudflare";
  return configuredRealtimeProviderKind();
}

export function createArtifactCollaborationTransport(
  artifactId: string,
  partitionKey: string,
  schemaVersion: number,
  kind = configuredRealtimeProviderKind(),
): ArtifactCollaborationTransport {
  if (kind === "cloudflare")
    return new CloudflareRealtimeProvider({
      workId: artifactId,
      partitionKey,
      schemaVersion,
    });
  return new HocuspocusArtifactTransport(
    artifactId,
    partitionKey,
    schemaVersion,
  );
}
