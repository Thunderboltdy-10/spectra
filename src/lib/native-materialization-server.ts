import "server-only";
import type { Id } from "../../convex/_generated/dataModel";
import type { QueueMaterializationArgs, CloudMaterializationArgs } from "../../convex/replicaMaterialization";
import type { NativeMaterializationCandidate, QueuedNativeMaterialization } from "../features/spectra/lenses/native-materialization-options";
import { convexQuery, storeArtifactContent } from "./convex-server";
import { createCollaborationGatewayBridgeClient } from "../../scripts/collaboration-gateway-bridge-client.mjs";
import { getConvexUrl } from "./env";

/** Keep the signed envelope bounded using the existing immutable content
 * lifecycle. No replica or canonical write occurs while retaining these bodies. */
export async function retainNativeCandidate(candidate: NativeMaterializationCandidate): Promise<NativeMaterializationCandidate> {
  if (candidate.destination === "none") return candidate;
  const args = candidate.destination === "bridge" ? candidate.queue : candidate.cloud;
  const projectionContent = args.projectionContent === undefined ? undefined
    : await storeArtifactContent(args.workId, args.projectionContent);
  if (candidate.destination === "cloud") return { destination: "cloud", cloud: { ...candidate.cloud, projectionContent } };
  const baseContent = candidate.queue.baseContent === undefined ? undefined
    : await storeArtifactContent(args.workId, candidate.queue.baseContent);
  return { destination: "bridge", queue: { ...candidate.queue, projectionContent,
    ...(baseContent === undefined ? {} : { baseContent }) } };
}

async function commitHuman(candidate: Exclude<NativeMaterializationCandidate, { destination: "none" }>) {
  candidate = structuredClone(candidate);
  const workId = candidate.destination === "bridge" ? candidate.queue.workId : candidate.cloud.workId;
  // Derived from the authenticated Clerk/worker session, never a route body.
  const { accountId } = await convexQuery<{ workId: Id<"spectraArtifacts"> }, { accountId: Id<"accounts"> }>(
    "nativeMaterialization:head", { workId });
  const retained = await retainNativeCandidate(candidate);
  const bridge = createCollaborationGatewayBridgeClient({ convexUrl: getConvexUrl(),
    bridgeKey: process.env.SPECTRA_COLLAB_BRIDGE_KEY! });
  return bridge("materializeNative", { artifactId: workId, accountId, partitionKey: "root", candidate: retained });
}

export async function queueHumanNativeMaterialization(args: QueueMaterializationArgs): Promise<QueuedNativeMaterialization> {
  return commitHuman({ destination: "bridge", queue: args });
}

export async function commitHumanCloudMaterialization(args: CloudMaterializationArgs): Promise<{ state: string }> {
  return commitHuman({ destination: "cloud", cloud: args });
}
