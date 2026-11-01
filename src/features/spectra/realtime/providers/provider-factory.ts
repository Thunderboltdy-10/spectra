import type { ArtifactCollaborationTransport } from "../../collaboration/types";
import { HocuspocusArtifactTransport } from "../../collaboration/hocuspocus-transport";

export type RealtimeProviderKind = "hocuspocus";

export function configuredRealtimeProviderKind(): RealtimeProviderKind {
  return "hocuspocus";
}

/**
 * Every work type uses the Hocuspocus gateway, hosted on Fly.io in production.
 */
export function realtimeProviderForWorkType(typeKey: string): RealtimeProviderKind {
  void typeKey;
  return configuredRealtimeProviderKind();
}

export function createArtifactCollaborationTransport(
  artifactId: string,
  partitionKey: string,
  schemaVersion: number,
  kind = configuredRealtimeProviderKind(),
): ArtifactCollaborationTransport {
  void kind;
  return new HocuspocusArtifactTransport(
    artifactId,
    partitionKey,
    schemaVersion,
  );
}
