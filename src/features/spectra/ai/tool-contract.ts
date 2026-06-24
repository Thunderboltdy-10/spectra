export type SpectraToolCapability = {
  type: string;
  purpose: string;
  execution: "immediate" | "confirmation" | "deferred";
  availability: "wave5" | "future";
  batchable: boolean;
};

export const SPECTRA_TOOL_CONTRACT: readonly SpectraToolCapability[] = [
  { type: "artifact.create", purpose: "Create one validated Spectra artifact when the user explicitly asks for an object.", execution: "immediate", availability: "wave5", batchable: true },
  { type: "artifact.update", purpose: "Update one owned artifact when the user identifies or clearly refers to it.", execution: "immediate", availability: "wave5", batchable: false },
  { type: "workspaceItem.add", purpose: "Place an owned artifact in an owned workspace only when placement is requested.", execution: "immediate", availability: "wave5", batchable: true },
  { type: "workspaceItem.hide", purpose: "Hide a requested workspace placement without deleting the source object.", execution: "immediate", availability: "wave5", batchable: true },
  { type: "workspace.create", purpose: "Create a workspace after explicit confirmation.", execution: "confirmation", availability: "wave5", batchable: false },
  { type: "workspace.update", purpose: "Update the name, description, icon, or color of an owned workspace when explicitly requested.", execution: "immediate", availability: "wave5", batchable: false },
  { type: "artifact.link", purpose: "Create a typed, explained relationship between two owned artifacts.", execution: "immediate", availability: "wave5", batchable: true },
  { type: "skill.load", purpose: "Load one or more relevant skills before specialized work.", execution: "deferred", availability: "future", batchable: true },
  { type: "research.search", purpose: "Use a research provider when current external evidence is required.", execution: "deferred", availability: "future", batchable: true },
  { type: "context.file.read", purpose: "Read user-selected files or contextual sources.", execution: "deferred", availability: "future", batchable: true },
  { type: "agent.spawn", purpose: "Delegate an independent bounded task to a sub-agent.", execution: "confirmation", availability: "future", batchable: true },
] as const;

export function activeToolContractPrompt() {
  return SPECTRA_TOOL_CONTRACT
    .filter((capability) => capability.availability === "wave5")
    .map((capability) => `- ${capability.type}: ${capability.purpose} ${capability.batchable ? "Independent calls may be batched." : ""}`.trim())
    .join("\n");
}
