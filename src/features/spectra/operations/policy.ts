import type {
  ModelOperation,
  OperationInput,
  RequestIntent,
  SpectraOperationType,
} from "./schema";
import {
  authorityPublicMessage,
  authorityRequiresConfirmation,
  evaluateApplicationAuthority,
} from "@/features/spectra/ai/authority-execution";
import { spectraToolRegistry } from "@/features/spectra/tools/registry";

const DIRECT_OPERATION_TYPES = new Set<SpectraOperationType>([
  "artifact.create",
  "artifact.update",
  "workspaceItem.add",
  "workspaceItem.hide",
  "workspaceItem.setPinned",
  "thread.create",
  "workspace.update",
  "artifact.link",
  "app.command",
  "resultCard.create",
  "resultCard.update",
  "plannerTask.create",
  "quiz.create",
  "flashcardDeck.create",
]);

const CONFIRMATION_OPERATION_TYPES = new Set<SpectraOperationType>([
  "workspace.create",
  "artifact.archive",
  "delete",
]);

// Review thresholds are not execution ceilings. Broad work pauses for one
// durable confirmation, then continues under the same lease/checkpoint model.
export const REVIEW_OPERATIONS_THRESHOLD = 64;
export const REVIEW_ARTIFACTS_THRESHOLD = 32;
export const DIRECT_MUTATION_LIMIT = 3;

export function operationRequiresConfirmation(operation: OperationInput) {
  if (CONFIRMATION_OPERATION_TYPES.has(operation.type)) return true;
  if (
    operation.bulkCount !== undefined &&
    operation.bulkCount > 1 &&
    operation.type !== "flashcardDeck.create" &&
    operation.type !== "quiz.create"
  )
    return true;
  if (operation.affected.length > 10) return true;
  return !DIRECT_OPERATION_TYPES.has(operation.type);
}

export function assertOperationAllowed(operation: OperationInput) {
  return {
    ...operation,
    requiresConfirmation: operationRequiresConfirmation(operation),
  };
}

export type PlanPolicy = {
  requiresConfirmation: boolean;
  reasons: string[];
  visibleObjectCreations: number;
};

export function evaluatePlanPolicy(
  operations: ModelOperation[],
  options?: { intent?: RequestIntent },
): PlanPolicy {
  const artifactCreates = operations.filter(
    (operation) => operation.type === "artifact.create",
  ).length;

  const reasons: string[] = [];
  if (operations.reduce((count, operation) => count + (operation.type === "artifact.update" ? operation.input.documentOperations?.filter((item) => item.kind === "review-revision").length ?? 0 : 0), 0) > 1) reasons.push("Review the selected Word revisions before accepting or rejecting them together");
  if (operations.some((operation) => operation.type === "workspace.create"))
    reasons.push("Create a new workspace");
  const appCommands = operations.filter((operation) => operation.type === "app.command");
  for (const operation of appCommands) {
    const command = operation.input.command;
    const args =
      operation.input.args &&
      typeof operation.input.args === "object" &&
      !Array.isArray(operation.input.args)
        ? (operation.input.args as Record<string, unknown>)
        : {};
    const definition = spectraToolRegistry.get(command);
    const authority = evaluateApplicationAuthority({
      command,
      args,
      localFileCount: Number(args.localFileCount) || 0,
      authorityTarget: definition?.authorityTarget,
    });
    if (!definition) {
      reasons.push(`Approve ${command.replaceAll("_", " ")}`);
      continue;
    }
    if (!authorityRequiresConfirmation(authority.decision)) continue;
    if (command === "change_spectra_settings")
      reasons.push("Change Spectra settings");
    else if (command === "change_sync_policy") {
      const count = Math.max(
        0,
        Math.floor(Number(args.localFileCount) || 0),
      );
      reasons.push(
        `Change sync policy; this will affect ${count} file${count === 1 ? "" : "s"} on this PC`,
      );
    } else if (command === "delete_library_items") {
      const count = Math.max(
        0,
        Math.floor(Number(args.localFileCount) || 0),
      );
      reasons.push(
        count > 0
          ? `Delete Library items. This will affect ${count} file${count === 1 ? "" : "s"} on this PC.`
          : "Delete Library items",
      );
    } else if (command === "change_sharing")
      reasons.push("Change sharing or permissions");
    else if (command === "change_managebac_mapping")
      reasons.push("Change ManageBac mapping");
    else reasons.push(authorityPublicMessage(authority));
  }
  if (operations.some((operation) => operation.type === "artifact.archive"))
    reasons.push("Archive the selected artifact");
  if (artifactCreates > 1)
    reasons.push(`Create ${artifactCreates} visible artifacts`);
  if (operations.length > DIRECT_MUTATION_LIMIT)
    reasons.push(`Apply ${operations.length} changes`);
  if (operations.length > REVIEW_OPERATIONS_THRESHOLD)
    reasons.push(`Review this ${operations.length}-step run before it begins`);
  if (artifactCreates > REVIEW_ARTIFACTS_THRESHOLD)
    reasons.push(`Review creation of ${artifactCreates} visible artifacts`);
  const placementChanges = operations.filter(
    (operation) =>
      operation.type === "workspaceItem.add" ||
      operation.type === "workspaceItem.hide",
  ).length;
  if (placementChanges > 1)
    reasons.push(`Change ${placementChanges} workspace placements`);

  for (const operation of operations) {
    let content: Record<string, unknown> | null = null;
    let patchPaths: string[] = [];
    let replacesLiveCode = false;
    if (operation.type === "artifact.create") {
      if (operation.input.blueprintKey !== "code") continue;
      content = operation.input.content as unknown as Record<string, unknown>;
    } else if (operation.type === "artifact.update") {
      if (operation.input.blueprintKey !== "code") continue;
      const nextContent = operation.input.content;
      content =
        nextContent &&
        typeof nextContent === "object" &&
        !Array.isArray(nextContent)
          ? (nextContent as unknown as Record<string, unknown>)
          : null;
      patchPaths = (operation.input.contentPatch?.changes ?? []).map(
        (change: { path: string }) => change.path,
      );
      replacesLiveCode = Boolean(content);
    } else {
      continue;
    }
    if (replacesLiveCode) {
      reasons.push(
        "Review a broad Code rewrite before replacing the live file tree",
      );
    }
    if (
      patchPaths.some(
        (path) => path === "/files" || /^\/files\/\d+$/.test(path),
      )
    ) {
      reasons.push("Review structural Code file changes");
    }
    const bindings =
      content && Array.isArray(content.resourceBindings)
        ? content.resourceBindings
        : [];
    if (
      bindings.length > 0 ||
      patchPaths.some((path) => path.startsWith("/resourceBindings"))
    ) {
      reasons.push("Approve new or changed permissioned runtime resources");
    }
    const network =
      content?.networkPolicy &&
      typeof content.networkPolicy === "object" &&
      !Array.isArray(content.networkPolicy)
        ? (content.networkPolicy as Record<string, unknown>)
        : null;
    if (
      network?.mode === "allowlist" ||
      patchPaths.some((path) => path.startsWith("/networkPolicy"))
    ) {
      reasons.push("Approve a Code network-policy change");
    }
    // normalizeCodeContent always materializes `dependencies: {}`. An empty
    // map is not a consequential dependency change and must not pause a
    // successful single-artifact create behind Apply changes.
    const dependencyEntries =
      content?.dependencies &&
      typeof content.dependencies === "object" &&
      !Array.isArray(content.dependencies)
        ? Object.keys(content.dependencies as Record<string, unknown>)
        : [];
    if (
      dependencyEntries.length > 0 ||
      patchPaths.some((path) => path.startsWith("/dependencies"))
    ) {
      reasons.push("Review Code dependency changes");
    }
    if (
      (content && Array.isArray(content.assets) && content.assets.length > 0) ||
      patchPaths.some((path) => path.startsWith("/assets"))
    ) {
      reasons.push("Review immutable Code asset reference changes");
    }
  }

  // Cards and quiz questions are content inside one artifact and never increase this count.
  if (
    options?.intent &&
    options.intent.requestedVisibleArtifactCount > REVIEW_ARTIFACTS_THRESHOLD
  ) {
    reasons.push(
      `The request covers ${options.intent.requestedVisibleArtifactCount} visible artifacts`,
    );
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    requiresConfirmation: uniqueReasons.length > 0,
    reasons: uniqueReasons,
    visibleObjectCreations: artifactCreates,
  };
}
