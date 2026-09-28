import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import {
  collaborationDocumentName,
  collaborationGatewayUrl,
  collaborationProtocolVersion,
  COLLABORATION_SESSION_TTL_MS,
  signCollaborationSession,
} from "@/lib/collaboration-token";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async (logger) => {
    const actor = await requireActor({ fresh: true });
    const body = (await request.json()) as Record<string, unknown>;
    const artifactId =
      typeof body.artifactId === "string" ? body.artifactId.trim() : "";
    const partitionKey =
      typeof body.partitionKey === "string" && body.partitionKey.trim()
        ? body.partitionKey.trim().slice(0, 180)
        : "root";
    const clientId =
      typeof body.clientId === "string"
        ? body.clientId.trim().slice(0, 180)
        : "";
    const schemaVersion =
      typeof body.schemaVersion === "number" &&
      Number.isSafeInteger(body.schemaVersion)
        ? Math.max(1, body.schemaVersion)
        : 1;
    if (!artifactId || !clientId)
      throw new Error(
        "COLLABORATION_SESSION_INVALID: Artifact and client identity are required.",
      );
    let artifact: { _id: string; blueprintKey: string };
    try {
      artifact = await convexQuery<
        Record<string, unknown>,
        { _id: string; blueprintKey: string }
      >("spectraArtifacts:get", { artifactId });
    } catch (error) {
      logger.warn("Collaboration work lookup failed", {
        artifactId,
        message:
          error instanceof Error ? error.message : "Unknown lookup failure",
      });
      throw error;
    }
    const resourceType =
      artifact.blueprintKey === "agent" ? "agent" : "artifact";
    const [room, access] = await Promise.all([
      convexMutation<
        Record<string, unknown>,
        { roomId: string; policyVersion: number; schemaVersion?: number }
      >("collaboration:ensureRoom", {
        artifactId,
        partitionKey,
        schemaVersion,
      }),
      convexQuery<
        Record<string, unknown>,
        { allowed: boolean; level: "read" | "modify" | null }
      >("authority:access", { resourceType, resourceId: artifactId }),
    ]);
    if (!access.allowed || !access.level)
      throw new Error(
        "COLLABORATION_SESSION_FORBIDDEN: You no longer have access to this artifact.",
      );
    const documentName = collaborationDocumentName(
      artifactId,
      partitionKey,
      artifact.blueprintKey,
    );
    const token = await signCollaborationSession({
      artifactId,
      roomId: room.roomId,
      partitionKey,
      documentName,
      accountId: actor.accountId,
      schoolId: actor.schoolId,
      clientId,
      displayName: actor.name,
      level: access.level,
      policyVersion: room.policyVersion,
      schemaVersion: room.schemaVersion ?? schemaVersion,
      protocolVersion: collaborationProtocolVersion(),
      permissionEpoch: room.policyVersion,
      actorKind: "human",
      access: access.level === "modify" ? "edit" : "read_only",
      internalCapabilities:
        access.level === "modify"
          ? ["view", "edit", "interact", "ai_mutate"]
          : ["view", "interact"],
    });
    const requestedProvider =
      body.realtimeProvider === "cloudflare" ||
      body.realtimeProvider === "hocuspocus"
        ? body.realtimeProvider
        : null;
    const cloudflareRealtime = requestedProvider
      ? requestedProvider === "cloudflare"
      : process.env.NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME === "true";
    const requestHost = request.headers.get("host")?.trim() ?? "";
    const isLocalRequestHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(
      requestHost,
    );
    const safeDevelopmentHost = isLocalRequestHost
      ? requestHost
      : `localhost:${process.env.SPECTRA_WEB_PORT ?? "3000"}`;
    const localGatewayUrl = `${request.nextUrl.protocol === "https:" ? "wss" : "ws"}://${safeDevelopmentHost}/_spectra/realtime`;
    const collaborationUrl = cloudflareRealtime
      ? collaborationGatewayUrl("cloudflare")
      : isLocalRequestHost
        ? localGatewayUrl
        : collaborationGatewayUrl("hocuspocus");
    logger.info("Collaboration session issued", {
      provider: cloudflareRealtime ? "cloudflare" : "hocuspocus",
      url: collaborationUrl,
    });
    return ok({
      token,
      documentName,
      provider: cloudflareRealtime ? "cloudflare_durable_object" : "self_hosted_yjs",
      url: collaborationUrl,
      expiresInMs: COLLABORATION_SESSION_TTL_MS,
      level: access.level,
      accountId: actor.accountId,
      displayName: actor.name,
    });
  }, request);
}
