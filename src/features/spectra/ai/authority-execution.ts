import {
  decideAiAuthority,
  type AiAuthorityResult,
  type AiTargetClass,
} from "./authority-policy";

export type ApplicationAuthorityEvaluation = AiAuthorityResult & {
  target: AiTargetClass;
  notice?: string;
};

function commandAction(args: Record<string, unknown>) {
  return typeof args.action === "string" ? args.action : undefined;
}

function targetCount(args: Record<string, unknown>) {
  const targetIds = Array.isArray(args.targetIds)
    ? args.targetIds.filter((id): id is string => typeof id === "string")
    : [];
  return targetIds.length;
}

/**
 * Disk-affecting Library reorganize is local_file, not tree. create_folder
 * stays tree (notify). The count is owned data, never a model-supplied number.
 */
export function applicationAuthorityTarget(
  command: string,
  args: Record<string, unknown>,
  localFileCount: number,
): { target: AiTargetClass; fileCount: number } {
  const count = Math.max(0, Math.floor(localFileCount));
  if (command === "change_sync_policy")
    return { target: "local_file", fileCount: count };
  if (command === "delete_library_items")
    return { target: "tree_delete", fileCount: count || targetCount(args) };
  if (command === "organize_library") {
    const action = commandAction(args);
    if (
      (action === "rename" || action === "move" || action === "link") &&
      count > 0
    )
      return { target: "local_file", fileCount: count };
    return { target: "tree", fileCount: count };
  }
  return {
    target: "tree",
    fileCount: count,
  };
}

export function evaluateApplicationAuthority(input: {
  command: string;
  args: Record<string, unknown>;
  localFileCount: number;
  localFileCountUnknown?: boolean;
  authorityTarget?: AiTargetClass;
}): ApplicationAuthorityEvaluation {
  const diskCounted =
    input.command === "organize_library" ||
    input.command === "delete_library_items" ||
    input.command === "change_sync_policy";
  if (diskCounted && input.localFileCountUnknown) {
    const result = decideAiAuthority({
      target: "local_file",
      fileCount: undefined,
    });
    return {
      ...result,
      target: "local_file",
      notice: undefined,
      reason:
        "Spectra could not verify how many local files this change would affect.",
      consequence:
        "Approval is required because the local-file effect is unknown — not because zero files are affected.",
    };
  }
  const resolved = diskCounted
    ? applicationAuthorityTarget(
        input.command,
        input.args,
        input.localFileCount,
      )
    : {
        target: input.authorityTarget ?? "tree",
        fileCount:
          Math.max(0, Math.floor(input.localFileCount)) ||
          targetCount(input.args),
      };
  const result = decideAiAuthority({
    target: resolved.target,
    fileCount: resolved.fileCount || undefined,
  });
  const notice =
    result.decision === "notify"
      ? result.consequence
        ? `${result.reason} ${result.consequence}`
        : result.reason
      : undefined;
  return { ...result, target: resolved.target, notice };
}

export function authorityRequiresConfirmation(
  decision: ApplicationAuthorityEvaluation["decision"],
) {
  return decision === "confirm" || decision === "always-confirm";
}

export function authorityRequiresNotice(
  decision: ApplicationAuthorityEvaluation["decision"],
) {
  return decision === "notify";
}

export function authorityPublicMessage(result: ApplicationAuthorityEvaluation) {
  return result.consequence
    ? `${result.reason} ${result.consequence}`
    : result.reason;
}

export function confirmationDiffSummary(input: {
  targetTitles: string[];
  reasons: string[];
}) {
  const targets = input.targetTitles
    .map((title) => title.trim())
    .filter(Boolean)
    .slice(0, 4);
  const targetLine =
    targets.length === 0
      ? null
      : targets.length === 1
        ? `Editing ${targets[0]}`
        : `Editing ${targets.slice(0, -1).join(", ")} and ${targets.at(-1)}`;
  const reasonLines = input.reasons
    .map((reason) => reason.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return [...(targetLine ? [targetLine] : []), ...reasonLines]
    .slice(0, 8)
    .join(" · ");
}
