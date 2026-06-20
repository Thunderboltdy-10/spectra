import type { SpectraPlan } from "./schema";

export type OwnedOperationReferences = {
  artifactIds: ReadonlySet<string>;
  artifactBlueprints?: ReadonlyMap<string, string>;
  workspaceIds: ReadonlySet<string>;
  workspaceItems: ReadonlyMap<string, { artifactId?: string; workspaceId: string }>;
  threadIds?: ReadonlySet<string>;
};

function requireOwnedReference(kind: string, id: string, allowed: ReadonlySet<string>) {
  if (!allowed.has(id)) throw new Error(`Invalid ${kind} reference. The operation must use an owned id from the current context.`);
}

export function validatePlanAgainstIntent(plan: SpectraPlan, references: OwnedOperationReferences) {
  const { intent } = plan;
  const creates = plan.operations.filter((operation) => operation.type === "artifact.create");

  if (creates.length > 0 && intent.mode !== "create" && intent.mode !== "mixed") {
    throw new Error("The proposed artifact creation is unrelated to the interpreted request.");
  }
  if (creates.length > intent.requestedVisibleArtifactCount) {
    throw new Error("The plan creates more visible artifacts than the interpreted request.");
  }
  for (const operation of creates) {
    if (!intent.requestedArtifactTypes.includes(operation.input.blueprintKey)) {
      throw new Error(`The proposed ${operation.input.blueprintKey} artifact is unrelated to the interpreted request.`);
    }
    if (operation.input.workspaceId) requireOwnedReference("workspace", operation.input.workspaceId, references.workspaceIds);
    if (intent.targetWorkspaceId && operation.input.workspaceId && operation.input.workspaceId !== intent.targetWorkspaceId) {
      throw new Error("The artifact destination does not match the interpreted request.");
    }
    if (operation.input.blueprintKey === "thread_reference" && operation.input.content.threadId) {
      requireOwnedReference("thread", operation.input.content.threadId, references.threadIds ?? new Set());
    }
    if (operation.input.blueprintKey === "planner_task") {
      for (const artifactId of operation.input.content.linkedArtifactIds ?? []) requireOwnedReference("artifact", artifactId, references.artifactIds);
      for (const threadId of operation.input.content.linkedThreadIds ?? []) requireOwnedReference("thread", threadId, references.threadIds ?? new Set());
    }
  }

  for (const operation of plan.operations) {
    if (operation.type === "artifact.update") {
      if (intent.mode !== "update" && intent.mode !== "mixed") throw new Error("The proposed artifact update is unrelated to the interpreted request.");
      requireOwnedReference("artifact", operation.input.artifactId, references.artifactIds);
      const ownedBlueprint = references.artifactBlueprints?.get(operation.input.artifactId);
      if (ownedBlueprint && ownedBlueprint !== operation.input.blueprintKey) throw new Error("The artifact update blueprint does not match the owned artifact.");
      if (intent.targetArtifactId && operation.input.artifactId !== intent.targetArtifactId) throw new Error("The artifact update target does not match the interpreted request.");
    }
    if (operation.type === "workspaceItem.add") {
      if (intent.mode !== "place" && intent.mode !== "mixed") throw new Error("The proposed workspace placement is unrelated to the interpreted request.");
      requireOwnedReference("artifact", operation.input.artifactId, references.artifactIds);
      requireOwnedReference("workspace", operation.input.workspaceId, references.workspaceIds);
      if (intent.targetArtifactId && operation.input.artifactId !== intent.targetArtifactId) throw new Error("The placement artifact does not match the interpreted request.");
      if (intent.targetWorkspaceId && operation.input.workspaceId !== intent.targetWorkspaceId) throw new Error("The placement workspace does not match the interpreted request.");
    }
    if (operation.type === "workspaceItem.hide") {
      if (intent.mode !== "remove_placement" && intent.mode !== "mixed") throw new Error("The proposed placement removal is unrelated to the interpreted request.");
      const item = references.workspaceItems.get(operation.input.workspaceItemId);
      if (!item) throw new Error("Invalid workspace item reference. Synthetic operation keys cannot be used as database ids.");
      if (intent.targetArtifactId && item.artifactId !== intent.targetArtifactId) throw new Error("The placement removal target does not match the interpreted request.");
      if (intent.targetWorkspaceId && item.workspaceId !== intent.targetWorkspaceId) throw new Error("The placement removal workspace does not match the interpreted request.");
    }
    if (operation.type === "workspace.create" && intent.mode !== "create_workspace" && intent.mode !== "mixed") {
      throw new Error("The proposed workspace creation is unrelated to the interpreted request.");
    }
  }

  return plan;
}
