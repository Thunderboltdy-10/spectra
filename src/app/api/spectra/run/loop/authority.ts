import {
  evaluateApplicationAuthority,
  type ApplicationAuthorityEvaluation,
} from "@/features/spectra/ai/authority-execution";
import type { AiTargetClass } from "@/features/spectra/ai/authority-policy";
import { mutate, query } from "./io";

function stringIds(value: unknown) {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
}

export async function localFileCountForApplicationCommand(
  actorClerkId: string,
  command: string,
  args: Record<string, unknown>,
) {
  const targetIds = stringIds(args.targetIds);
  if (targetIds.length === 0) return 0;
  if (command === "change_sync_policy") {
    const localEffect = await query<
      { workIds: string[] },
      { count: number }
    >("replicas:localEffectCount", {
      actorClerkId,
      workIds: targetIds,
    }).catch(() => ({ count: 0 }));
    return localEffect.count;
  }
  if (command === "organize_library" || command === "delete_library_items") {
    const localEffect = await query<
      { nodeIds: string[] },
      { count: number }
    >("replicas:localEffectCountForNodes", {
      actorClerkId,
      nodeIds: targetIds,
    }).catch(() => ({ count: 0 }));
    return localEffect.count;
  }
  return 0;
}

export async function evaluateCommandAuthority(input: {
  actorClerkId: string;
  command: string;
  args: Record<string, unknown>;
  authorityTarget?: AiTargetClass;
}): Promise<ApplicationAuthorityEvaluation> {
  const localFileCount = await localFileCountForApplicationCommand(
    input.actorClerkId,
    input.command,
    input.args,
  );
  if (
    (input.command === "organize_library" ||
      input.command === "delete_library_items" ||
      input.command === "change_sync_policy") &&
    stringIds(input.args.targetIds).length > 0
  )
    input.args.localFileCount = localFileCount;
  return evaluateApplicationAuthority({
    command: input.command,
    args: input.args,
    localFileCount,
    authorityTarget: input.authorityTarget,
  });
}

export async function hydrateApplicationLocalFileCounts(
  actorClerkId: string,
  operations: Array<{ type: string; input: { command?: string; args?: unknown } }>,
) {
  for (const operation of operations) {
    if (operation.type !== "app.command") continue;
    const command = operation.input.command;
    if (
      command !== "organize_library" &&
      command !== "delete_library_items" &&
      command !== "change_sync_policy"
    )
      continue;
    const args =
      operation.input.args &&
      typeof operation.input.args === "object" &&
      !Array.isArray(operation.input.args)
        ? (operation.input.args as Record<string, unknown>)
        : {};
    args.localFileCount = await localFileCountForApplicationCommand(
      actorClerkId,
      command,
      args,
    );
    operation.input.args = args;
  }
}

export async function recordAuthorityDecision(input: {
  actorClerkId: string;
  runId?: string;
  executionId?: string;
  command: string;
  decision: string;
  target: string;
  reason: string;
  consequence?: string;
  localFileCount?: number;
}) {
  await mutate("spectraRuns:recordAuthorityDecision", {
    actorClerkId: input.actorClerkId,
    runId: input.runId,
    executionId: input.executionId,
    command: input.command,
    decision: input.decision,
    target: input.target,
    reason: input.reason,
    consequence: input.consequence,
    localFileCount: input.localFileCount,
  }).catch(() => null);
}
