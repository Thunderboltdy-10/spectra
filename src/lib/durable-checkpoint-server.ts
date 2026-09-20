import { makeFunctionReference } from "convex/server";
import type { ConvexHttpClient } from "convex/browser";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import { createCollaborationGatewayBridgeClient } from "../../scripts/collaboration-gateway-bridge-client.mjs";
import { applyStoredRoomUpdates } from "../../scripts/collaboration-room-state.mjs";
import { nativeArtifactProjection } from "../../scripts/collaboration-native-projection.mjs";
import { getConvexUrl } from "./env";

/** A saved version waits for the same canonical log used by reconnect. Only
 * explicit saves require a projection barrier; ordinary edits append deltas. */
export async function checkpointDurableContent(artifactId: string, client: ConvexHttpClient) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const head = await client.query(makeFunctionReference<"query">("artifactContent:checkpointHead"), { artifactId });
    if (!head) return;
    const bridge = createCollaborationGatewayBridgeClient({ convexUrl: getConvexUrl(), bridgeKey: process.env.SPECTRA_COLLAB_BRIDGE_KEY! });
    const stored = await bridge("load", head);
    if (!stored) throw new Error("COLLABORATION_CHECKPOINT_UNAVAILABLE");
    const document = applyStoredRoomUpdates(Y, stored);
    try {
      const projection = nativeArtifactProjection(document, head.schemaVersion);
      if (!projection) return; // Legacy model remains on its existing checkpoint path.
      const projectionJson = JSON.stringify(projection);
      const result = await bridge("checkpoint", {
        ...head, clientId: "saved-version-barrier", throughSequence: stored.nextSequence - 1,
        stateVectorHash: createHash("sha256").update(Y.encodeStateVector(document)).digest("base64url"),
        projectionJson, projectionHash: createHash("sha256").update(projectionJson).digest("base64url"),
      });
      if (!result?.stale) return;
    } finally { document.destroy(); }
  }
  throw new Error("COLLABORATION_CHECKPOINT_BUSY: New edits arrived while saving. Please save again.");
}
