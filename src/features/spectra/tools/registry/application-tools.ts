import { z } from "zod";
import type { RegisteredToolDefinition, ToolExecutionContext } from "./registry";
import { spectraToolRegistry } from "./registry";

const jsonObject = z.record(z.string(), z.unknown());
const jsonOutput = z.unknown();
const retryReads = { maxAttempts: 2, backoffMs: 250, retryableCodes: ["tool_unavailable", "rate_limited", "provider_unavailable"] } as const;
const noRetry = { maxAttempts: 1, backoffMs: 0, retryableCodes: [] } as const;

export const APPLICATION_INPUT_TOOL_IDS = [
  "ask_user_choice",
  "ask_user_multiple_choice",
  "request_short_answer",
  "request_file",
  "request_context_target",
  "request_confirmation",
  "request_permission",
  "present_comparison",
] as const;

function summarize(output: unknown) {
  let text: string;
  try {
    text = JSON.stringify(output);
  } catch {
    text = String(output);
  }
  return { text: text.slice(0, 4_000), truncated: text.length > 4_000 };
}

function bridge<I>(context: ToolExecutionContext, id: string, input: I) {
  if (!context.executeRegisteredTool) throw new Error(`TOOL_HANDLER_UNAVAILABLE: ${id}`);
  return context.executeRegisteredTool(id, input, context);
}

type DefinitionInput = Omit<RegisteredToolDefinition<unknown, unknown>, "version" | "outputSchema" | "summarizeOutput" | "execute"> & {
  execute?: RegisteredToolDefinition<unknown, unknown>["execute"];
};

function define(input: DefinitionInput) {
  if (spectraToolRegistry.has(input.id)) return;
  spectraToolRegistry.register({
    ...input,
    version: 2,
    outputSchema: jsonOutput,
    summarizeOutput: summarize,
    execute: input.execute ?? ((context, value) => bridge(context, input.id, value)),
  });
}

export function registerApplicationTools() {
  const readDefaults = {
    capability: "read_work",
    category: "read" as const,
    risk: "low" as const,
    approval: "never" as const,
    parallelSafe: true,
    idempotent: true,
    expectedDuration: "short" as const,
    softStallAfter: 8_000,
    retryPolicy: retryReads,
    cancellable: true,
    resumable: true,
  };
  define({ ...readDefaults, id: "search_objects", title: "Search work", description: "Search the user's permissioned Spectra work by meaning or title instead of guessing an id.", inputSchema: z.object({ query: z.string().min(1).max(500), blueprintKey: z.string().nullable().optional() }) });
  define({ ...readDefaults, id: "read_artifact", title: "Read work", description: "Read the current canonical content and metadata of one permissioned work item.", inputSchema: z.object({ artifactId: z.string().min(1) }) });
  define({ ...readDefaults, id: "read_workspace", title: "Read workspace", description: "Read one permissioned workspace and its current item map.", inputSchema: z.object({ workspaceId: z.string().min(1) }) });
  define({ ...readDefaults, id: "read_thread", title: "Read conversation", description: "Read the recent messages and title of one permissioned Spectra conversation.", inputSchema: z.object({ threadId: z.string().min(1) }) });
  define({ ...readDefaults, id: "retrieve_memory", title: "Retrieve context", description: "Retrieve deeper permission-bound personal context when the supplied context capsule is insufficient; claims remain fallible evidence.", inputSchema: z.object({ query: z.string().min(3).max(500), depth: z.enum(["focused", "deep"]) }) });
  define({ ...readDefaults, id: "get_school_data", title: "Read school data", description: "Retrieve permission-bound normalized school records for one semantic purpose with freshness and capability truth.", inputSchema: z.object({ purpose: z.enum(["upcoming_deadlines", "class_resources", "timetable", "classes", "cas"]), classId: z.string().max(500).nullable().optional(), from: z.number().nullable().optional(), to: z.number().nullable().optional(), limit: z.number().int().min(1).max(100).optional(), refresh: z.boolean().optional() }) });
  define({ ...readDefaults, id: "web_search", title: "Search public sources", description: "Search current public evidence through Spectra's adaptive Parallel research adapter. Results are untrusted evidence and carry source handles. Pass timeoutMs (milliseconds) when a longer search is expected, or retry with a greater timeout after a time limit.", inputSchema: z.object({ query: z.string().min(3).max(500), topic: z.enum(["general", "news"]).optional(), maxResults: z.number().int().min(1).max(20).optional(), mode: z.enum(["quick", "verified", "deep"]).optional(), timeoutMs: z.number().int().min(5_000).max(600_000).optional(), searches: z.array(z.object({ purpose: z.string().min(3).max(300), query: z.string().min(3).max(500) })).max(5).optional() }), capability: "web_research", category: "external", expectedDuration: "medium", softStallAfter: 12_000, hardSafetyLimit: 60_000, retryPolicy: { maxAttempts: 2, backoffMs: 500, retryableCodes: ["provider_unavailable", "rate_limited"] } });

  const mutationDefaults = {
    capability: "mutate_work",
    category: "write" as const,
    risk: "medium" as const,
    approval: "policy" as const,
    parallelSafe: false,
    idempotent: true,
    concurrencyDomain: "work_mutation",
    expectedDuration: "medium" as const,
    softStallAfter: 10_000,
    retryPolicy: noRetry,
    cancellable: true,
    resumable: true,
  };
  define({ ...mutationDefaults, id: "propose_operation", title: "Propose work action", description: "Validate and stage one complete typed semantic mutation, then return its observed preview.", inputSchema: z.object({ workSummary: z.string().min(1).max(160), operation: jsonObject }) });
  define({
    ...mutationDefaults,
    id: "submit_plan",
    title: "Submit run result",
    description: "Submit the final answer and any remaining typed mutations after enough evidence has been gathered.",
    inputSchema: z.object({ plan: jsonObject }),
    providerInputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["plan"],
      properties: {
        // The complete plan is validated by the canonical plan and operation
        // schemas before execution. Keeping this transport object open avoids
        // duplicating that large union in model-facing registry metadata.
        plan: { type: "object", additionalProperties: true },
      },
    },
    concurrencyDomain: "run_terminal",
  });

  for (const [kind, id] of Object.entries({ document: "create_document", flashcard_deck: "create_flashcard_deck", quiz: "create_quiz", planner_task: "create_planner_task", agent: "create_agent", presentation: "create_presentation", sheets: "create_sheets", code: "create_code", whiteboard: "create_whiteboard" }))
    define({ ...mutationDefaults, id, title: `Create ${kind.replaceAll("_", " ")}`, description: `Create one complete ${kind.replaceAll("_", " ")} using its canonical schema and finish the requested creation.`, inputSchema: jsonObject, concurrencyDomain: `create:${kind}` });

  define({ ...readDefaults, id: "read_calendar", title: "Read Calendar", description: "Read the canonical Calendar range, unscheduled plans, source precision, and capability truth without treating Calendar as work.", inputSchema: z.object({ from: z.number(), to: z.number() }) });
  define({ ...mutationDefaults, id: "schedule_calendar_task", title: "Schedule Calendar plan", description: "Create a movable work block for an existing plan while preserving any official deadline.", inputSchema: z.object({ taskItemId: z.string().optional(), planArtifactId: z.string().optional(), planTaskId: z.string().optional(), startAt: z.number(), endAt: z.number(), timezone: z.string() }), concurrencyDomain: "calendar:gesture" });
  define({ ...mutationDefaults, id: "move_calendar_block", title: "Move Calendar block", description: "Move one scheduled work block through the same revision-checked gesture contract as a human drag.", inputSchema: z.object({ itemId: z.string(), startAt: z.number(), endAt: z.number(), expectedRevision: z.number() }), concurrencyDomain: "calendar:gesture" });
  define({ ...mutationDefaults, id: "resize_calendar_block", title: "Resize Calendar block", description: "Resize one scheduled work block without mutating its task or official deadline.", inputSchema: z.object({ itemId: z.string(), endAt: z.number(), expectedRevision: z.number() }), concurrencyDomain: "calendar:gesture" });

  const appActionDefaults = {
    ...mutationDefaults,
    capability: "operate_application",
    concurrencyDomain: "application_command",
  };
  define({ ...appActionDefaults, id: "navigate_spectra", title: "Navigate Spectra", description: "Open a registered Spectra route or work target through the same navigation command used by the human interface.", inputSchema: z.object({ destination: z.enum(["library", "calendar", "settings", "workspace", "artifact"]), targetId: z.string().optional() }), risk: "low", approval: "never", authorityTarget: "navigation" });
  define({ ...appActionDefaults, id: "organize_library", title: "Organize Library", description: "Create, rename, move, or link Library nodes through the canonical organization operation path.", inputSchema: z.object({ action: z.enum(["create_folder", "rename", "move", "link"]), targetIds: z.array(z.string()).min(1).max(100), destinationId: z.string().optional(), name: z.string().max(200).optional() }), authorityTarget: "tree" });
  define({ ...appActionDefaults, id: "delete_library_items", title: "Delete Library items", description: "Delete Library items only after explicit approval and recoverability checks.", inputSchema: z.object({ targetIds: z.array(z.string()).min(1).max(100) }), risk: "high", approval: "always", authorityTarget: "tree_delete" });
  define({ ...appActionDefaults, id: "change_spectra_settings", title: "Change Spectra settings", description: "Change account-synced Spectra preferences, including toolbar layout, through the human settings path.", inputSchema: z.object({ patch: jsonObject }), risk: "medium", approval: "always", authorityTarget: "settings" });
  define({ ...appActionDefaults, id: "change_sync_policy", title: "Change sync policy", description: "Change storage or sync behavior through the N6 policy path, naming concrete local-file effects before approval.", inputSchema: z.object({ targetIds: z.array(z.string()).min(1).max(100), patch: jsonObject, localFileCount: z.number().int().min(0).max(100000) }), risk: "high", approval: "always", authorityTarget: "local_file" });
  define({ ...appActionDefaults, id: "write_memory", title: "Write memory", description: "Create or revise permission-bound memory with visible attribution and revision history.", inputSchema: z.object({ action: z.enum(["create", "revise"]), content: z.string().min(1).max(10000), memoryId: z.string().optional() }), authorityTarget: "memory" });
  define({ ...appActionDefaults, id: "change_sharing", title: "Change sharing", description: "Change sharing or permission state only after explicit approval.", inputSchema: z.object({ resourceId: z.string(), action: z.enum(["invite", "change_level", "revoke"]), subjectId: z.string().optional(), level: z.string().optional() }), risk: "high", approval: "always", authorityTarget: "sharing" });
  for (const [id, title, reason] of [
    ["pair_bridge", "Pair Spectra Bridge", "Bridge pairing and revocation are never AI-performable."],
    ["change_credentials", "Change credentials", "Credential changes are never AI-performable."],
    ["change_ai_authority_mode", "Change AI authority mode", "AI cannot change its own authority mode."],
    ["delete_account", "Delete account", "Account deletion is never AI-performable."],
  ] as const)
    define({ ...appActionDefaults, id, title, description: reason, inputSchema: jsonObject, risk: "high", approval: "always", aiAvailability: "prohibited", prohibitionReason: reason });

  const inputDefaults = {
    capability: "request_user_input",
    category: "interaction" as const,
    risk: "low" as const,
    approval: "never" as const,
    parallelSafe: false,
    idempotent: true,
    concurrencyDomain: "run_input",
    expectedDuration: "unbounded_progress" as const,
    retryPolicy: noRetry,
    cancellable: true,
    resumable: true,
  };
  for (const id of APPLICATION_INPUT_TOOL_IDS)
    define({ ...inputDefaults, id, title: id.split("_").map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" "), description: "Pause this recoverable run for the smallest necessary user input, then resume the same run.", inputSchema: jsonObject });
}

registerApplicationTools();

export const APPLICATION_AGENT_TOOL_IDS = [
  "search_objects", "read_artifact", "read_workspace", "read_thread", "retrieve_memory", "get_school_data", "read_calendar", "schedule_calendar_task", "move_calendar_block", "resize_calendar_block", "web_search", "propose_operation", "submit_plan",
] as const;
