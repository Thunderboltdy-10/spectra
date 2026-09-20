export type AiAuthorityMode = "standard" | "permissive";
export type AiTargetClass =
  | "content"
  | "navigation"
  | "read"
  | "settings"
  | "tree"
  | "tree_delete"
  | "sharing"
  | "local_file"
  | "managebac_sync"
  | "managebac_selection"
  | "managebac_resource_import"
  | "managebac_mapping"
  | "memory"
  | "credential"
  | "bridge_pair"
  | "account_security";
export type AiSyncPolicy = "ask" | "mirror" | "cloud" | "local" | "none";
export type AiAuthorityDecision =
  "proceed" | "notify" | "confirm" | "always-confirm" | "prohibited";

export type AiAuthorityInput = {
  target: AiTargetClass;
  mode?: AiAuthorityMode;
  syncPolicy?: AiSyncPolicy;
  fileCount?: number;
};

export type AiAuthorityResult = {
  decision: AiAuthorityDecision;
  reason: string;
  consequence?: string;
};

/**
 * The single client/server-shareable D37 decision table. Callers may decorate
 * the result for UI, but must not reinterpret it in prompts or page code.
 */
export function decideAiAuthority(input: AiAuthorityInput): AiAuthorityResult {
  const mode = input.mode ?? "standard";
  const count =
    input.fileCount === undefined
      ? 1
      : Math.max(0, Math.floor(input.fileCount));
  const fileLabel = `${count} file${count === 1 ? "" : "s"}`;
  switch (input.target) {
    case "credential":
    case "bridge_pair":
    case "account_security":
      return {
        decision: "prohibited",
        reason:
          "Security, credentials, Bridge pairing, and account controls are never AI-performable.",
      };
    case "read":
    case "navigation":
      return {
        decision: "proceed",
        reason: "Reads and navigation are non-mutating.",
      };
    case "content":
      return {
        decision: "proceed",
        reason:
          "Reversible content work may proceed under the existing artifact claims and history.",
      };
    case "settings":
      return {
        decision: "always-confirm",
        reason:
          "Preference and toolbar changes always require explicit approval.",
      };
    case "tree_delete":
      return mode === "permissive"
        ? {
            decision: "confirm",
            reason:
              "Permissive mode removes the routine prompt, but deletion remains reviewable.",
          }
        : {
            decision: "confirm",
            reason: "Deleting organizational work requires explicit approval.",
          };
    case "tree":
      return {
        decision: mode === "permissive" ? "proceed" : "notify",
        reason:
          "Organizational changes are reversible and visible in the Live Dock.",
      };
    case "sharing":
      return {
        decision: "confirm",
        reason: "Sharing and permission changes affect other people.",
      };
    case "local_file":
      return {
        decision: "confirm",
        reason: "A real local-file effect requires explicit approval.",
        consequence:
          count === 0
            ? "No files on this PC would change."
            : `This will affect ${fileLabel} on this PC.`,
      };
    case "managebac_sync":
      return {
        decision: "confirm",
        reason:
          "Refreshing ManageBac data can change the school records available to Spectra, so it requires explicit approval.",
      };
    case "managebac_selection":
      return {
        decision: "confirm",
        reason:
          "Changing selected ManageBac classes changes which school data may enter personal planning.",
      };
    case "managebac_resource_import":
      return {
        decision: "confirm",
        reason:
          "Importing a school resource creates a personal Library copy and requires explicit approval.",
      };
    case "managebac_mapping":
      return {
        decision: "confirm",
        reason:
          "Changing a ManageBac mapping changes future school-data interpretation.",
      };
    case "memory":
      return {
        decision: "notify",
        reason: "Memory writes proceed with attribution and revision history.",
      };
    default:
      return {
        decision: "prohibited",
        reason: "This AI action has no registered authority policy.",
      };
  }
}
