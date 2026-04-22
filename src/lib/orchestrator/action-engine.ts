import { convexMutation, convexQuery } from "@/lib/convex-server";
import type { StudyMode } from "@/types";

const ACTION_TYPES = [
  "create_artifact",
  "patch_artifact",
  "replace_range",
  "insert_block",
  "delete_block",
  "rename_artifact",
  "create_thread",
  "append_thread_message",
  "create_planner_item",
  "update_planner_item",
  "create_widget",
  "update_widget",
  "move_widget",
  "attach_items_to_workstream",
  "update_workstream_layout",
  "fork_thread",
  "restore_artifact_version",
  "create_child_artifact",
  "generate_flashcards_from_artifact",
  "generate_quiz_from_artifact",
] as const;

type ActionType = (typeof ACTION_TYPES)[number];

type ToolCallContext = {
  actorClerkId: string;
  chatId?: string;
  activeWorkstreamId?: string;
  artifactId?: string;
  mode: StudyMode;
};

type ActionRecord = Record<string, unknown>;

type ArtifactDoc = {
  _id: string;
  title: string;
  workstreamId?: string;
  updatedAt: number;
  contentPlaintext?: string;
};

type WorkspaceResultRecord = { resultId: string };
type ArtifactEditResult = { success: boolean; versionId?: string };
type CreateChatResult = { chatId: string };
type AppendMessageResult = { messageId: string };
type PlannerCreateResult = { plannerItemId: string };
type WidgetMutationResult = { itemId: string; mutationId?: string };
type GenericMutationResult = { success: boolean; mutationId?: string; createdItemIds?: string[] };
type FlashcardDeckResult = { deckId: string; cardCount: number };
type RestoreArtifactResult = { success: boolean };

type ActionExecutionSuccess = {
  ok: true;
  index: number;
  type: ActionType;
  targetKind?: string;
  targetId?: string;
  summary: string;
  mutation: Record<string, unknown>;
  result: Record<string, unknown>;
  version?: Record<string, unknown>;
  ui?: Record<string, unknown>;
};

type ActionExecutionFailure = {
  ok: false;
  index: number;
  type: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type ActionExecutionResult = ActionExecutionSuccess | ActionExecutionFailure;

export type ActionEngineRunResult = {
  ok: boolean;
  summary: string;
  appliedCount: number;
  failedCount: number;
  results: ActionExecutionResult[];
  resultIds: string[];
  targetIds: Array<{ type: string; id: string }>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown, field: string, options?: { max?: number; allowEmpty?: boolean }) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!options?.allowEmpty && trimmed.length === 0) {
    throw new Error(`${field} is required`);
  }
  return trimmed.slice(0, options?.max ?? trimmed.length);
}

function asOptionalTrimmedString(value: unknown, field: string, options?: { max?: number; allowEmpty?: boolean }) {
  if (value === undefined || value === null) return undefined;
  return asTrimmedString(value, field, options);
}

function asNumber(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a number`);
  }
  return value;
}

function asBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function asObject(value: unknown, field: string) {
  if (!isObject(value)) throw new Error(`${field} must be an object`);
  return value;
}

function assertActionType(value: unknown): ActionType {
  const type = asTrimmedString(value, "action.type", { max: 80 });
  if (!(ACTION_TYPES as readonly string[]).includes(type)) {
    throw new Error(`Unsupported action type: ${type}`);
  }
  return type as ActionType;
}

function artifactDocumentFromPlaintext(text: string) {
  return {
    type: "doc",
    content: text
      ? [{ type: "paragraph", content: [{ type: "text", text }] }]
      : [],
  };
}

function actionFailure(index: number, type: string, message: string, action?: ActionRecord): ActionExecutionFailure {
  return {
    ok: false,
    index,
    type,
    code: "ACTION_EXECUTION_FAILED",
    message,
    details: action ? { action } : undefined,
  };
}

function applyArtifactTextMutation(currentText: string, action: { type: ActionType } & Record<string, unknown>) {
  if (action.type === "patch_artifact") {
    const next = asTrimmedString(action.content, "content", { allowEmpty: true });
    return { nextText: next, operations: [{ op: "set_text", value: next }] };
  }
  if (action.type === "replace_range") {
    const start = asNumber(action.start, "start");
    const end = asNumber(action.end, "end");
    const replacement = typeof action.replacement === "string" ? action.replacement : "";
    if (start < 0 || end < start || end > currentText.length) {
      throw new Error("replace_range start/end are out of bounds");
    }
    return {
      nextText: `${currentText.slice(0, start)}${replacement}${currentText.slice(end)}`,
      operations: [{ op: "replace_range", start, end, replacement }],
    };
  }
  if (action.type === "insert_block") {
    const index = asNumber(action.index, "index");
    const block = asTrimmedString(action.block, "block", { allowEmpty: true });
    const lines = currentText.length > 0 ? currentText.split("\n") : [];
    if (index < 0 || index > lines.length) {
      throw new Error("insert_block index is out of bounds");
    }
    lines.splice(index, 0, block);
    return {
      nextText: lines.join("\n"),
      operations: [{ op: "insert_block", index, block }],
    };
  }
  if (action.type === "delete_block") {
    const startLine = asNumber(action.startLine, "startLine");
    const endLine = asNumber(action.endLine, "endLine");
    const lines = currentText.split("\n");
    if (startLine < 0 || endLine < startLine || endLine >= lines.length) {
      throw new Error("delete_block startLine/endLine are out of bounds");
    }
    lines.splice(startLine, endLine - startLine + 1);
    return {
      nextText: lines.join("\n"),
      operations: [{ op: "delete_block", startLine, endLine }],
    };
  }
  throw new Error(`Unsupported artifact mutation action: ${action.type}`);
}

async function createWorkspaceResult(
  context: ToolCallContext,
  params: {
    workstreamId?: string;
    title: string;
    summary: string;
    targetKind?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
    variant?: "summary" | "answer" | "artifact" | "planner" | "thread";
    intent?: "note" | "planner" | "thread" | "result" | "widget";
    status?: "processing" | "completed" | "dismissed";
    detail?: string;
  },
): Promise<WorkspaceResultRecord | undefined> {
  const workstreamId = params.workstreamId ?? context.activeWorkstreamId;
  if (!workstreamId) return undefined;
  return await (convexMutation("workspaceCommandResults:create", {
    actorClerkId: context.actorClerkId,
    workstreamId,
    sourceChatId: context.chatId,
    intent: params.intent ?? "result",
    status: params.status ?? "completed",
    title: params.title,
    summary: params.summary,
    detail: params.detail,
    variant: params.variant,
    targetKind: params.targetKind as "artifact" | "plannerItem" | "chat" | "workspaceItem" | "result" | undefined,
    targetId: params.targetId,
    metadata: params.metadata,
  }) as Promise<WorkspaceResultRecord>);
}

async function loadArtifact(context: ToolCallContext, artifactId: string): Promise<ArtifactDoc> {
  return await convexQuery("artifacts:get", {
    actorClerkId: context.actorClerkId,
    artifactId,
  }) as ArtifactDoc;
}

async function executeSingleAction(context: ToolCallContext, action: ActionRecord, index: number): Promise<ActionExecutionResult> {
  try {
    const type = assertActionType(action.type);

    if (type === "create_artifact" || type === "create_child_artifact") {
      let workstreamId = asOptionalTrimmedString(action.workstreamId, "workstreamId") ?? context.activeWorkstreamId;
      const parentArtifactId = type === "create_child_artifact"
        ? asOptionalTrimmedString(action.parentArtifactId ?? context.artifactId, "parentArtifactId")
        : undefined;
      if (!workstreamId && parentArtifactId) {
        const parentArtifact = await loadArtifact(context, parentArtifactId);
        workstreamId = parentArtifact.workstreamId;
      }
      const title = asTrimmedString(action.title, "title", { max: 160 });
      const artifactType = asOptionalTrimmedString(action.artifactType ?? action.kind, "artifactType", { max: 60 }) ?? "document";
      const text = asOptionalTrimmedString(action.contentPlaintext ?? action.content, "content", { max: 120000, allowEmpty: true }) ?? "";
      const artifactId = await convexMutation("artifacts:create", {
        actorClerkId: context.actorClerkId,
        type: artifactType,
        title,
        content: artifactDocumentFromPlaintext(text),
        contentPlaintext: text,
        workstreamId,
        editorMode: "agentic",
        sourceType: "ai_generated",
        linkedChatId: context.chatId,
      }) as string;
      const workspaceResult = await createWorkspaceResult(context, {
        workstreamId,
        title: `Created artifact: ${title}`,
        summary: parentArtifactId ? `Created child artifact from ${parentArtifactId}.` : `Created artifact ${title}.`,
        targetKind: "artifact",
        targetId: artifactId,
        variant: "artifact",
        intent: "note",
        metadata: { actionType: type, artifactType, parentArtifactId },
      });
      return {
        ok: true,
        index,
        type,
        targetKind: "artifact",
        targetId: artifactId,
        summary: `Created artifact ${title}.`,
        mutation: { type, workstreamId, artifactType },
        result: { artifactId, workspaceResultId: workspaceResult?.resultId, title, artifactType },
        version: { created: true },
        ui: { resultBar: true, renderInstruction: { kind: artifactType === "visualization" ? "visual" : artifactType === "code" ? "code" : "document", title, artifactId } },
      };
    }

    if (type === "rename_artifact") {
      const artifactId = asOptionalTrimmedString(action.artifactId ?? context.artifactId, "artifactId");
      if (!artifactId) throw new Error("artifactId is required");
      const title = asTrimmedString(action.title, "title", { max: 160 });
      await convexMutation("artifacts:update", {
        actorClerkId: context.actorClerkId,
        artifactId,
        title,
        authorType: "agent",
        description: "Renamed artifact via action engine",
        sourceChatId: context.chatId,
      });
      const workspaceResult = await createWorkspaceResult(context, {
        title: "Renamed artifact",
        summary: `Renamed artifact to ${title}.`,
        targetKind: "artifact",
        targetId: artifactId,
        variant: "artifact",
        metadata: { actionType: type, title },
      });
      return {
        ok: true,
        index,
        type,
        targetKind: "artifact",
        targetId: artifactId,
        summary: `Renamed artifact to ${title}.`,
        mutation: { type },
        result: { artifactId, workspaceResultId: workspaceResult?.resultId },
      };
    }

    if (["patch_artifact", "replace_range", "insert_block", "delete_block"].includes(type)) {
      const artifactId = asOptionalTrimmedString(action.artifactId ?? context.artifactId, "artifactId");
      if (!artifactId) throw new Error("artifactId is required");
      const artifact = await loadArtifact(context, artifactId);
      const expectedUpdatedAt = action.expectedUpdatedAt;
      if (typeof expectedUpdatedAt === "number" && artifact.updatedAt !== expectedUpdatedAt) {
        throw new Error(`Artifact version mismatch: expected updatedAt ${expectedUpdatedAt}, received ${artifact.updatedAt}`);
      }
      const currentText = artifact.contentPlaintext ?? "";
      const patch = applyArtifactTextMutation(currentText, { ...action, type });
      const editResult = await convexMutation("artifacts:applyAiEdit", {
        actorClerkId: context.actorClerkId,
        artifactId,
        content: artifactDocumentFromPlaintext(patch.nextText),
        contentPlaintext: patch.nextText,
        instruction: asOptionalTrimmedString(action.instruction, "instruction", { max: 500 }) ?? `Applied ${type}`,
        operations: patch.operations,
        summary: asOptionalTrimmedString(action.summary, "summary", { max: 240 }) ?? `Applied ${type}`,
        sourceChatId: context.chatId,
        lastAiEditId: asOptionalTrimmedString(action.actionId, "actionId", { max: 120 }) ?? `${type}:${index}`,
        pendingDiffs: patch.operations,
      }) as ArtifactEditResult;
      const workspaceResult = await createWorkspaceResult(context, {
        workstreamId: artifact.workstreamId ?? context.activeWorkstreamId,
        title: "Updated artifact",
        summary: `${type} applied to ${artifact.title}.`,
        targetKind: "artifact",
        targetId: artifactId,
        variant: "artifact",
        metadata: {
          actionType: type,
          expectedUpdatedAt: typeof expectedUpdatedAt === "number" ? expectedUpdatedAt : null,
          versionId: editResult.versionId,
          operations: patch.operations,
        },
      });
      return {
        ok: true,
        index,
        type,
        targetKind: "artifact",
        targetId: artifactId,
        summary: `${type} applied to ${artifact.title}.`,
        mutation: { type, operations: patch.operations },
        result: { artifactId, versionId: editResult.versionId, workspaceResultId: workspaceResult?.resultId, contentPreview: patch.nextText.slice(0, 400) },
        version: { created: true, versionId: editResult.versionId, guardedByUpdatedAt: typeof expectedUpdatedAt === "number" },
        ui: { resultBar: true, diff: true, artifactPatch: patch.operations, renderInstruction: { kind: "document", artifactId, title: artifact.title, content: patch.nextText } },
      };
    }

    if (type === "restore_artifact_version") {
      const artifactId = asOptionalTrimmedString(action.artifactId ?? context.artifactId, "artifactId");
      if (!artifactId) throw new Error("artifactId is required");
      const versionId = asTrimmedString(action.versionId, "versionId");
      const restoreResult = await convexMutation("artifacts:restoreVersion", {
        actorClerkId: context.actorClerkId,
        artifactId,
        versionId,
      }) as RestoreArtifactResult;
      const workspaceResult = await createWorkspaceResult(context, {
        title: "Restored artifact version",
        summary: `Restored artifact ${artifactId} to version ${versionId}.`,
        targetKind: "artifact",
        targetId: artifactId,
        variant: "artifact",
        metadata: { actionType: type, versionId },
      });
      return {
        ok: true,
        index,
        type,
        targetKind: "artifact",
        targetId: artifactId,
        summary: `Restored artifact version ${versionId}.`,
        mutation: { type },
        result: { artifactId, restored: restoreResult.success, workspaceResultId: workspaceResult?.resultId, restoredFrom: versionId },
        version: { created: true, restoredFrom: versionId },
        ui: { resultBar: true, diff: true, restoredFrom: versionId },
      };
    }

    if (type === "create_thread" || type === "fork_thread") {
      const workstreamId = asOptionalTrimmedString(action.workstreamId, "workstreamId") ?? context.activeWorkstreamId;
      const title = asOptionalTrimmedString(action.title, "title", { max: 120 }) ?? (type === "fork_thread" ? "Forked thread" : "New thread");
      const reason = asOptionalTrimmedString(action.reason, "reason", { max: 240 }) ?? title;
      const chatResult = await convexMutation("chats:createChat", {
        actorClerkId: context.actorClerkId,
        workstreamId,
        artifactId: asOptionalTrimmedString(action.artifactId ?? context.artifactId, "artifactId"),
        threadType: asOptionalTrimmedString(action.threadType, "threadType", { max: 40 }) as "conversation" | "artifact_edit" | undefined,
        mode: context.mode,
        thinkingLevel: "medium",
        routerMode: "auto",
        usePersonalResources: true,
        title,
        allowExistingThreadReuse: false,
      }) as CreateChatResult;
      const setupMessage = asOptionalTrimmedString(action.setupMessage ?? action.content, "setupMessage", { max: 3000, allowEmpty: true });
      if (setupMessage) {
        await convexMutation("chats:appendMessage", {
          actorClerkId: context.actorClerkId,
          chatId: chatResult.chatId,
          role: "system",
          content: setupMessage,
          mode: context.mode,
          citations: [],
          routeTrace: {
            phases: [],
            toolchain: [type],
            candidateModels: [],
            whyThisResponse: reason,
            warnings: [],
            fallbackUsed: false,
            budgetTier: "normal",
          },
        });
      }
      const workspaceResult = await createWorkspaceResult(context, {
        workstreamId,
        title: type === "fork_thread" ? "Forked thread" : "Created thread",
        summary: `${type === "fork_thread" ? "Forked" : "Created"} thread ${title}.`,
        targetKind: "chat",
        targetId: chatResult.chatId,
        variant: "thread",
        intent: "thread",
        metadata: { actionType: type, reason },
      });
      return {
        ok: true,
        index,
        type,
        targetKind: "chat",
        targetId: chatResult.chatId,
        summary: `${type === "fork_thread" ? "Forked" : "Created"} thread ${title}.`,
        mutation: { type, workstreamId },
        result: { chatId: chatResult.chatId, workspaceResultId: workspaceResult?.resultId },
        ui: { resultBar: true, threadUrl: `/chat?chatId=${chatResult.chatId}` },
      };
    }

    if (type === "append_thread_message") {
      const chatId = asOptionalTrimmedString(action.chatId ?? context.chatId, "chatId");
      if (!chatId) throw new Error("chatId is required");
      const content = asTrimmedString(action.content, "content", { max: 4000, allowEmpty: true });
      const appendResult = await convexMutation("chats:appendMessage", {
        actorClerkId: context.actorClerkId,
        chatId,
        role: "assistant",
        content,
        mode: context.mode,
        citations: [],
        parentMessageId: asOptionalTrimmedString(action.parentMessageId, "parentMessageId"),
        routeTrace: {
          phases: [],
          toolchain: [type],
          candidateModels: [],
          whyThisResponse: "Action engine appended thread message",
          warnings: [],
          fallbackUsed: false,
          budgetTier: "normal",
        },
      }) as AppendMessageResult;
      const workspaceResult = await createWorkspaceResult(context, {
        title: "Updated thread",
        summary: `Appended message to thread ${chatId}.`,
        targetKind: "chat",
        targetId: chatId,
        variant: "thread",
        intent: "thread",
        metadata: { actionType: type, messageId: appendResult.messageId },
      });
      return {
        ok: true,
        index,
        type,
        targetKind: "chat",
        targetId: chatId,
        summary: "Appended thread message.",
        mutation: { type },
        result: { chatId, messageId: appendResult.messageId, workspaceResultId: workspaceResult?.resultId },
        ui: { resultBar: true },
      };
    }

    if (type === "create_planner_item" || type === "update_planner_item") {
      const workstreamId = asOptionalTrimmedString(action.workstreamId, "workstreamId") ?? context.activeWorkstreamId;
      const title = asTrimmedString(action.title, "title", { max: 160 });
      const plannerItemId = type === "update_planner_item"
        ? asOptionalTrimmedString(action.plannerItemId, "plannerItemId")
        : undefined;
      if (type === "update_planner_item" && !plannerItemId) {
        throw new Error("plannerItemId is required");
      }
      const payload = {
        actorClerkId: context.actorClerkId,
        plannerItemId,
        title,
        description: asOptionalTrimmedString(action.description, "description", { max: 1000 }),
        workstreamId,
        type: asOptionalTrimmedString(action.plannerType, "plannerType", { max: 20 }) as "deadline" | "milestone" | "goal" | "reminder" | undefined,
        priority: asOptionalTrimmedString(action.priority, "priority", { max: 20 }) as "low" | "medium" | "high" | undefined,
        status: asOptionalTrimmedString(action.status, "status", { max: 20 }) as "pending" | "in_progress" | "completed" | "cancelled" | undefined,
        dueAt: action.dueAt === undefined ? undefined : asNumber(action.dueAt, "dueAt"),
        sourceType: "ai_suggested" as const,
        sourceChatId: context.chatId,
      };
      const createResult = type === "create_planner_item"
        ? await convexMutation("plannerItems:create", payload) as PlannerCreateResult
        : undefined;
      if (type === "update_planner_item") {
        await convexMutation("plannerItems:update", payload);
      }
      const targetId = plannerItemId ?? createResult?.plannerItemId;
      const workspaceResult = await createWorkspaceResult(context, {
        workstreamId,
        title: type === "update_planner_item" ? "Updated planner item" : "Created planner item",
        summary: `${type === "update_planner_item" ? "Updated" : "Created"} planner item ${title}.`,
        targetKind: "plannerItem",
        targetId,
        variant: "planner",
        intent: "planner",
        metadata: { actionType: type },
      });
      return {
        ok: true,
        index,
        type,
        targetKind: "plannerItem",
        targetId,
        summary: `${type === "update_planner_item" ? "Updated" : "Created"} planner item ${title}.`,
        mutation: { type, workstreamId },
        result: { plannerItemId: targetId, workspaceResultId: workspaceResult?.resultId },
        ui: { resultBar: true },
      };
    }

    if (type === "create_widget") {
      const workstreamId = asOptionalTrimmedString(action.workstreamId, "workstreamId") ?? context.activeWorkstreamId;
      if (!workstreamId) throw new Error("workstreamId is required");
      const title = asTrimmedString(action.title, "title", { max: 160 });
      const widgetResult = await convexMutation("workspaceItems:createWidget", {
        actorClerkId: context.actorClerkId,
        workstreamId,
        title,
        type: asOptionalTrimmedString(action.typeName ?? action.widgetType, "type", { max: 40 }) as "thread" | "document" | "planner" | "board" | "visualization" | "media" | "reference" | "custom" | "utility" | undefined,
        itemType: asOptionalTrimmedString(action.itemType, "itemType", { max: 40 }) as "thread" | "artifact" | "planner" | "utility" | "custom" | undefined,
        renderMode: asOptionalTrimmedString(action.renderMode, "renderMode", { max: 80 }),
        contentSummary: asOptionalTrimmedString(action.contentSummary, "contentSummary", { max: 300 }),
        x: action.x === undefined ? 120 : asNumber(action.x, "x"),
        y: action.y === undefined ? 120 : asNumber(action.y, "y"),
        width: action.width === undefined ? undefined : asNumber(action.width, "width"),
        height: action.height === undefined ? undefined : asNumber(action.height, "height"),
        category: asOptionalTrimmedString(action.category, "category", { max: 40 }),
        sourceChatId: asOptionalTrimmedString(action.sourceChatId, "sourceChatId"),
        sourceArtifactId: asOptionalTrimmedString(action.sourceArtifactId, "sourceArtifactId"),
        sourcePlannerItemId: asOptionalTrimmedString(action.sourcePlannerItemId, "sourcePlannerItemId"),
        provenanceSource: "ai",
        provenanceAction: type,
        mutationSummary: `Action engine created widget ${title}`,
      }) as WidgetMutationResult;
      return {
        ok: true,
        index,
        type,
        targetKind: "workspaceItem",
        targetId: widgetResult.itemId,
        summary: `Created widget ${title}.`,
        mutation: { type, workstreamId },
        result: { itemId: widgetResult.itemId, mutationId: widgetResult.mutationId },
      };
    }

    if (type === "update_widget") {
      const itemId = asTrimmedString(action.itemId, "itemId");
      const result = await convexMutation("workspaceItems:updateWidget", {
        actorClerkId: context.actorClerkId,
        itemId,
        title: asOptionalTrimmedString(action.title, "title", { max: 160 }),
        contentSummary: asOptionalTrimmedString(action.contentSummary, "contentSummary", { max: 300 }),
        renderMode: asOptionalTrimmedString(action.renderMode, "renderMode", { max: 80 }),
        x: action.x === undefined ? undefined : asNumber(action.x, "x"),
        y: action.y === undefined ? undefined : asNumber(action.y, "y"),
        width: action.width === undefined ? undefined : asNumber(action.width, "width"),
        height: action.height === undefined ? undefined : asNumber(action.height, "height"),
        hidden: action.hidden === undefined ? undefined : asBoolean(action.hidden, "hidden"),
        collapsed: action.collapsed === undefined ? undefined : asBoolean(action.collapsed, "collapsed"),
        pinned: action.pinned === undefined ? undefined : asBoolean(action.pinned, "pinned"),
        category: asOptionalTrimmedString(action.category, "category", { max: 40 }),
        zIndex: action.zIndex === undefined ? undefined : asNumber(action.zIndex, "zIndex"),
        provenanceSource: "ai",
        provenanceAction: type,
        mutationSummary: "Action engine updated widget",
      }) as GenericMutationResult;
      return {
        ok: true,
        index,
        type,
        targetKind: "workspaceItem",
        targetId: itemId,
        summary: `Updated widget ${itemId}.`,
        mutation: { type },
        result: { itemId, mutationId: result.mutationId },
      };
    }

    if (type === "move_widget") {
      const itemId = asTrimmedString(action.itemId, "itemId");
      const targetWorkstreamId = asOptionalTrimmedString(action.workstreamId ?? action.targetWorkstreamId, "workstreamId") ?? context.activeWorkstreamId;
      if (!targetWorkstreamId) throw new Error("workstreamId is required");
      const result = await convexMutation("workspaceItems:moveWidget", {
        actorClerkId: context.actorClerkId,
        itemId,
        targetWorkstreamId,
        x: action.x === undefined ? undefined : asNumber(action.x, "x"),
        y: action.y === undefined ? undefined : asNumber(action.y, "y"),
        provenanceSource: "ai",
        mutationSummary: "Action engine moved widget",
      }) as GenericMutationResult;
      return {
        ok: true,
        index,
        type,
        targetKind: "workspaceItem",
        targetId: itemId,
        summary: `Moved widget ${itemId}.`,
        mutation: { type, targetWorkstreamId },
        result: { itemId, mutationId: result.mutationId },
      };
    }

    if (type === "attach_items_to_workstream") {
      const workstreamId = asOptionalTrimmedString(action.workstreamId, "workstreamId") ?? context.activeWorkstreamId;
      if (!workstreamId) throw new Error("workstreamId is required");
      const itemsInput = action.items;
      if (!Array.isArray(itemsInput) || itemsInput.length === 0) throw new Error("items must be a non-empty array");
      const items = itemsInput.map((entry, itemIndex) => {
        const item = asObject(entry, `items[${itemIndex}]`);
        return {
          title: asTrimmedString(item.title, `items[${itemIndex}].title`, { max: 160 }),
          type: asOptionalTrimmedString(item.type, `items[${itemIndex}].type`, { max: 40 }) as "thread" | "document" | "planner" | "board" | "visualization" | "media" | "reference" | "custom" | "utility" | undefined,
          itemType: asOptionalTrimmedString(item.itemType, `items[${itemIndex}].itemType`, { max: 40 }) as "thread" | "artifact" | "planner" | "utility" | "custom" | undefined,
          sourceChatId: asOptionalTrimmedString(item.sourceChatId, `items[${itemIndex}].sourceChatId`),
          sourceArtifactId: asOptionalTrimmedString(item.sourceArtifactId, `items[${itemIndex}].sourceArtifactId`),
          sourcePlannerItemId: asOptionalTrimmedString(item.sourcePlannerItemId, `items[${itemIndex}].sourcePlannerItemId`),
          renderMode: asOptionalTrimmedString(item.renderMode, `items[${itemIndex}].renderMode`, { max: 80 }),
          contentSummary: asOptionalTrimmedString(item.contentSummary, `items[${itemIndex}].contentSummary`, { max: 300 }),
          x: item.x === undefined ? undefined : asNumber(item.x, `items[${itemIndex}].x`),
          y: item.y === undefined ? undefined : asNumber(item.y, `items[${itemIndex}].y`),
          width: item.width === undefined ? undefined : asNumber(item.width, `items[${itemIndex}].width`),
          height: item.height === undefined ? undefined : asNumber(item.height, `items[${itemIndex}].height`),
          category: asOptionalTrimmedString(item.category, `items[${itemIndex}].category`, { max: 40 }),
        };
      });
      const result = await convexMutation("workspaceItems:attachItemsToWorkstream", {
        actorClerkId: context.actorClerkId,
        workstreamId,
        items,
        provenanceSource: "ai",
        mutationSummary: `Action engine attached ${items.length} items`,
      }) as GenericMutationResult;
      return {
        ok: true,
        index,
        type,
        targetKind: "workspaceItem",
        targetId: result.createdItemIds?.[0],
        summary: `Attached ${result.createdItemIds?.length ?? 0} items.`,
        mutation: { type, workstreamId },
        result: { createdItemIds: result.createdItemIds ?? [], mutationId: result.mutationId },
      };
    }

    if (type === "update_workstream_layout") {
      const workstreamId = asOptionalTrimmedString(action.workstreamId, "workstreamId") ?? context.activeWorkstreamId;
      if (!workstreamId) throw new Error("workstreamId is required");
      const entriesInput = Array.isArray(action.widgets) ? action.widgets : action.items;
      if (!Array.isArray(entriesInput) || entriesInput.length === 0) throw new Error("widgets must be a non-empty array");
      const items = entriesInput.map((entry, itemIndex) => {
        const item = asObject(entry, `widgets[${itemIndex}]`);
        return {
          itemId: asTrimmedString(item.itemId, `widgets[${itemIndex}].itemId`),
          x: asNumber(item.x, `widgets[${itemIndex}].x`),
          y: asNumber(item.y, `widgets[${itemIndex}].y`),
          width: item.width === undefined ? undefined : asNumber(item.width, `widgets[${itemIndex}].width`),
          height: item.height === undefined ? undefined : asNumber(item.height, `widgets[${itemIndex}].height`),
          zIndex: item.zIndex === undefined ? undefined : asNumber(item.zIndex, `widgets[${itemIndex}].zIndex`),
        };
      });
      const result = await convexMutation("workspaceItems:updateWorkstreamLayout", {
        actorClerkId: context.actorClerkId,
        workstreamId,
        items,
        provenanceSource: "ai",
        mutationSummary: "Action engine updated workstream layout",
      }) as GenericMutationResult;
      return {
        ok: true,
        index,
        type,
        targetKind: "workspaceItem",
        targetId: items[0]?.itemId,
        summary: `Updated layout for ${items.length} widgets.`,
        mutation: { type, workstreamId },
        result: { mutationId: result.mutationId, itemCount: items.length },
      };
    }

    if (type === "generate_flashcards_from_artifact") {
      const artifactId = asOptionalTrimmedString(action.artifactId ?? context.artifactId, "artifactId");
      if (!artifactId) throw new Error("artifactId is required");
      const artifact = await loadArtifact(context, artifactId);
      const sourceText = asOptionalTrimmedString(action.contentPlaintext, "contentPlaintext", { max: 120000, allowEmpty: true }) ?? artifact.contentPlaintext ?? "";
      const lines = sourceText.split(/\n+/).map((line: string) => line.trim()).filter(Boolean).slice(0, 8);
      if (lines.length === 0) throw new Error("Artifact has no textual content for flashcards");
      const cards = lines.map((line: string, cardIndex: number) => ({
        front: line.length > 80 ? line.slice(0, 80) : `Key point ${cardIndex + 1}`,
        back: line,
      }));
      const title = asOptionalTrimmedString(action.title, "title", { max: 120 }) ?? `Flashcards · ${artifact.title}`;
      const chatResult = await convexMutation("chats:createChat", {
        actorClerkId: context.actorClerkId,
        workstreamId: artifact.workstreamId ?? context.activeWorkstreamId,
        artifactId,
        mode: "flashcard",
        thinkingLevel: "low",
        routerMode: "auto",
        usePersonalResources: true,
        title,
        allowExistingThreadReuse: false,
      }) as CreateChatResult;
      const messageResult = await convexMutation("chats:appendMessage", {
        actorClerkId: context.actorClerkId,
        chatId: chatResult.chatId,
        role: "assistant",
        content: cards.map((card, cardIndex) => `${cardIndex + 1}. ${card.front}: ${card.back}`).join("\n"),
        mode: "flashcard",
        citations: [],
        routeTrace: {
          phases: [], toolchain: [type], candidateModels: [], whyThisResponse: "Generated flashcards from artifact", warnings: [], fallbackUsed: false, budgetTier: "normal",
        },
      }) as AppendMessageResult;
      const deckResult = await convexMutation("flashcards:createDeck", {
        actorClerkId: context.actorClerkId,
        chatId: chatResult.chatId,
        sourceMessageId: messageResult.messageId,
        title,
        cards,
      }) as FlashcardDeckResult;
      const workspaceResult = await createWorkspaceResult(context, {
        workstreamId: artifact.workstreamId ?? context.activeWorkstreamId,
        title: "Generated flashcards",
        summary: `Generated ${deckResult.cardCount} flashcards from ${artifact.title}.`,
        targetKind: "chat",
        targetId: chatResult.chatId,
        variant: "artifact",
        metadata: { actionType: type, artifactId, deckId: deckResult.deckId, messageId: messageResult.messageId },
      });
      return {
        ok: true,
        index,
        type,
        targetKind: "chat",
        targetId: chatResult.chatId,
        summary: `Generated flashcards from ${artifact.title}.`,
        mutation: { type },
        result: { artifactId, deckId: deckResult.deckId, chatId: chatResult.chatId, workspaceResultId: workspaceResult?.resultId },
        ui: { resultBar: true },
      };
    }

    if (type === "generate_quiz_from_artifact") {
      const artifactId = asOptionalTrimmedString(action.artifactId ?? context.artifactId, "artifactId");
      if (!artifactId) throw new Error("artifactId is required");
      const artifact = await loadArtifact(context, artifactId);
      const sourceText = asOptionalTrimmedString(action.contentPlaintext, "contentPlaintext", { max: 120000, allowEmpty: true }) ?? artifact.contentPlaintext ?? "";
      const lines = sourceText.split(/\n+/).map((line: string) => line.trim()).filter(Boolean).slice(0, 4);
      if (lines.length === 0) throw new Error("Artifact has no textual content for quiz generation");
      const questions = lines.map((line: string, questionIndex: number) => ({
        id: `q-${questionIndex + 1}`,
        prompt: `Which statement best matches: ${line.slice(0, 80)}?`,
        selected: undefined,
        correct: "A",
        isCorrect: false,
        explanation: line,
      }));
      const title = asOptionalTrimmedString(action.title, "title", { max: 120 }) ?? `Quiz · ${artifact.title}`;
      const chatResult = await convexMutation("chats:createChat", {
        actorClerkId: context.actorClerkId,
        workstreamId: artifact.workstreamId ?? context.activeWorkstreamId,
        artifactId,
        mode: "quiz",
        thinkingLevel: "low",
        routerMode: "auto",
        usePersonalResources: true,
        title,
        allowExistingThreadReuse: false,
      }) as CreateChatResult;
      const messageResult = await convexMutation("chats:appendMessage", {
        actorClerkId: context.actorClerkId,
        chatId: chatResult.chatId,
        role: "assistant",
        content: questions.map((question, questionIndex) => `${questionIndex + 1}. ${question.prompt}`).join("\n"),
        mode: "quiz",
        citations: [],
        routeTrace: {
          phases: [], toolchain: [type], candidateModels: [], whyThisResponse: "Generated quiz from artifact", warnings: [], fallbackUsed: false, budgetTier: "normal",
        },
      }) as AppendMessageResult;
      const workspaceResult = await createWorkspaceResult(context, {
        workstreamId: artifact.workstreamId ?? context.activeWorkstreamId,
        title: "Generated quiz",
        summary: `Generated ${questions.length} quiz questions from ${artifact.title}.`,
        targetKind: "chat",
        targetId: chatResult.chatId,
        variant: "artifact",
        metadata: { actionType: type, artifactId, messageId: messageResult.messageId, questionCount: questions.length, questions },
      });
      return {
        ok: true,
        index,
        type,
        targetKind: "chat",
        targetId: chatResult.chatId,
        summary: `Generated quiz from ${artifact.title}.`,
        mutation: { type },
        result: { artifactId, chatId: chatResult.chatId, messageId: messageResult.messageId, workspaceResultId: workspaceResult?.resultId },
        ui: { resultBar: true },
      };
    }

    return actionFailure(index, type, `Unsupported action type: ${type}`, action);
  } catch (error) {
    return actionFailure(index, typeof action.type === "string" ? action.type : "unknown", error instanceof Error ? error.message : "Unknown action execution failure", action);
  }
}

export async function executeStructuredActions(params: {
  context: ToolCallContext;
  actions: unknown;
  maxActions?: number;
}): Promise<ActionEngineRunResult> {
  if (!Array.isArray(params.actions)) {
    throw new Error("actions must be an array");
  }
  const capped = (params.actions as unknown[]).slice(0, params.maxActions ?? 12);
  const results: ActionExecutionResult[] = [];
  for (let index = 0; index < capped.length; index += 1) {
    const entry = capped[index];
    if (!isObject(entry)) {
      results.push(actionFailure(index, "unknown", "Each action must be an object"));
      continue;
    }
    results.push(await executeSingleAction(params.context, entry, index));
  }
  const successes = results.filter((entry): entry is ActionExecutionSuccess => entry.ok);
  const failures = results.filter((entry): entry is ActionExecutionFailure => !entry.ok);
  return {
    ok: failures.length === 0,
    summary: failures.length === 0
      ? `Applied ${successes.length} action${successes.length === 1 ? "" : "s"}.`
      : `Applied ${successes.length} action${successes.length === 1 ? "" : "s"} with ${failures.length} failure${failures.length === 1 ? "" : "s"}.`,
    appliedCount: successes.length,
    failedCount: failures.length,
    results,
    resultIds: successes.flatMap((entry) => typeof entry.result.workspaceResultId === "string" ? [entry.result.workspaceResultId] : []),
    targetIds: successes.flatMap((entry) => entry.targetId ? [{ type: entry.targetKind ?? entry.type, id: entry.targetId }] : []),
  };
}

export function describeStructuredActionTypes() {
  return [...ACTION_TYPES];
}
