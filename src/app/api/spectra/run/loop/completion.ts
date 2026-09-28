import { parseSpectraPlan, type ModelOperation, type RequestIntent } from "@/features/spectra/operations/schema";

const WORK_CLAIM =
  /\b(?:i|we)(?:'ve| have)?\s+(?:just\s+|now\s+|also\s+|already\s+)?(?:saved|created|added|updated|edited|changed|made|built|written|wrote|inserted|deleted|removed|renamed|moved|scheduled|applied|placed|organi[sz]ed|set up|turned)\b/i;
const PASSIVE_WORK_CLAIM =
  /\b(?:(?:has|have) (?:now |just )?been|(?:is|are) now) (?:saved|created|added|updated|applied|scheduled|renamed|moved|deleted)\b/i;
const SAVED_WORK_TARGET =
  /\b(?:saved|documents?|docs?|decks?|flashcards?|notes?|quiz(?:zes)?|sheets?|spreadsheets?|workspaces?|calendar|planner|tasks?|whiteboards?|presentations?|slides?|artifacts?|files?|library|folders?|events?|reminders?)\b/i;

/**
 * True when an answer says work was saved to the user's things. Checked only
 * for a reply that staged and committed nothing, where any such sentence is
 * false: "I've updated your notes" with no operation. Prose that merely
 * contains the work ("I've written a summary below") does not match.
 */
export function claimsUnsavedWork(text: string) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .some((sentence) =>
      (WORK_CLAIM.test(sentence) || PASSIVE_WORK_CLAIM.test(sentence)) &&
      SAVED_WORK_TARGET.test(sentence));
}

/**
 * Adapt a model's ordinary final response to the durable executor's envelope.
 * Only already validated tool operations enter this graph. This metadata is
 * bookkeeping, not evidence that the user's request is complete or authorized;
 * target, dependency, approval and receipt checks still belong to the executor.
 */
export function planFromAgentCompletion(text: string, operations: readonly ModelOperation[]) {
  // Legacy plan coercion supplies a canned summary for blank metadata. A
  // missing model response must instead get a bounded recovery attempt.
  if (!text.trim()) throw new Error("The Spectra model returned an empty final response.");
  const creates = operations.filter((operation) => operation.type === "artifact.create");
  const modes: Partial<Record<ModelOperation["type"], RequestIntent["mode"]>> = {
    "artifact.create": "create",
    "artifact.update": "update",
    "artifact.link": "link",
    "workspace.create": "create_workspace",
    "workspace.update": "update_workspace",
    "workspaceItem.add": "place",
    "workspaceItem.hide": "remove_placement",
    "workspaceItem.setPinned": "place",
    "app.command": "mixed",
  };
  const operationModes = new Set(operations.map((operation) => modes[operation.type] ?? "mixed"));
  return parseSpectraPlan({
    decision: operations.length ? "operate" : "answer",
    intent: {
      mode: operationModes.size === 1 ? [...operationModes][0] : operations.length ? "mixed" : "answer",
      requestedArtifactTypes: [...new Set(creates.map((operation) => operation.input.blueprintKey))],
      requestedVisibleArtifactCount: creates.length,
      targetArtifactId: null,
      targetWorkspaceId: null,
    },
    operations: [...operations],
    finalResponse: text,
  });
}
