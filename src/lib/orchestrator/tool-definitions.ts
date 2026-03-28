import type { OpenRouterToolDefinition } from "@/lib/openrouter";
import type { AiToolName, AssignmentLevel } from "@/types";

const TOOL_DEFINITIONS: Record<AiToolName, OpenRouterToolDefinition> = {
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
      description: "Fetch a concise summary of a workstream: recent threads, notes, planner items, and linked tools.",
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
      description: "Create a note when the conversation produces something worth persisting as a document.",
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
  if (assignmentLevel === "L1") return ["recall_memory"];
  if (assignmentLevel === "L2") return ["recall_memory", "save_memory", "search_web"];
  if (assignmentLevel === "L3") {
    return [
      "recall_memory",
      "save_memory",
      "update_memory",
      "dismiss_memory",
      "create_note",
      "update_planner",
      "search_web",
      "switch_mode",
    ];
  }
  return [
    "recall_memory",
    "save_memory",
    "update_memory",
    "dismiss_memory",
    "get_workstream_context",
    "create_note",
    "update_planner",
    "fork_thread",
    "search_web",
    "switch_mode",
  ];
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
