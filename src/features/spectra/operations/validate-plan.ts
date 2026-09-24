import type { SpectraPlan } from "./schema";
import { mapOperationArtifactReferences, validateOperationDependencies } from "./dependencies";

export type OwnedOperationReferences = {
  artifactIds: ReadonlySet<string>;
  artifactBlueprints?: ReadonlyMap<string, string>;
  workspaceIds: ReadonlySet<string>;
  placementNodes: ReadonlyMap<string, { artifactId?: string; workspaceId: string }>;
  threadIds?: ReadonlySet<string>;
};

function requireOwnedReference(kind: string, id: string, allowed: ReadonlySet<string>) {
  if (!allowed.has(id)) throw new Error(`Invalid ${kind} reference. The operation must use an owned id from the current context.`);
}

export function validatePlanAgainstIntent(plan: SpectraPlan, references: OwnedOperationReferences) {
  validateOperationDependencies(plan.operations);
  const { intent } = plan;
  if (intent.obligations) {
    const ids = new Set<string>();
    const covered = new Set<number>();
    for (const obligation of intent.obligations) {
      if (ids.has(obligation.id)) throw new Error("Request obligation ids must be unique.");
      ids.add(obligation.id);
      for (const index of obligation.operationIndexes) {
        if (!plan.operations[index]) throw new Error(`The request still lacks an operation for ${obligation.description}`);
        covered.add(index);
      }
    }
    if (plan.operations.some((_, index) => !covered.has(index)))
      throw new Error("Every operation must fulfill an explicit request obligation.");
  }
  const creates = plan.operations.filter((operation) => operation.type === "artifact.create");

  if (creates.length > 0 && intent.mode !== "create" && intent.mode !== "mixed") {
    throw new Error("The proposed artifact creation is unrelated to the interpreted request.");
  }
  // A typed create intent is still a strong, bounded signal when the model
  // inconsistently reports a zero visible count. Permit exactly one matching
  // artifact instead of failing after the pending shell has materialized.
  const requestedVisibleArtifactCount = intent.requestedVisibleArtifactCount === 0
    && (intent.mode === "create" || intent.mode === "mixed")
    && intent.requestedArtifactTypes.length > 0
    ? 1
    : intent.requestedVisibleArtifactCount;
  const createdTypes = new Set<string>(creates.map((operation) => operation.input.blueprintKey));
  if (creates.length > requestedVisibleArtifactCount) {
    throw new Error("The plan creates more visible artifacts than the interpreted request.");
  }
  if ((intent.mode === "create" || intent.mode === "mixed") && creates.length < requestedVisibleArtifactCount)
    throw new Error("The plan does not create every artifact in the interpreted request. Complete the remaining outcomes before submitting.");
  if (creates.length > 0) {
    for (const requestedType of intent.requestedArtifactTypes) {
      if (!createdTypes.has(requestedType))
        throw new Error(`The plan does not create the requested ${requestedType} artifact. Complete the remaining outcomes before submitting.`);
    }
  }
  for (const operation of creates) {
    if (!intent.requestedArtifactTypes.includes(operation.input.blueprintKey)) {
      throw new Error(`The proposed ${operation.input.blueprintKey} artifact is unrelated to the interpreted request.`);
    }
    if (operation.input.workspaceId) requireOwnedReference("workspace", operation.input.workspaceId, references.workspaceIds);
    if (intent.targetWorkspaceId && (operation.input.workspaceId !== intent.targetWorkspaceId || operation.input.placement !== "context")) {
      throw new Error("The artifact destination does not match the interpreted request.");
    }
    if (operation.input.blueprintKey === "planner_task") {
      for (const threadId of operation.input.content.linkedThreadIds ?? []) requireOwnedReference("thread", threadId, references.threadIds ?? new Set());
    }
  }

  const requireOwnedOrCreatedArtifact = (id: string, operationIndex: number) => {
    if (references.artifactIds.has(id)) return;
    const match = /^@created:(\d+)$/.exec(id);
    if (!match) return requireOwnedReference("artifact", id, references.artifactIds);
    const sourceIndex = match ? Number(match[1]) : -1;
    if (sourceIndex < 0 || sourceIndex >= operationIndex || plan.operations[sourceIndex]?.type !== "artifact.create") {
      throw new Error("Invalid artifact reference. New artifacts may only be referenced by a prior @created:<operation index> dependency.");
    }
  };

  for (const [operationIndex, operation] of plan.operations.entries()) {
    // Application arguments and placement/link consumers use the same graph
    // identities as normalization and execution, including reference hosts.
    mapOperationArtifactReferences(operation, (id) => {
      requireOwnedOrCreatedArtifact(id, operationIndex);
      return id;
    });
    if (operation.type === "artifact.update") {
      if (intent.mode !== "update" && intent.mode !== "mixed") throw new Error("The proposed artifact update is unrelated to the interpreted request.");
      requireOwnedOrCreatedArtifact(operation.input.artifactId, operationIndex);
      const producerMatch = /^@created:(\d+)$/.exec(operation.input.artifactId);
      const producer = producerMatch ? plan.operations[Number(producerMatch[1])] : undefined;
      const ownedBlueprint = producer?.type === "artifact.create"
        ? producer.input.blueprintKey
        : references.artifactBlueprints?.get(operation.input.artifactId);
      if (ownedBlueprint && ownedBlueprint !== operation.input.blueprintKey) throw new Error("The artifact update blueprint does not match the owned artifact.");
      if (intent.targetArtifactId && operation.input.artifactId !== intent.targetArtifactId) throw new Error("The artifact update target does not match the interpreted request.");
    }
    if (operation.type === "workspaceItem.add") {
      if (intent.mode !== "place" && intent.mode !== "mixed") throw new Error("The proposed workspace placement is unrelated to the interpreted request.");
      requireOwnedOrCreatedArtifact(operation.input.artifactId, operationIndex);
      requireOwnedReference("workspace", operation.input.workspaceId, references.workspaceIds);
      if (intent.targetArtifactId && operation.input.artifactId !== intent.targetArtifactId) throw new Error("The placement artifact does not match the interpreted request.");
      if (intent.targetWorkspaceId && operation.input.workspaceId !== intent.targetWorkspaceId) throw new Error("The placement workspace does not match the interpreted request.");
    }
    if (operation.type === "workspaceItem.hide") {
      if (intent.mode !== "remove_placement" && intent.mode !== "mixed") throw new Error("The proposed placement removal is unrelated to the interpreted request.");
      const item = references.placementNodes.get(operation.input.nodeId);
      if (!item) throw new Error("Invalid workspace item reference. Synthetic operation keys cannot be used as database ids.");
      if (intent.targetArtifactId && item.artifactId !== intent.targetArtifactId) throw new Error("The placement removal target does not match the interpreted request.");
      if (intent.targetWorkspaceId && item.workspaceId !== intent.targetWorkspaceId) throw new Error("The placement removal workspace does not match the interpreted request.");
    }
    if (operation.type === "artifact.archive") {
      if (intent.mode !== "archive" && intent.mode !== "mixed") throw new Error("The proposed artifact archive is unrelated to the interpreted request.");
      requireOwnedOrCreatedArtifact(operation.input.artifactId, operationIndex);
      if (intent.targetArtifactId && operation.input.artifactId !== intent.targetArtifactId) throw new Error("The archive target does not match the interpreted request.");
    }
    if (operation.type === "workspaceItem.setPinned") {
      if (intent.mode !== "place" && intent.mode !== "update" && intent.mode !== "mixed") throw new Error("The proposed pin change is unrelated to the interpreted request.");
      if (!references.placementNodes.has(operation.input.nodeId)) throw new Error("Invalid workspace item reference. Pinning requires an owned workspace item id.");
    }
    if (operation.type === "workspace.create" && intent.mode !== "create_workspace" && intent.mode !== "mixed") {
      throw new Error("The proposed workspace creation is unrelated to the interpreted request.");
    }
    if (operation.type === "workspace.update") {
      if (intent.mode !== "update_workspace" && intent.mode !== "mixed") throw new Error("The proposed workspace update is unrelated to the interpreted request.");
      requireOwnedReference("workspace", operation.input.workspaceId, references.workspaceIds);
      if (intent.targetWorkspaceId && operation.input.workspaceId !== intent.targetWorkspaceId) throw new Error("The workspace update target does not match the interpreted request.");
    }
    if (operation.type === "artifact.link") {
      if (intent.mode !== "link" && intent.mode !== "mixed") throw new Error("The proposed artifact link is unrelated to the interpreted request.");
      requireOwnedOrCreatedArtifact(operation.input.sourceArtifactId, operationIndex);
      requireOwnedOrCreatedArtifact(operation.input.targetArtifactId, operationIndex);
      if (operation.input.workspaceId) requireOwnedReference("workspace", operation.input.workspaceId, references.workspaceIds);
      if (operation.input.sourceArtifactId === operation.input.targetArtifactId) throw new Error("An artifact cannot link to itself.");
    }
  }

  return plan;
}
