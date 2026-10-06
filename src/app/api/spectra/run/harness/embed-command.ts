import { applyAiArtifactMutation } from "@/features/spectra/ai/yjs-artifact-operation";
import { removeOperationReference } from "@/features/spectra/operations/reference-content";
import { throwIfAborted } from "./abort";
import { act, query } from "./io";

/*
 * Changing a live embed through the embeds panel's own paths. Resizing,
 * following the live work and pinning are the panel's update; recheck is the
 * placement re-proof a retained pin offers; removing takes the embed's node
 * out of the host (as the editors do) and then removes the embed.
 */

type EmbedProjection = { embedId?: string; state?: string; placementRefreshKey?: string };
type Apply = <TArgs extends object, TResult>(name: string, args: TArgs) => Promise<TResult>;

const HOSTS_WITH_NODES = new Set(["document", "whiteboard", "presentation"]);

export async function executeEmbedCommand(input: {
  actorClerkId: string;
  runId: string;
  executionId: string;
  operationId: string;
  artifactId: string;
  embedId: string;
  action: string;
  mode?: string;
  versionId?: string;
  signal?: AbortSignal;
  applyMutation: Apply;
}) {
  throwIfAborted(input.signal);
  const list = await query<{ containerType: "artifact"; containerId: string }, { canConfigure?: boolean; embeds?: EmbedProjection[] }>(
    "artifactEmbeds:listForContainer",
    { containerType: "artifact", containerId: input.artifactId },
  );
  const embed = (list.embeds ?? []).find((entry) => entry.embedId === input.embedId);
  // A removal that already happened replays its receipt below.
  if (!embed && input.action !== "remove")
    throw new Error("EMBED_NOT_IN_WORK: That embed is not in this work. read_embeds lists the work's embeds.");
  if (embed && list.canConfigure !== true)
    throw new Error("EMBED_NOT_CONFIGURABLE: The user can only view this work, so its embeds cannot be changed.");
  if (input.action === "resize")
    return input.applyMutation("artifactEmbeds:update", { embedId: input.embedId, mode: input.mode });
  if (input.action === "follow_live")
    return input.applyMutation("artifactEmbeds:update", { embedId: input.embedId, versionPolicy: "live" });
  if (input.action === "pin")
    return input.applyMutation("artifactEmbeds:update", { embedId: input.embedId, versionPolicy: "pinned", pinnedVersionId: input.versionId });
  if (input.action === "recheck") {
    if (!embed?.placementRefreshKey)
      return { status: "not_needed", message: "This embed needs no recheck: it is not a pinned embed waiting on a deleted source." };
    return act<{ embedId: string }, { status: string }>("artifactEmbedPlacementActions:refresh", { embedId: input.embedId });
  }
  if (input.action === "remove") {
    const host = await query<{ actorClerkId: string; artifactId: string }, { blueprintKey: string }>("spectraArtifacts:get", {
      actorClerkId: input.actorClerkId,
      artifactId: input.artifactId,
    });
    let removedNodes = 0;
    if (HOSTS_WITH_NODES.has(host.blueprintKey)) {
      throwIfAborted(input.signal);
      // The node goes first, as in the editors: an embed row without its node
      // is invisible, a node without its row would show a broken embed.
      await applyAiArtifactMutation({
        artifactId: input.artifactId,
        runId: input.runId,
        executionId: input.executionId,
        operationId: input.operationId,
        signal: input.signal,
        receipt: "placement",
        beforeCommit: async () => {
          throwIfAborted(input.signal);
        },
        resolveDesired: (current) => {
          const next = removeOperationReference(host.blueprintKey, current.content, input.embedId);
          removedNodes = next.removed;
          return { ...current, content: next.content };
        },
      });
    }
    const result = await input.applyMutation<{ embedId: string }, { removed?: boolean }>("artifactEmbeds:remove", { embedId: input.embedId });
    return { ...result, removedNodes };
  }
  throw new Error("EMBED_ACTION_INVALID");
}
