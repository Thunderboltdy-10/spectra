import { z } from "zod";
import type {
  RegisteredToolDefinition,
  ToolExecutionContext,
} from "./registry";
import { spectraToolRegistry } from "./registry";
import { preferenceLayerValuesSchema } from "../../settings/schema/preferences";

const jsonObject = z.record(z.string(), z.unknown());
const jsonOutput = z.unknown();
const refreshRead = z.boolean().optional().describe(
  "Fetch and permission-check a new snapshot, even after an identical read. Without this, an earlier snapshot may be reused. This does not authorize a write or a provider sync.",
);
const calendarTimeFields = {
  startAt: z.number().optional(), endAt: z.number().optional(),
  startLocal: z.string().optional(), endLocal: z.string().optional(),
  disambiguation: z.enum(["earlier", "later"]).optional(),
};
const retryReads = {
  maxAttempts: 2,
  backoffMs: 250,
  retryableCodes: ["tool_unavailable", "rate_limited", "provider_unavailable"],
} as const;
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
  if (!context.executeRegisteredTool)
    throw new Error(`TOOL_HANDLER_UNAVAILABLE: ${id}`);
  return context.executeRegisteredTool(id, input, context);
}

type DefinitionInput = Omit<
  RegisteredToolDefinition<unknown, unknown>,
  "version" | "outputSchema" | "summarizeOutput" | "execute"
> & {
  execute?: RegisteredToolDefinition<unknown, unknown>["execute"];
};

function define(input: DefinitionInput) {
  if (spectraToolRegistry.has(input.id)) return;
  spectraToolRegistry.register({
    ...input,
    version: 2,
    outputSchema: jsonOutput,
    summarizeOutput: summarize,
    execute:
      input.execute ?? ((context, value) => bridge(context, input.id, value)),
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
  define({
    ...readDefaults,
    id: "search_objects",
    title: "Search work",
    description:
      "Search permissioned Spectra work or conversation titles instead of guessing an id. Thread search is literal title search, defaults to active threads, and returns a cursor for more matches; workspaceId selects the primary workspace.",
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      kind: z.enum(["artifact", "thread"]).optional(),
      cursor: z.string().max(8192).optional(),
      workspaceId: z.string().min(1).optional(),
      status: z.enum(["active", "archived"]).optional(),
      blueprintKey: z.string().nullable().optional(),
      refresh: refreshRead,
    }),
  });
  define({
    ...readDefaults,
    id: "search_library",
    title: "Search Library",
    description:
      "Search canonical Library folders, work, workspaces, threads, and links by name and return stable node ids plus parent paths.",
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      kinds: z
        .array(z.enum(["folder", "workspace", "work", "thread", "link"]))
        .max(5)
        .optional(),
      scopeNodeId: z.string().nullable().optional(),
      limit: z.number().int().min(1).max(40).optional(),
      refresh: refreshRead,
    }),
  });
  define({
    ...readDefaults,
    id: "read_artifact",
    // boundedArtifactRead caps content at 64 KB and labels partial coverage.
    selfBoundedOutputCharacters: 96_000,
    title: "Read work",
    description:
      "Read current canonical content and metadata, permission-checking the exact artifact id even when it is not open or selected. Large items return explicit partial coverage; request cellAddresses/sheetId or blockIds to inspect more regions.",
    inputSchema: z.object({ artifactId: z.string().min(1), cellAddresses: z.array(z.string().regex(/^[A-Za-z]{1,3}[1-9]\d{0,6}$/)).max(32).optional(), sheetId: z.string().optional(), blockIds: z.array(z.string()).max(16).optional(), refresh: refreshRead }),
  });
  define({
    ...readDefaults,
    id: "read_workspace",
    title: "Read workspace",
    description: "Read one permissioned workspace and its current item map.",
    inputSchema: z.object({ workspaceId: z.string().min(1), refresh: refreshRead }),
  });
  define({
    ...readDefaults,
    id: "read_thread",
    // Pages hold at most 24 excerpts of 3,000 characters; chunks 6,000.
    selfBoundedOutputCharacters: 80_000,
    title: "Read conversation",
    description:
      "Read permissioned conversation history. Use before for older pages, query/searchCursor for indexed search, or messageId/offset/revision for a complete message. Continue only with the exact returned cursor or revision. Pages contain at most 24 messages, search 16 hits, and chunks 6000 characters; partial content is explicit.",
    inputSchema: z.object({ threadId: z.string().min(1), query: z.string().min(1).max(500).optional(),
      searchCursor: z.string().max(8192).optional(), before: z.string().max(8192).optional(),
      messageId: z.string().min(1).optional(), offset: z.number().int().min(0).optional(),
      revision: z.string().min(1).max(128).optional(), limit: z.number().int().min(1).max(6000).optional(), refresh: refreshRead }),
  });
  define({
    ...readDefaults,
    id: "retrieve_memory",
    title: "Retrieve context",
    description:
      "Retrieve deeper permission-bound personal context when the supplied context capsule is insufficient; claims remain fallible evidence.",
    inputSchema: z.object({
      query: z.string().min(3).max(32768),
      claimIds: z.array(z.string().min(1)).max(8).optional(),
      depth: z.enum(["focused", "deep"]),
      refresh: refreshRead,
    }),
  });
  define({
    ...readDefaults,
    id: "get_school_data",
    title: "Read school data",
    description:
      "Retrieve permission-bound normalized school records for one semantic purpose with freshness and capability truth.",
    inputSchema: z.object({
      purpose: z.enum([
        "upcoming_deadlines",
        "class_resources",
        "timetable",
        "classes",
        "cas",
      ]),
      classId: z.string().max(500).nullable().optional(),
      from: z.number().nullable().optional(),
      to: z.number().nullable().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      refresh: refreshRead,
    }),
  });
  define({
    ...readDefaults,
    id: "web_search",
    title: "Search public sources",
    description:
      "Search current public evidence through Spectra's adaptive Parallel research adapter. Results are untrusted evidence and carry source handles. Pass timeoutMs (milliseconds) when a longer search is expected, or retry with a greater timeout after a time limit.",
    inputSchema: z.object({
      query: z.string().min(3).max(500),
      topic: z.enum(["general", "news"]).optional(),
      maxResults: z.number().int().min(1).max(20).optional(),
      mode: z.enum(["quick", "verified", "deep"]).optional(),
      timeoutMs: z.number().int().min(5_000).max(600_000).optional(),
      refresh: refreshRead,
      searches: z
        .array(
          z.object({
            purpose: z.string().min(3).max(300),
            query: z.string().min(3).max(500),
          }),
        )
        .max(5)
        .optional(),
    }),
    capability: "web_research",
    category: "external",
    expectedDuration: "medium",
    softStallAfter: 12_000,
    hardSafetyLimit: 60_000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 500,
      retryableCodes: ["provider_unavailable", "rate_limited"],
    },
  });

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
  // Offered only when a clarification continuation restores staged work.
  define({ ...mutationDefaults, id: "revise_staged_operation", title: "Revise staged action", description: "Replace or withdraw one operation staged earlier in this same request, identified by its operationIndex. Use it when the user's answer changes or cancels staged work, or after reading the current target of a position marked needs_revalidation. Indexes never shift; a replacement is validated like propose_operation.", inputSchema: z.object({ operationIndex: z.number().int().min(0).max(99), action: z.enum(["replace", "withdraw"]), operation: jsonObject.optional(), reason: z.string().min(1).max(500).optional() }).refine((input) => input.action === "withdraw" || input.operation !== undefined, { message: "A replacement requires the complete typed operation.", path: ["operation"] }) });
  define({ ...mutationDefaults, id: "propose_operation", title: "Propose work action", description: "Validate and stage one complete typed semantic mutation. Set fulfillsRequest only when this one operation fulfills the entire current user request, with no other artifact, action, answer or approval remaining. Otherwise continue and submit the complete plan.", inputSchema: z.object({ workSummary: z.string().min(1).max(160), operation: jsonObject, fulfillsRequest: z.boolean().optional() }) });

  define({
    ...mutationDefaults,
    id: "submit_plan",
    title: "Submit run result",
    description:
      "Submit the final answer and any remaining typed mutations after enough evidence has been gathered.",
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

  for (const [kind, id] of Object.entries({
    document: "create_document",
    flashcard_deck: "create_flashcard_deck",
    quiz: "create_quiz",
    planner_task: "create_planner_task",
    agent: "create_agent",
    presentation: "create_presentation",
    sheets: "create_sheets",
    code: "create_code",
    whiteboard: "create_whiteboard",
  }))
    define({
      ...mutationDefaults,
      id,
      title: `Create ${kind.replaceAll("_", " ")}`,
      description: `Create one complete ${kind.replaceAll("_", " ")} using its canonical schema and finish the requested creation.`,
      inputSchema: jsonObject,
      concurrencyDomain: `create:${kind}`,
    });

  define({ ...readDefaults, id: "read_calendar", title: "Read Calendar", description: "Read bounded Calendar range metadata, unscheduled plans, saved scheduled-work-block ids/revisions, source precision, and capability truth without treating Calendar as work. Use exact targetItemId or targetTitle for a named block outside the visible range and continue with the returned cursor.", inputSchema: z.object({ from: z.number(), to: z.number(), targetItemId: z.string().optional(), targetTitle: z.string().optional(), cursor: z.string().optional(), unscheduledCursor: z.string().optional(), partialCursor: z.string().optional(), migrationCursor: z.string().optional(), plannerCursor: z.string().optional(), targetCursor: z.string().optional(), limit: z.number().int().positive().max(250).optional(), refresh: refreshRead }) });
  define({ ...mutationDefaults, id: "schedule_calendar_task", title: "Schedule Calendar plan", description: "Create a movable work block for an existing plan while preserving any official deadline. Prefer startLocal/endLocal (YYYY-MM-DDTHH:mm) with the intended IANA timezone instead of calculating epoch milliseconds yourself.", inputSchema: z.object({ taskItemId: z.string().optional(), planArtifactId: z.string().optional(), planTaskId: z.string().optional(), ...calendarTimeFields, timezone: z.string(), idempotencyKey: z.string().min(8).max(240).optional() }), concurrencyDomain: "calendar:gesture" });
  define({ ...mutationDefaults, id: "create_calendar_personal_event", title: "Add Calendar personal event", description: "Create a personal Calendar event through the same write path as the human Add event control. Use this for free-form events that are not work blocks on an existing planner task. Prefer startLocal/endLocal (YYYY-MM-DDTHH:mm) with the intended IANA timezone; Spectra converts the wall time.", inputSchema: z.object({ title: z.string().min(1).max(500), ...calendarTimeFields, timezone: z.string(), notes: z.string().max(20_000).optional(), allDay: z.boolean().optional(), linkedArtifactIds: z.array(z.string()).max(24).optional() }), concurrencyDomain: "calendar:gesture" });
  define({ ...mutationDefaults, id: "move_calendar_block", title: "Move Calendar block", description: "Move one scheduled work block through the same revision-checked gesture contract as a human drag. Prefer startLocal/endLocal (YYYY-MM-DDTHH:mm) and timezone for wall times; Spectra converts DST rules. Never guess UTC offsets.", inputSchema: z.object({ itemId: z.string(), ...calendarTimeFields, timezone: z.string().optional(), expectedRevision: z.number() }), concurrencyDomain: "calendar:gesture" });
  define({ ...mutationDefaults, id: "resize_calendar_block", title: "Resize Calendar block", description: "Resize one scheduled work block without mutating its task or official deadline.", inputSchema: z.object({ itemId: z.string(), endAt: z.number().optional(), endLocal: z.string().optional(), timezone: z.string().optional(), disambiguation: z.enum(["earlier", "later"]).optional(), expectedRevision: z.number() }), concurrencyDomain: "calendar:gesture" });


  const appActionDefaults = {
    ...mutationDefaults,
    capability: "operate_application",
    concurrencyDomain: "application_command",
  };

  define({ ...appActionDefaults, id: "navigate_spectra", title: "Navigate Spectra", description: "Request a registered Spectra route or work target. The user's Follow AI preference controls whether this request changes their viewport.", inputSchema: z.object({ destination: z.enum(["library", "calendar", "settings", "workspace", "artifact"]), targetId: z.string().optional() }), risk: "low", approval: "never", authorityTarget: "navigation" });
  define({ ...appActionDefaults, id: "add_comment", title: "Add comment", description: "Add a durable, visibly AI-attributed comment or reply through the artifact comment system. Read the target artifact first and use a precise semantic region id from that content; use work:root only for a comment about the whole artifact. Set parentCommentId only when replying to an existing thread. Do not invent a quoted excerpt.", inputSchema: z.object({ artifactId: z.string().min(1), body: z.string().trim().min(1).max(20_000), anchor: z.object({ regionId: z.string().trim().min(1).max(240), fallbackExcerpt: z.string().max(500).optional() }), parentCommentId: z.string().optional() }), authorityTarget: "content" });
  define({ ...appActionDefaults, id: "setup_bridge", title: "Prepare Bridge setup", description: "Open the exact Bridge settings handoff for pairing, folder selection, or a retry. The user still completes pairing, folder grants, and any write-enabling consent.", inputSchema: z.object({ action: z.enum(["pair", "select-location", "retry-connection", "retry-folder"]), grantId: z.string().optional() }), risk: "low", approval: "never", authorityTarget: "navigation" });
  define({ ...appActionDefaults, id: "organize_library", title: "Organize Library", description: "Create, rename, move, or link Library nodes through the canonical organization operation path.", inputSchema: z.object({ action: z.enum(["create_folder", "rename", "move", "link"]), targetIds: z.array(z.string()).max(100).default([]), destinationId: z.string().optional(), name: z.string().trim().min(1).max(200).optional() }).superRefine((value, ctx) => {
    if (value.action === "create_folder" && !value.name) ctx.addIssue({ code: "custom", path: ["name"], message: "A folder name is required." });
    if (value.action !== "create_folder" && value.targetIds.length === 0) ctx.addIssue({ code: "custom", path: ["targetIds"], message: "At least one target is required." });
    if ((value.action === "move" || value.action === "link") && !value.destinationId) ctx.addIssue({ code: "custom", path: ["destinationId"], message: "A destination is required." });
  }), authorityTarget: "tree" });
  define({ ...appActionDefaults, id: "delete_library_items", title: "Delete Library items", description: "Delete Library items only after explicit approval and recoverability checks.", inputSchema: z.object({ targetIds: z.array(z.string()).min(1).max(100) }), risk: "high", approval: "always", authorityTarget: "tree_delete" });
  define({ ...appActionDefaults, id: "change_spectra_settings", title: "Change Spectra settings", description: "Change account-synced Spectra preferences through the human settings path. The patch must use real preference sections such as appearance.density (comfortable or compact), appearance.theme, general.globalCommandBehaviour (search_and_commands, commands_first, or search_first), ai, notifications, privacy, integrations, accessibility, and workbar. The global AI command bar is a fixed bottom dock; do not invent a top/bottom command-bar position or unsupported keys. If the user's request cannot be expressed by these settings, ask a short clarification or navigate them to Settings instead of claiming an unsupported change.", inputSchema: z.object({ patch: preferenceLayerValuesSchema }), risk: "medium", approval: "always", authorityTarget: "settings" });
  define({ ...appActionDefaults, id: "change_sync_policy", title: "Change sync policy", description: "Change storage or sync behavior through the N6 policy path. Spectra computes the concrete local-file consequence before approval.", inputSchema: z.object({ targetIds: z.array(z.string()).min(1).max(100), patch: jsonObject }), risk: "high", approval: "always", authorityTarget: "local_file" });
  define({ ...appActionDefaults, id: "write_memory", title: "Write memory", description: "Create or revise permission-bound memory with visible attribution and revision history.", inputSchema: z.object({ action: z.enum(["create", "revise"]), content: z.string().min(1).max(10000), memoryId: z.string().optional() }), authorityTarget: "memory" });
  define({ ...appActionDefaults, id: "change_sharing", title: "Change sharing", description: "Change sharing or permission state only after explicit approval.", inputSchema: z.object({ resourceType: z.enum(["workspace", "artifact", "agent"]), resourceId: z.string(), action: z.enum(["invite", "change_level", "revoke"]), subjectId: z.string().optional(), invitationId: z.string().optional(), grantId: z.string().optional(), level: z.enum(["read", "modify"]).optional() }).superRefine((value, ctx) => {
    if (value.action === "invite" && !value.subjectId) ctx.addIssue({ code: "custom", path: ["subjectId"], message: "An invitee account id is required." });
    if (value.action === "change_level" && (!value.invitationId || !value.level)) ctx.addIssue({ code: "custom", path: ["invitationId"], message: "An accepted invitation and new level are required." });
    if (value.action === "revoke" && !value.grantId) ctx.addIssue({ code: "custom", path: ["grantId"], message: "A grant id is required." });
  }), risk: "high", approval: "always", authorityTarget: "sharing" });
  define({ ...appActionDefaults, id: "trigger_managebac_sync", title: "Sync ManageBac", description: "Refresh permission-bound ManageBac data with visible freshness and capability status.", inputSchema: z.object({ purpose: z.enum(["upcoming_deadlines", "class_resources", "timetable", "classes", "cas"]), force: z.boolean().optional() }), risk: "medium", approval: "policy", authorityTarget: "managebac_sync" });
  define({ ...appActionDefaults, id: "select_managebac_classes", title: "Choose ManageBac classes", description: "Set the account-scoped ManageBac class selection with revision fencing; unselected class details and planning records remain outside the sync scope.", inputSchema: z.object({ recordIds: z.array(z.string().min(1)).max(100), expectedRevision: z.number().int().min(0).optional(), retention: z.enum(["keep_in_spectra", "archive_projection"]).optional() }), risk: "medium", approval: "policy", authorityTarget: "managebac_selection" });
  define({ ...appActionDefaults, id: "import_managebac_resource", title: "Import school resource", description: "Open the selected ManageBac class shelf to import a permissioned resource into Library through the human school flow.", inputSchema: z.object({ sourceRecordId: z.string().min(1), refresh: z.boolean().optional(), requestKey: z.string().min(8).max(240).optional() }), risk: "medium", approval: "policy", authorityTarget: "managebac_resource_import", aiAvailability: "prohibited", prohibitionReason: "AI resource import is unavailable. Open the selected ManageBac class shelf and use Import resource there; the school route verifies provider identity and saves an import receipt." });
  define({ ...appActionDefaults, id: "change_managebac_mapping", title: "Change ManageBac mapping", description: "ManageBac mapping changes use the dedicated human admin flow; AI mapping mutation is deferred until that typed path is exposed.", inputSchema: z.object({ mappingId: z.string(), patch: jsonObject }), risk: "high", approval: "always", authorityTarget: "managebac_mapping", aiAvailability: "prohibited", prohibitionReason: "ManageBac mapping changes are deferred to the dedicated human admin flow." });
  define({ ...appActionDefaults, id: "insert_reference", title: "Insert reference", description: "Insert a reference through the shared work/reference command path.", inputSchema: z.object({ hostWorkId: z.string(), targetWorkId: z.string(), label: z.string().max(160).optional() }), risk: "medium", approval: "policy", authorityTarget: "content" });
  // embedForModel bounds each embed by its contextPolicy.
  define({ ...readDefaults, id: "read_embeds", title: "Read embeds", description: "Read live or pinned embeds and their source identities without mutating the source. Each embed shares only what its context policy allows.", selfBoundedOutputCharacters: 96_000, inputSchema: z.object({ hostWorkId: z.string(), refresh: refreshRead }) });
  /* W9-02's copy is formatting-only here; retain W9-01's shared registry, including resource import.
  define({
    ...appActionDefaults,
    id: "navigate_spectra",
    title: "Navigate Spectra",
    description:
      "Open a registered Spectra route or work target through the same navigation command used by the human interface.",
    inputSchema: z.object({
      destination: z.enum([
        "library",
        "calendar",
        "settings",
        "workspace",
        "artifact",
      ]),
      targetId: z.string().optional(),
    }),
    risk: "low",
    approval: "never",
    authorityTarget: "navigation",
  });
  define({
    ...appActionDefaults,
    id: "setup_bridge",
    title: "Prepare Bridge setup",
    description:
      "Open the exact Bridge settings handoff for pairing, folder selection, or a retry. The user still completes pairing, folder grants, and any write-enabling consent.",
    inputSchema: z.object({
      action: z.enum([
        "pair",
        "select-location",
        "retry-connection",
        "retry-folder",
      ]),
      grantId: z.string().optional(),
    }),
    risk: "low",
    approval: "never",
    authorityTarget: "navigation",
  });
  define({
    ...appActionDefaults,
    id: "organize_library",
    title: "Organize Library",
    description:
      "Create, rename, move, or link Library nodes through the canonical organization operation path.",
    inputSchema: z
      .object({
        action: z.enum(["create_folder", "rename", "move", "link"]),
        targetIds: z.array(z.string()).max(100).default([]),
        destinationId: z.string().optional(),
        name: z.string().trim().min(1).max(200).optional(),
      })
      .superRefine((value, ctx) => {
        if (value.action === "create_folder" && !value.name)
          ctx.addIssue({
            code: "custom",
            path: ["name"],
            message: "A folder name is required.",
          });
        if (value.action !== "create_folder" && value.targetIds.length === 0)
          ctx.addIssue({
            code: "custom",
            path: ["targetIds"],
            message: "At least one target is required.",
          });
        if (
          (value.action === "move" || value.action === "link") &&
          !value.destinationId
        )
          ctx.addIssue({
            code: "custom",
            path: ["destinationId"],
            message: "A destination is required.",
          });
      }),
    authorityTarget: "tree",
  });
  define({
    ...appActionDefaults,
    id: "delete_library_items",
    title: "Delete Library items",
    description:
      "Delete Library items only after explicit approval and recoverability checks.",
    inputSchema: z.object({ targetIds: z.array(z.string()).min(1).max(100) }),
    risk: "high",
    approval: "always",
    authorityTarget: "tree_delete",
  });
  define({
    ...appActionDefaults,
    id: "change_spectra_settings",
    title: "Change Spectra settings",
    description:
      "Change account-synced Spectra preferences through the human settings path. The patch must use real preference sections such as appearance.density (comfortable or compact), appearance.theme, general.globalCommandBehaviour (search_and_commands, commands_first, or search_first), ai, notifications, privacy, integrations, accessibility, and workbar. The global AI command bar is a fixed bottom dock; do not invent a top/bottom command-bar position or unsupported keys. If the user's request cannot be expressed by these settings, ask a short clarification or navigate them to Settings instead of claiming an unsupported change.",
    inputSchema: z.object({ patch: preferenceLayerValuesSchema }),
    risk: "medium",
    approval: "always",
    authorityTarget: "settings",
  });
  define({
    ...appActionDefaults,
    id: "change_sync_policy",
    title: "Change sync policy",
    description:
      "Change storage or sync behavior through the N6 policy path. Spectra computes the concrete local-file consequence before approval.",
    inputSchema: z.object({
      targetIds: z.array(z.string()).min(1).max(100),
      patch: jsonObject,
    }),
    risk: "high",
    approval: "always",
    authorityTarget: "local_file",
  });
  define({
    ...appActionDefaults,
    id: "write_memory",
    title: "Write memory",
    description:
      "Create or revise permission-bound memory with visible attribution and revision history.",
    inputSchema: z.object({
      action: z.enum(["create", "revise"]),
      content: z.string().min(1).max(10000),
      memoryId: z.string().optional(),
    }),
    authorityTarget: "memory",
  });
  define({
    ...appActionDefaults,
    id: "change_sharing",
    title: "Change sharing",
    description:
      "Change sharing or permission state only after explicit approval.",
    inputSchema: z
      .object({
        resourceType: z.enum(["workspace", "artifact", "agent"]),
        resourceId: z.string(),
        action: z.enum(["invite", "change_level", "revoke"]),
        subjectId: z.string().optional(),
        invitationId: z.string().optional(),
        grantId: z.string().optional(),
        level: z.enum(["read", "modify"]).optional(),
      })
      .superRefine((value, ctx) => {
        if (value.action === "invite" && !value.subjectId)
          ctx.addIssue({
            code: "custom",
            path: ["subjectId"],
            message: "An invitee account id is required.",
          });
        if (
          value.action === "change_level" &&
          (!value.invitationId || !value.level)
        )
          ctx.addIssue({
            code: "custom",
            path: ["invitationId"],
            message: "An accepted invitation and new level are required.",
          });
        if (value.action === "revoke" && !value.grantId)
          ctx.addIssue({
            code: "custom",
            path: ["grantId"],
            message: "A grant id is required.",
          });
      }),
    risk: "high",
    approval: "always",
    authorityTarget: "sharing",
  });
  define({
    ...appActionDefaults,
    id: "trigger_managebac_sync",
    title: "Sync ManageBac",
    description:
      "Refresh permission-bound ManageBac data with visible freshness and capability status.",
    inputSchema: z.object({
      purpose: z.enum([
        "upcoming_deadlines",
        "class_resources",
        "timetable",
        "classes",
        "cas",
      ]),
      force: z.boolean().optional(),
    }),
    risk: "medium",
    approval: "policy",
    authorityTarget: "managebac_sync",
  });
  define({
    ...appActionDefaults,
    id: "select_managebac_classes",
    title: "Choose ManageBac classes",
    description:
      "Set the account-scoped ManageBac class selection with revision fencing; unselected class details and planning records remain outside the sync scope.",
    inputSchema: z.object({
      recordIds: z.array(z.string().min(1)).max(100),
      expectedRevision: z.number().int().min(0).optional(),
      retention: z.enum(["keep_in_spectra", "archive_projection"]).optional(),
    }),
    risk: "medium",
    approval: "policy",
    authorityTarget: "managebac_selection",
  });
  define({
    ...appActionDefaults,
    id: "change_managebac_mapping",
    title: "Change ManageBac mapping",
    description:
      "ManageBac mapping changes use the dedicated human admin flow; AI mapping mutation is deferred until that typed path is exposed.",
    inputSchema: z.object({ mappingId: z.string(), patch: jsonObject }),
    risk: "high",
    approval: "always",
    authorityTarget: "managebac_mapping",
    aiAvailability: "prohibited",
    prohibitionReason:
      "ManageBac mapping changes are deferred to the dedicated human admin flow.",
  });
  define({
    ...appActionDefaults,
    id: "insert_reference",
    title: "Insert reference",
    description:
      "Insert a reference through the shared work/reference command path.",
    inputSchema: z.object({
      hostWorkId: z.string(),
      targetWorkId: z.string(),
      label: z.string().max(160).optional(),
    }),
    risk: "medium",
    approval: "policy",
    authorityTarget: "content",
  });
  define({
    ...readDefaults,
    id: "read_embeds",
    title: "Read embeds",
    description:
      "Read live or pinned embeds and their source identities without mutating the source.",
    inputSchema: z.object({ hostWorkId: z.string(), refresh: refreshRead }),
  });
  */
  for (const [id, title, reason] of [
    [
      "pair_bridge",
      "Pair Spectra Bridge",
      "Bridge pairing and revocation are never AI-performable.",
    ],
    [
      "change_credentials",
      "Change credentials",
      "Credential changes are never AI-performable.",
    ],
    [
      "change_ai_authority_mode",
      "Change AI authority mode",
      "AI cannot change its own authority mode.",
    ],
    [
      "delete_account",
      "Delete account",
      "Account deletion is never AI-performable.",
    ],
  ] as const)
    define({
      ...appActionDefaults,
      id,
      title,
      description: reason,
      inputSchema: jsonObject,
      risk: "high",
      approval: "always",
      aiAvailability: "prohibited",
      prohibitionReason: reason,
    });
  define({
    ...appActionDefaults,
    id: "connect_future_provider",
    title: "Connect future provider",
    description:
      "Provider adapters are not available in this release; no connection is silently attempted.",
    inputSchema: jsonObject,
    risk: "high",
    approval: "always",
    aiAvailability: "prohibited",
    prohibitionReason:
      "Future provider connections are not available in this release.",
  });

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
  const choiceOptionSchema = z.object({
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240).nullable().optional(),
  });
  define({
    ...inputDefaults,
    id: "ask_user_choice",
    title: "Ask user to choose",
    description:
      "Pause safely and ask one bounded question when two or more valid choices would materially change the result.",
    inputSchema: z.object({
      question: z.string().trim().min(1).max(500),
      options: z.array(choiceOptionSchema).min(2).max(6),
    }),
  });
  define({
    ...inputDefaults,
    id: "request_context_target",
    title: "Ask which work to use",
    description:
      "Pause safely when multiple permissioned work items could be the mutation target; provide only evidence-backed candidates and never guess.",
    inputSchema: z.object({
      question: z.string().trim().min(1).max(500),
      candidates: z
        .array(
          z.object({
            id: z.string().min(1),
            title: z.string().trim().min(1).max(80),
            type: z.string().trim().max(80).nullable().optional(),
            summary: z.string().trim().max(180).nullable().optional(),
            workspaceTitle: z.string().trim().max(80).nullable().optional(),
          }),
        )
        .min(2)
        .max(6),
    }),
  });
  for (const id of APPLICATION_INPUT_TOOL_IDS.filter(
    (id) => id !== "ask_user_choice" && id !== "request_context_target",
  ))
    define({
      ...inputDefaults,
      id,
      title: id
        .split("_")
        .map((word) => word[0]!.toUpperCase() + word.slice(1))
        .join(" "),
      description:
        "Pause this recoverable run for the smallest necessary user input, then resume the same run.",
      inputSchema: jsonObject,
    });
}

registerApplicationTools();

export const APPLICATION_AGENT_TOOL_IDS = [
  "search_objects", "search_library", "read_artifact", "read_workspace", "read_thread", "retrieve_memory", "get_school_data", "read_calendar", "read_embeds", "schedule_calendar_task", "create_calendar_personal_event", "move_calendar_block", "resize_calendar_block", "web_search", "navigate_spectra", "setup_bridge", "organize_library", "delete_library_items", "change_spectra_settings", "change_sync_policy", "write_memory", "change_sharing", "trigger_managebac_sync", "select_managebac_classes", "import_managebac_resource", "change_managebac_mapping", "insert_reference", "add_comment", "pair_bridge", "change_credentials", "change_ai_authority_mode", "delete_account", "connect_future_provider", "ask_user_choice", "request_context_target", "propose_operation", "submit_plan",
] as const;
