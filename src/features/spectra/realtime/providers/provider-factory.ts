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
  void typeKey;
  // The local/self-hosted gateway is the launch-safe default for every work
  // type. Cloudflare is selected only by an explicit deployment opt-in; an
  // absent public flag must never silently route documents to a missing worker.
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
