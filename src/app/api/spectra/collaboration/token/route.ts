import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import {
  collaborationProtocolVersion,
  signCollaborationSession,
} from "@/lib/collaboration-token";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
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
    const artifact = await convexQuery<
      Record<string, unknown>,
      { _id: string; blueprintKey: string }
    >("spectraArtifacts:get", { artifactId });
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
    const documentName = `artifact:${artifactId}:${Buffer.from(partitionKey).toString("base64url")}`;
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
    return ok({
      token,
      documentName,
      provider: cloudflareRealtime ? "cloudflare_durable_object" : "self_hosted_yjs",
      url: cloudflareRealtime
        ? process.env.SPECTRA_CLOUDFLARE_COLLAB_URL ??
          process.env.NEXT_PUBLIC_SPECTRA_COLLAB_URL ??
          "ws://localhost:8787"
        : process.env.NEXT_PUBLIC_SPECTRA_COLLAB_URL ?? "ws://localhost:1234",
      expiresInMs: 600_000,
      level: access.level,
      accountId: actor.accountId,
      displayName: actor.name,
    });
  }, request);
}
