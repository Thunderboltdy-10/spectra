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
  _actorClerkId: string,
  command: string,
  args: Record<string, unknown>,
): Promise<number | null> {
  const targetIds = stringIds(args.targetIds);
  if (targetIds.length === 0) return 0;
  if (command === "change_sync_policy") {
    try {
      const localEffect = await query<{ workIds: string[] }, { count: number }>(
        "replicas:localEffectCount",
        { workIds: targetIds },
      );
      return localEffect.count;
    } catch {
      // Unknown local effects must not be reported as zero affected files.
      return null;
    }
  }
  if (command === "organize_library" || command === "delete_library_items") {
    try {
      const localEffect = await query<
        { nodeIds: string[] },
        { count: number }
      >("replicas:localEffectCountForNodes", {
        nodeIds: targetIds,
      });
      return localEffect.count;
    } catch {
      return null;
    }
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
  ) {
    if (localFileCount === null) input.args.localFileCountUnknown = true;
    else input.args.localFileCount = localFileCount;
  }
  return evaluateApplicationAuthority({
    command: input.command,
    args: input.args,
    localFileCount: localFileCount ?? 0,
    localFileCountUnknown: localFileCount === null,
    authorityTarget: input.authorityTarget,
  });
}

export async function hydrateApplicationLocalFileCounts(
  actorClerkId: string,
  operations: ReadonlyArray<{ type: string; input: unknown }>,
) {
  for (const operation of operations) {
    if (operation.type !== "app.command") continue;
    if (
      !operation.input ||
      typeof operation.input !== "object" ||
      Array.isArray(operation.input)
    )
      continue;
    const input = operation.input as {
      command?: string;
      args?: unknown;
    };
    const command = input.command;
    if (
      command !== "organize_library" &&
      command !== "delete_library_items" &&
      command !== "change_sync_policy"
    )
      continue;
    const args =
      input.args &&
      typeof input.args === "object" &&
      !Array.isArray(input.args)
        ? (input.args as Record<string, unknown>)
        : {};
    const count = await localFileCountForApplicationCommand(
      actorClerkId,
      command,
      args,
    );
    if (count === null) {
      args.localFileCountUnknown = true;
      delete args.localFileCount;
    } else {
      args.localFileCount = count;
      delete args.localFileCountUnknown;
    }
    input.args = args;
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
