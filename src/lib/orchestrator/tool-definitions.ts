import type { OpenRouterToolDefinition } from "@/lib/openrouter";
import type { AiToolName, AssignmentLevel } from "@/types";
import type { StudyMode } from "@/lib/contracts/studyModes";

const TOOL_DEFINITIONS: Record<AiToolName, OpenRouterToolDefinition> = {
  inspect_runtime_context: {
    type: "function",
    function: {
      name: "inspect_runtime_context",
      description: "Inspect the current runtime surface, focused entities, revision metadata, and compact workspace/artifact context before taking action.",
      parameters: {
        type: "object",
        properties: {
          includeArtifacts: { type: "boolean" },
          includePlanner: { type: "boolean" },
          includeThreads: { type: "boolean" },
          focusArtifactId: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  search_skills: {
    type: "function",
    function: {
      name: "search_skills",
      description: "Search the available runtime skill packs and return the smallest relevant set for the current request.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          intent: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  load_skill: {
    type: "function",
    function: {
      name: "load_skill",
      description: "Load one runtime skill pack on demand so the model can act with narrower, task-specific guidance.",
      parameters: {
        type: "object",
        properties: {
          skillId: { type: "string" },
        },
        required: ["skillId"],
        additionalProperties: false,
      },
    },
  },
  propose_actions: {
    type: "function",
    function: {
      name: "propose_actions",
      description: "Request a compact structured action plan or patch schema for workspace/artifact mutations before applying changes.",
      parameters: {
        type: "object",
        properties: {
          intent: { type: "string" },
          targetType: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  apply_actions: {
    type: "function",
    function: {
      name: "apply_actions",
      description: "Apply structured patch-based actions to workspace or artifact state with version-safe execution.",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
        required: ["actions"],
        additionalProperties: false,
      },
    },
  },
  get_version_history: {
    type: "function",
    function: {
      name: "get_version_history",
      description: "Fetch compact recent version history or diff metadata for the current artifact or thread target.",
      parameters: {
        type: "object",
        properties: {
          artifactId: { type: "string" },
          chatId: { type: "string" },
          limit: { type: "number", minimum: 1, maximum: 10 },
        },
        additionalProperties: false,
      },
    },
  },
  recall_memory: {
    type: "function",
    function: {
      name: "recall_memory",
      description: "Recall relevant durable memory. Use when the user references prior preferences, facts, decisions, or work from other threads/workstreams.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search memory for." },
          scope: {
            type: "string",
            enum: ["global", "workstream", "cross_workstream"],
            description: "Global memory, current workstream memory, or explicit cross-workstream recall.",
          },
          workstreamId: { type: "string", description: "Optional target workstream when scope is workstream." },
          limit: { type: "number", minimum: 1, maximum: 8 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  save_memory: {
    type: "function",
    function: {
      name: "save_memory",
      description: "Save a durable fact, preference, correction, or important decision for later recall.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
          text: { type: "string" },
          category: {
            type: "string",
            enum: ["identity", "academic", "preference", "topic", "artifact", "correction"],
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          scope: { type: "string", enum: ["global", "workstream"] },
          workstreamId: { type: "string" },
        },
        required: ["key", "text"],
        additionalProperties: false,
      },
    },
  },
  update_memory: {
    type: "function",
    function: {
      name: "update_memory",
      description: "Update a previously recalled memory entry when it is outdated or needs correction.",
      parameters: {
        type: "object",
        properties: {
          memoryKind: { type: "string", enum: ["global", "workstream"] },
          entryId: { type: "string" },
          key: { type: "string" },
          text: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          freshness: { type: "number", minimum: 0, maximum: 1 },
          category: {
            type: "string",
            enum: [
              "identity",
              "academic",
              "preference",
              "topic",
              "artifact",
              "correction",
              "concept",
              "progress",
              "deadline",
              "resource_link",
            ],
          },
        },
        required: ["memoryKind", "entryId"],
        additionalProperties: false,
      },
    },
  },
  dismiss_memory: {
    type: "function",
    function: {
      name: "dismiss_memory",
      description: "Dismiss a memory entry that is no longer relevant.",
      parameters: {
        type: "object",
        properties: {
          memoryKind: { type: "string", enum: ["global", "workstream"] },
          entryId: { type: "string" },
        },
        required: ["memoryKind", "entryId"],
        additionalProperties: false,
      },
    },
  },
  get_workstream_context: {
    type: "function",
    function: {
      name: "get_workstream_context",
      description: "Fetch a concise summary of a workstream: recent threads, document artifacts, planner items, and linked tools.",
      parameters: {
        type: "object",
        properties: {
          workstreamId: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  create_note: {
    type: "function",
    function: {
      name: "create_note",
      description: "Create a note when the conversation produces something worth persisting as a document artifact.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          workstreamId: { type: "string" },
          editorMode: { type: "string", enum: ["standard", "ai_enhanced"] },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  update_planner: {
    type: "function",
    function: {
      name: "update_planner",
      description: "Create or update a planner item when the user discusses tasks, deadlines, milestones, or reminders.",
      parameters: {
        type: "object",
        properties: {
          plannerItemId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          workstreamId: { type: "string" },
          type: { type: "string", enum: ["deadline", "milestone", "goal", "reminder"] },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
          dueAt: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  create_workstream: {
    type: "function",
    function: {
      name: "create_workstream",
      description: "Create a new workspace/workstream when the user explicitly asks for one or confirms a suggestion.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          emoji: { type: "string" },
          color: { type: "string" },
          type: { type: "string", enum: ["subject", "project", "general"] },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  create_widget: {
    type: "function",
    function: {
      name: "create_widget",
      description: "Create a workspace widget instance for a thread, artifact, planner item, utility, or custom output.",
      parameters: {
        type: "object",
        properties: {
          workstreamId: { type: "string" },
          type: { type: "string", enum: ["thread", "document", "planner", "board", "visualization", "media", "reference", "custom", "utility"] },
          itemType: { type: "string", enum: ["thread", "artifact", "planner", "utility", "custom"] },
          title: { type: "string" },
          contentSummary: { type: "string" },
          renderMode: { type: "string" },
          category: { type: "string", enum: ["threads", "documents", "planner", "boards", "visualizations", "media", "references", "custom"] },
          sourceChatId: { type: "string" },
          sourceArtifactId: { type: "string" },
          sourcePlannerItemId: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
        },
        required: ["title", "type"],
        additionalProperties: false,
      },
    },
  },
  surface_result: {
    type: "function",
    function: {
      name: "surface_result",
      description: "Create a workspace command/result record so the UI can show a command/result card without defaulting to a thread.",
      parameters: {
        type: "object",
        properties: {
          workstreamId: { type: "string" },
          intent: { type: "string", enum: ["note", "planner", "thread", "result", "widget"] },
          status: { type: "string", enum: ["processing", "completed", "dismissed"] },
          title: { type: "string" },
          summary: { type: "string" },
          detail: { type: "string" },
          variant: { type: "string", enum: ["summary", "answer", "artifact", "planner", "thread"] },
          targetKind: { type: "string", enum: ["artifact", "plannerItem", "chat", "workspaceItem", "result"] },
          targetId: { type: "string" },
          metadata: { type: "object", additionalProperties: true },
        },
        required: ["title", "summary"],
        additionalProperties: false,
      },
    },
  },
  update_widget: {
    type: "function",
    function: {
      name: "update_widget",
      description: "Update a workspace widget's layout or metadata.",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "string" },
          title: { type: "string" },
          contentSummary: { type: "string" },
          renderMode: { type: "string" },
          category: { type: "string", enum: ["threads", "documents", "planner", "boards", "visualizations", "media", "references", "custom"] },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
          zIndex: { type: "number" },
          hidden: { type: "boolean" },
          collapsed: { type: "boolean" },
          pinned: { type: "boolean" },
        },
        required: ["itemId"],
        additionalProperties: false,
      },
    },
  },
  move_widget: {
    type: "function",
    function: {
      name: "move_widget",
      description: "Move a widget into another workstream, optionally setting a new position.",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "string" },
          workstreamId: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["itemId", "workstreamId"],
        additionalProperties: false,
      },
    },
  },
  attach_items_to_workstream: {
    type: "function",
    function: {
      name: "attach_items_to_workstream",
      description: "Attach existing chats, artifacts, or planner items to a workstream by creating widget instances for them.",
      parameters: {
        type: "object",
        properties: {
          workstreamId: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                itemType: { type: "string" },
                sourceChatId: { type: "string" },
                sourceArtifactId: { type: "string" },
                sourcePlannerItemId: { type: "string" },
                title: { type: "string" },
                contentSummary: { type: "string" },
                renderMode: { type: "string" },
                category: { type: "string" },
              },
              additionalProperties: false,
            },
          },
        },
        required: ["workstreamId", "items"],
        additionalProperties: false,
      },
    },
  },
  list_merge_candidates: {
    type: "function",
    function: {
      name: "list_merge_candidates",
      description: "List chats, artifacts, and planner items that could be attached to a workstream or new workspace.",
      parameters: {
        type: "object",
        properties: {
          workstreamId: { type: "string" },
          topic: { type: "string" },
          limit: { type: "number", minimum: 1, maximum: 20 },
        },
        additionalProperties: false,
      },
    },
  },
  update_workstream_layout: {
    type: "function",
    function: {
      name: "update_workstream_layout",
      description: "Bulk-update widget positions inside one workstream, usually after an AI reorganization.",
      parameters: {
        type: "object",
        properties: {
          workstreamId: { type: "string" },
          widgets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                itemId: { type: "string" },
                x: { type: "number" },
                y: { type: "number" },
                width: { type: "number" },
                height: { type: "number" },
                zIndex: { type: "number" },
              },
              required: ["itemId", "x", "y"],
              additionalProperties: false,
            },
          },
        },
        required: ["workstreamId", "widgets"],
        additionalProperties: false,
      },
    },
  },
  suggest_workspace_from_topic: {
    type: "function",
    function: {
      name: "suggest_workspace_from_topic",
      description: "Score whether a topic has enough repeated evidence to deserve its own workspace and return merge candidates.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string" },
          limit: { type: "number", minimum: 1, maximum: 20 },
        },
        required: ["topic"],
        additionalProperties: false,
      },
    },
  },
  fork_thread: {
    type: "function",
    function: {
      name: "fork_thread",
      description: "Create a new thread when the task needs isolation, a new topic, or a fresh context window.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
          title: { type: "string" },
          setupMessage: { type: "string" },
          workstreamId: { type: "string" },
          preferredModel: { type: "string" },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
  search_web: {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web when current information is required.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          strategy: { type: "string", enum: ["search", "search_extract", "extract_url", "crawl", "research"] },
          targetUrl: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  switch_mode: {
    type: "function",
    function: {
      name: "switch_mode",
      description: "Switch the response mode when a research, tutor, quiz, or similar mode is better suited for the next pass.",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["research", "tutor", "quiz", "exam", "explain", "general", "draft_coach", "document", "flashcard"],
          },
          reason: { type: "string" },
        },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  },
};

export function getAllowedAiToolNames(assignmentLevel: AssignmentLevel): AiToolName[] {
  if (assignmentLevel === "L0") return [];
  if (assignmentLevel === "L1") return ["inspect_runtime_context", "recall_memory"];
  if (assignmentLevel === "L2") return ["inspect_runtime_context", "search_skills", "recall_memory", "save_memory", "search_web"];
  if (assignmentLevel === "L3") {
    return [
      "inspect_runtime_context",
      "search_skills",
      "load_skill",
      "propose_actions",
      "apply_actions",
      "get_version_history",
      "recall_memory",
      "save_memory",
      "update_memory",
      "dismiss_memory",
      "create_note",
      "update_planner",
      "surface_result",
      "search_web",
      "switch_mode",
    ];
  }
  return [
    "inspect_runtime_context",
    "search_skills",
    "load_skill",
    "propose_actions",
    "apply_actions",
    "get_version_history",
    "recall_memory",
    "save_memory",
    "update_memory",
    "dismiss_memory",
    "get_workstream_context",
    "create_note",
    "update_planner",
    "create_workstream",
    "create_widget",
    "surface_result",
    "update_widget",
    "move_widget",
    "attach_items_to_workstream",
    "list_merge_candidates",
    "update_workstream_layout",
    "suggest_workspace_from_topic",
    "fork_thread",
    "search_web",
    "switch_mode",
  ];
}

export type CapabilityContractParams = {
  toolNames: AiToolName[];
  recursiveExecutionAllowed: boolean;
  allowConversationForking: boolean;
  availableSkills?: string[];
  availableSurfaces?: string[];
  activeMode?: StudyMode;
  assignmentLevel?: AssignmentLevel;
  allowedToolBundles?: string[];
  retrievalScopes?: string[];
  availableAgents?: Array<{ id: string; name: string; reason?: string }>;
  activeAgent?: { id: string; name: string } | null;
  sourceGrounding?: {
    attachmentIds?: string[];
    attachmentRequirement?: "required" | "preferred" | "not_applicable";
    sourceKinds?: string[];
  };
};

export function buildCapabilityContract(params: CapabilityContractParams) {
  const surfaces = params.availableSurfaces?.length ? params.availableSurfaces.join(", ") : "chat";
  const skills = params.availableSkills?.length ? params.availableSkills.join(", ") : "none";
  const tools = params.toolNames.length ? params.toolNames.join(", ") : "none";
  const bundles = params.allowedToolBundles?.length ? params.allowedToolBundles.join(", ") : "none";
  const retrievalScopes = params.retrievalScopes?.length ? params.retrievalScopes.join(", ") : "none";
  const activeAgent = params.activeAgent?.name ? `${params.activeAgent.name} (${params.activeAgent.id})` : "none";
  const candidateAgents = params.availableAgents?.length
    ? params.availableAgents.slice(0, 5).map((agent) => `${agent.name} (${agent.id})${agent.reason ? ` — ${agent.reason}` : ""}`).join("; ")
    : "none";
  const attachmentIds = params.sourceGrounding?.attachmentIds?.length ? params.sourceGrounding.attachmentIds.join(", ") : "none";
  const sourceKinds = params.sourceGrounding?.sourceKinds?.length ? params.sourceGrounding.sourceKinds.join(", ") : "none";
  const attachmentRequirement = params.sourceGrounding?.attachmentRequirement ?? "not_applicable";
  return [
    "=== RUNTIME CAPABILITY CONTRACT ===",
    `Active mode: ${params.activeMode ?? "general"}.`,
    `Assignment level: ${params.assignmentLevel ?? "L0"}.`,
    `Tool bundles approved by route: ${bundles}.`,
    `Tools available now: ${tools}.`,
    `Skills available now: ${skills}.`,
    `Surfaces available: ${surfaces}.`,
    `Retrieval scopes: ${retrievalScopes}.`,
    `Active agent: ${activeAgent}.`,
    `Agent candidates for this turn: ${candidateAgents}.`,
    `Attachment/source grounding requirement: ${attachmentRequirement}.`,
    `Attachment ids in scope: ${attachmentIds}.`,
    `Grounding source kinds in scope: ${sourceKinds}.`,
    `Recursive execution: ${params.recursiveExecutionAllowed ? "allowed when necessary" : "not allowed"}.`,
    `Thread/workstream fork creation: ${params.allowConversationForking ? "allowed when isolation is clearly beneficial" : "not allowed"}.`,
    "Use only route-approved tools and surfaces. If a capability is not listed here, treat it as unavailable.",
    "Never call tools speculatively; use them only when they improve correctness, grounding, continuity, or persistence.",
    "When attachment grounding is required, stay anchored to the listed attachments and do not generalize beyond supported source evidence.",
    "If retrieval/search results are already provided in prompt context, synthesize from them instead of claiming the capability is missing.",
    "Honor modality constraints and stop once the response contract is satisfied.",
    "=== END RUNTIME CAPABILITY CONTRACT ===",
  ].join("\n");
}

export function getOpenRouterToolsForAssignmentLevel(assignmentLevel: AssignmentLevel) {
  return getAllowedAiToolNames(assignmentLevel).map((name) => TOOL_DEFINITIONS[name]);
}

export function formatToolUsageGuidance(toolNames: AiToolName[]) {
  if (toolNames.length === 0) return "";
  return [
    "=== AI TOOLS ===",
    "Only call tools when they materially improve the answer. Keep tool use sparse and visible.",
    ...toolNames.map((name) => `- ${name}`),
    "If a tool returns no useful result, continue without pretending it succeeded.",
    "=== END AI TOOLS ===",
  ].join("\n");
}
