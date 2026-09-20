import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash, createHmac } from "node:crypto";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.SPECTRA_TEST_INLINE_RUNS;
  delete process.env.SPECTRA_APP_URL;
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.SPECTRA_COLLAB_BRIDGE_KEY;
});

function deckPlan() {
  return {
    decision: "operate",
    intent: { mode: "create", requestedArtifactTypes: ["flashcard_deck"], requestedVisibleArtifactCount: 1, targetArtifactId: null, targetWorkspaceId: "workspace-real" },
    finalResponse: "Created a 6-card photosynthesis deck with memory cues.",
    operations: [{
      type: "artifact.create",
      input: {
        blueprintKey: "flashcard_deck",
        title: "Photosynthesis memory cues",
        summary: "Six recall cards.",
        content: {
          cards: Array.from({ length: 6 }, (_, index) => ({ id: `card-${index + 1}`, front: `Prompt ${index + 1}`, back: `Answer ${index + 1}`, hint: `Memory cue ${index + 1}`, sourceRefs: [], confidence: "unknown" })),
          settings: { shuffle: true, revealMode: "click" },
        },
        tags: ["biology", "photosynthesis"],
        workspaceId: "workspace-real",
        placement: "context",
      },
    }],
  };
}

function quizPlan() {
  const questions = Array.from({ length: 6 }, (_, index) => {
    const multipleChoice = index < 4;
    return {
      id: `question-${index + 1}`,
      prompt: `Question ${index + 1}`,
      type: multipleChoice ? "multiple_choice" : "short_answer",
      options: multipleChoice
        ? ["Correct answer", "Distractor one", "Distractor two", "Distractor three"]
        : [],
      correctAnswer: "Correct answer",
      explanation: `Explanation ${index + 1}`,
      difficulty: (["easy", "medium", "hard"] as const)[index % 3],
      sourceRefs: [],
      feedback: "",
    };
  });
  return {
    decision: "operate",
    intent: {
      mode: "create",
      requestedArtifactTypes: ["quiz"],
      requestedVisibleArtifactCount: 1,
      targetArtifactId: null,
      targetWorkspaceId: "workspace-real",
    },
    finalResponse: "Created a six-question quiz with explanations.",
    operations: [
      {
        type: "artifact.create",
        input: {
          blueprintKey: "quiz",
          title: "Cellular respiration quiz",
          summary: "Four multiple-choice and two short-answer questions.",
          content: {
            questions,
            settings: {
              showAnswersImmediately: true,
              timed: false,
              shuffleQuestions: false,
              passingScore: 70,
            },
          },
          tags: ["biology", "cellular-respiration"],
          workspaceId: "workspace-real",
          placement: "context",
        },
      },
    ],
  };
}

function setup(
  plan: unknown,
  initialStatus: "queued" | "failed" = "queued",
  savedArtifactOverride?: Record<string, unknown>,
  catalogArtifacts: Record<string, unknown>[] = [],
) {
  const card: { _id: string; runId: string; status: string; title: string; summary: string; variant: string; actions: Array<Record<string, unknown>>; updatedAt: number } = { _id: "card-real", runId: "run-real", status: initialStatus, title: initialStatus === "failed" ? "Run failed" : "Queued", summary: "", variant: initialStatus === "failed" ? "error" : "status", actions: [], updatedAt: 1 };
  const run: Record<string, unknown> & { status: string; sourceSurface: "workspace" | "chat"; workspaceId?: string; userPrompt: string; attemptCount: number } = { _id: "run-real", status: initialStatus, sourceSurface: "workspace", workspaceId: "workspace-real", threadId: "thread-real", executionId: "execution-1", userPrompt: "Create a flashcard deck about photosynthesis with 6 cards. Include memory cues.", attemptCount: 1 };
  const operations: Array<Record<string, unknown>> = [];
  let savedArtifact: Record<string, unknown> = {
    _id: "artifact-real",
    blueprintKey: "flashcard_deck",
    title: "Cellular Respiration Essentials",
    summary: "A focused deck.",
    content: deckPlan().operations[0].input.content,
    tags: ["biology"],
    placements: [{ workspaceId: "workspace-real", workspaceTitle: "Biology", nodeId: "node-real" }],
    updatedAt: 1,
    ...savedArtifactOverride,
  };
  const requireActor = vi.fn().mockResolvedValue({ clerkId: "actor" });
  const convexQuery = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name.includes("spectraRuns:get")) return { run, cards: [card], operations };
    if (name.includes("spectraRuns:listRunAttachments")) return [];
    if (name.includes("spectraThreads:getChoiceContinuation")) {
      return {
        message: {
          _id: "message-A",
          runId: "run-asking",
          content: "Which Lab notes draft should I revise?",
          metadata: {
            clarification: {
              id: "clarification-A",
              executionId: "execution-A",
              targetIds: ["artifact-chemistry"],
            },
            choiceSelection: {
              clarificationId: "clarification-A",
              executionId: "execution-A",
              key: "artifact-chemistry",
              title: "Lab notes",
            },
          },
        },
        askingRun: { userPrompt: "Revise the selected Lab notes draft", planIntent: { mode: "update" } },
        clarification: { id: "clarification-A", executionId: "execution-A", targetIds: ["artifact-chemistry"] },
        selection: { key: "artifact-chemistry", title: "Lab notes" },
      };
    }
    if (name.includes("spectraArtifacts:get")) return savedArtifact;
    if (name.includes("spectraArtifacts:listAgentRoutingDescriptors")) return [];
    if (name.includes("spectraArtifacts:list")) return args?.blueprintKey === "agent" ? [] : catalogArtifacts;
    if (name.includes("spectraWorkspaces:list")) return [{ _id: "workspace-real", title: "Biology" }];
    if (name.includes("orgTree:listWorkspaceContents")) return { workspace: { _id: "workspace-real", title: "Biology" }, items: [] };
    if (name.includes("spectraThreads:get")) return { threadId: "thread-real", title: "New thread", messages: [], traces: [] };
    if (name.includes("identity:me") || name.includes("identity:get")) {
      return {
        accountId: "account-real",
        clerkId: "actor",
        email: "actor@example.com",
        name: "Test Actor",
        schoolId: "school-real",
      };
    }
    if (name.includes("authority:access")) return { level: "modify", canModify: true };
    if (name.includes("replicas:forWork")) {
      const format =
        typeof savedArtifact.nativeFormat === "string"
          ? savedArtifact.nativeFormat
          : undefined;
      return {
        replicas: format
          ? [{ kind: "local", state: "current", nativeFormat: format }]
          : [],
      };
    }
    if (name.includes("replicas:materializationStatus")) {
      return { requestId: args?.requestId ?? "req-native", state: "verified" };
    }
    if (name.includes("collaboration:ensureRoom")) {
      return {
        roomId: "room-real",
        documentName: "artifact:artifact-pending:root",
        policyVersion: 1,
      };
    }
    throw new Error(`Unexpected query: ${name}`);
  });
  const convexMutation = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name.includes("spectraRuns:beginRunAttachmentUpload")) return { runAttachmentId: "run-attachment-real", reused: true };
    if (name.includes("spectraRuns:beginRun")) {
      run.sourceSurface = args.sourceSurface as "workspace" | "chat";
      run.workspaceId = args.workspaceId as string | undefined;
      run.userPrompt = args.userPrompt as string;
      run.executionId = args.clarificationId ? "execution-2" : "execution-1";
      return { runId: "run-real", resultCardId: "card-real", threadId: "thread-real", executionId: run.executionId, created: true };
    }
    if (name.includes("spectraRuns:scheduleExecution")) return { scheduled: true };
    if (name.includes("spectraRunJobs:enqueue")) return { jobId: "job-real", created: true };
    if (name.includes("spectraRunJobs:activate")) return { activated: true };
    if (name.includes("spectraRunJobs:cancelForRun")) return { cancelled: true };
    if (name.includes("spectraRunJobs:generateAttachmentUploadUrl")) return "https://example.test/upload";
    if (name.includes("spectraRunJobs:registerAttachment")) return { attachmentId: "attachment-real" };
    if (name.includes("spectraRuns:claimExecution")) return { claimed: true };
    if (name.includes("spectraRuns:heartbeat")) return { alive: true };
    if (name.includes("regionClaims:acquire")) return { claimId: "claim-real", status: "active" };
    if (name.includes("regionClaims:renew")) return { renewed: true };
    if (name.includes("regionClaims:release") || name.includes("regionClaims:releaseClaimsForRun")) return { released: true };
    if (name.includes("changeGroups:checkpointBeforeAi")) return { versionId: "version-pre-ai" };
    if (name.includes("spectraThreads:appendMessage")) return "message-real";
    if (name.includes("spectraThreads:applyGeneratedMetadata")) return { threadId: "thread-real" };
    if (name.includes("spectraRuns:setSuggestedThreadMetadata")) return { runId: "run-real" };
    if (name.includes("spectraRuns:setContextSnapshot")) return { runId: "run-real" };
    if (name.includes("spectraRuns:resetForRetry")) {
      run.status = "queued";
      run.attemptCount = 2;
      run.executionId = "execution-2";
      card.status = "queued";
      return { runId: "run-real", resultCardId: "card-real", prompt: run.userPrompt, workspaceId: run.workspaceId, sourceSurface: "workspace", executionId: "execution-2", created: true };
    }
    if (name.includes("spectraRuns:updateStatus")) {
      run.status = args.status as typeof run.status;
      card.status = args.status as typeof card.status;
      card.title = typeof args.resultTitle === "string" ? args.resultTitle : card.title;
      card.summary = typeof args.resultSummary === "string" ? args.resultSummary : card.summary;
      card.variant = typeof args.resultVariant === "string" ? args.resultVariant : card.variant;
      card.actions = Array.isArray(args.resultActions) ? args.resultActions : card.actions;
      card.updatedAt += 1;
      if (args.decision !== undefined) run.decision = args.decision;
      if (args.planIntent !== undefined) run.planIntent = args.planIntent;
      if (args.finalSummary !== undefined) run.finalSummary = args.finalSummary;
      return { runId: "run-real" };
    }
    if (name.includes("spectraRuns:patchResultCard")) {
      card.title = typeof args.title === "string" ? args.title : card.title;
      card.summary = typeof args.summary === "string" ? args.summary : card.summary;
      card.updatedAt += 1;
      return { resultCardId: "card-real" };
    }
    if (name.includes("spectraOperations:recordPlan")) {
      const next = args.operations as Array<Record<string, unknown>>;
      operations.push(...next.map((operation, index) => ({
        _id: `operation-${index + 1}`,
        runId: "run-real",
        executionId: args.executionId,
        status: "proposed",
        affected: [],
        ...operation,
      })));
      return { operationIds: next.map((_operation, index) => `operation-${index + 1}`) };
    }
    if (name.includes("spectraArtifacts:createPending")) {
      savedArtifact = {
        ...savedArtifact,
        _id: "artifact-pending",
        blueprintKey: (args.blueprintKey as string) ?? savedArtifact.blueprintKey,
        title: args.title as string,
      };
      return { artifactId: "artifact-pending", nodeId: "node-pending" };
    }
    if (name.includes("spectraArtifacts:finalizePendingLive") || name.includes("spectraArtifacts:finalizePending")) {
      savedArtifact = {
        ...savedArtifact,
        _id: "artifact-real",
        blueprintKey: (args.blueprintKey as string) ?? savedArtifact.blueprintKey,
        title: (args.title as string) ?? savedArtifact.title,
        summary: (args.summary as string | undefined) ?? savedArtifact.summary,
        content: args.content ?? savedArtifact.content,
        tags: (args.tags as string[] | undefined) ?? savedArtifact.tags,
        updatedAt: Number(savedArtifact.updatedAt ?? 1) + 1,
        currentVersionId: "version-real",
        liveStateVectorHash: "hash-real",
      };
      return { artifactId: "artifact-real", nodeId: "node-real" };
    }
    if (name.includes("spectraArtifacts:create")) return { artifactId: "artifact-real", nodeId: "node-real" };
    if (name.includes("spectraArtifacts:update")) {
      savedArtifact = {
        ...savedArtifact,
        title: (args.title as string | undefined) ?? savedArtifact.title,
        summary: (args.summary as string | undefined) ?? savedArtifact.summary,
        content: args.content ?? savedArtifact.content,
        tags: (args.tags as string[] | undefined) ?? savedArtifact.tags,
        updatedAt: Number(savedArtifact.updatedAt ?? 1) + 1,
      };
      return { artifactId: "artifact-real" };
    }
    if (name.includes("spectraWorkspaces:createPending")) return { workspaceId: "workspace-pending" };
    if (name.includes("spectraRuns:rejectConfirmation")) {
      run.status = "cancelled";
      card.status = "cancelled";
      card.title = "Cancelled";
      card.summary = "No proposed changes were applied.";
      card.actions = [];
      return { alreadyRejected: false };
    }
    if (name.includes("spectraRuns:claimConfirmation")) {
      run.status = "running";
      card.status = "running";
      return { resultCardId: "card-real" };
    }
    if (name.includes("accountPreferences:writeLayer")) return { scope: "account", values: args.values };
    if (name.includes("syncPolicy:override")) return { changed: true };
    if (name.includes("replicas:localEffectCount")) return { count: 3 };
    if (name.includes("orgTree:createFolder") || name.includes("orgTree:rename") || name.includes("orgTree:move") || name.includes("orgTree:createReference") || name.includes("orgTree:trash")) return { ok: true, nodeId: "node-app" };
    if (name.includes("spectraOperations:claim") || name.includes("spectraOperations:assertClaimed") || name.includes("spectraOperations:markExecuted") || name.includes("spectraOperations:cancelPending") || name.includes("spectraOperations:attachPendingArtifact") || name.includes("spectraOperations:attachPendingWorkspace")) return {};
    if (name.includes("spectraRuns:appendEvent") || name.includes("spectraRuns:appendEvents") || name.includes("spectraRuns:markTraceDegraded")) return {};
    if (name.includes("spectraArtifacts:patchPendingContent") || name.includes("spectraArtifacts:stageAiPatch") || name.includes("spectraArtifacts:discardPendingForRun") || name.includes("spectraArtifacts:failPendingForRun") || name.includes("spectraArtifacts:settleStagedForRun") || name.includes("spectraWorkspaces:settleForRun")) return {};
    if (name.includes("spectraArtifacts:setAiEffects") || name.includes("spectraArtifacts:clearAiEffects") || name.includes("spectraArtifacts:queueAiEffect")) return {};
    if (name.includes("orgTree:setPinned") || name.includes("orgTree:removeFromWorkspace") || name.includes("orgTree:placeWork")) return {};
    if (name.includes("spectraArtifactLinks:create") || name.includes("spectraArtifactLinks:remove")) return {};
    if (name.includes("replicas:cancelMaterialization")) return { cancelled: true, state: "failed" };
    if (name.includes("replicas:queueMaterialization")) return { requestId: "req-native", state: "pending" };
    if (name.includes("metering:") || name.includes("operationalCounters:") || name.includes("audit:")) return {};
    if (name.includes("memory:")) return {};
    throw new Error(`Unexpected mutation: ${name}`);
  });

  vi.doMock("@/lib/auth-server", () => ({ requireActor }));
  vi.doMock("@/lib/convex-server", () => ({
    convexQuery, convexMutation,
    storeArtifactContent: async (_artifactId: string, content: unknown) => content,
  }));
  const materializeDocxArtifact = vi.fn(
    async (): Promise<{
      state: "conflicted" | "pending" | "verified" | "claimed";
      requestId?: string;
      hash?: string;
      conflict?: { message?: string };
    }> => ({
      state: "conflicted",
      conflict: { message: "Both copies changed. Nothing overwritten." },
    }),
  );
  const materializeOfficeArtifact = vi.fn(async () => ({
    state: "conflicted" as const,
    conflict: { message: "Both copies changed. Nothing overwritten." },
  }));
  vi.doMock("@/app/api/spectra/lenses/docx/route", () => ({
    materializeDocxArtifact,
  }));
  vi.doMock("@/app/api/spectra/lenses/office/route", () => ({
    materializeOfficeArtifact,
  }));
  vi.doMock("@/features/spectra/ai/yjs-artifact-operation", () => {
    class AiArtifactRegionConflictError extends Error {
      artifactId: string;
      clientId: string;
      claim: {
        claimId: string;
        conflict?: { regionId?: string; actorKind?: string; queuePosition?: number };
      };
      baseSnapshot: unknown;
      proposedSnapshot: unknown;
      constructor(
        message: string,
        details: {
          artifactId: string;
          clientId: string;
          claim: AiArtifactRegionConflictError["claim"];
          baseSnapshot?: unknown;
          proposedSnapshot?: unknown;
        },
      ) {
        super(message);
        this.name = "AiArtifactRegionConflictError";
        this.artifactId = details.artifactId;
        this.clientId = details.clientId;
        this.claim = details.claim;
        this.baseSnapshot = details.baseSnapshot;
        this.proposedSnapshot = details.proposedSnapshot;
      }
    }
    return {
      AiArtifactRegionConflictError,
      readLiveArtifactValue: vi.fn(async () => null),
      applyAiArtifactMutation: vi.fn(async (params: {
        artifactId: string;
        beforeCommit?: (info: {
          desired: {
            title: string;
            summary?: string;
            content: unknown;
            tags: string[];
          };
          changedRegionIds: string[];
        }) => Promise<void>;
        resolveDesired: (current: {
          title: string;
          summary?: string;
          content: unknown;
          tags: string[];
        }) => {
          title: string;
          summary?: string;
          content: unknown;
          tags: string[];
        };
      }) => {
        const desired = params.resolveDesired({
          title: savedArtifact.title as string,
          summary: savedArtifact.summary as string | undefined,
          content: savedArtifact.content,
          tags: (savedArtifact.tags as string[]) ?? [],
        });
        await params.beforeCommit?.({
          desired,
          changedRegionIds: ["docx:paragraph:unique"],
        });
        savedArtifact = {
          ...savedArtifact,
          _id: params.artifactId,
          title: desired.title,
          summary: desired.summary,
          content: desired.content,
          tags: desired.tags,
          updatedAt: Number(savedArtifact.updatedAt ?? 1) + 1,
          currentVersionId: "version-ai",
          liveStateVectorHash: "hash-ai",
        };
        return { artifactId: params.artifactId, changedRegionIds: ["docx:paragraph:unique"] };
      }),
    };
  });
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.SPECTRA_TEST_INLINE_RUNS = "1";
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: "openai/gpt-5.6", provider: "OpenAI", choices: [{ message: { content: JSON.stringify(plan) } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return {
    convexQuery,
    convexMutation,
    fetchMock,
    getSavedArtifact: () => savedArtifact,
    materializeDocxArtifact,
    materializeOfficeArtifact,
  };
}

describe("Spectra run route", () => {
  it("fans independent multi-output study packs into typed parallel workers", async () => {
    const { fetchMock } = setup({});
    fetchMock.mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String((init as RequestInit).body)) as {
        tool_choice?: { function?: { name?: string } };
        tools?: Array<{
          function?: {
            name?: string;
            parameters?: {
              properties?: { plan?: { type?: string; additionalProperties?: boolean; oneOf?: unknown } };
            };
          };
        }>;
      };
      const toolName =
        payload.tool_choice?.function?.name ??
        payload.tools
          ?.map((tool) => tool.function?.name)
          .find((name) => name?.startsWith("create_"));
      const isDocument = toolName === "create_document";
      const args = {
        title: isDocument ? "Review" : "Practice",
        summary: isDocument ? "Compact review notes." : "Practice questions.",
        content: isDocument
          ? {
              blocks: [{ id: "block-1", type: "paragraph", text: "Review content" }],
              outline: [],
            }
          : quizPlan().operations[0].input.content,
        tags: ["study-pack"],
        conversationTitle: "Study Pack",
        conversationSummary: "Created one part of the study pack.",
        finalResponse: `Created ${isDocument ? "Review" : "Practice"}.`,
      };
      return new Response(
        JSON.stringify({
          model: "deepseek/deepseek-v4-pro-20260423",
          provider: "DeepSeek",
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: "",
              tool_calls: [{
                id: `call-${toolName}`,
                type: "function",
                function: { name: toolName, arguments: JSON.stringify(args) },
              }],
            },
          }],
        }),
        { status: 200 },
      );
    });
    process.env.OPENROUTER_API_KEY = "test-key";
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/spectra/run", {
        method: "POST",
        body: JSON.stringify({
          action: "run",
          surface: "workspace",
          workspaceId: "workspace-real",
          prompt:
            "Build a compact study pack from the included deck. Create a document titled 'Review' and create a quiz titled 'Practice'.",
        }),
      }),
    );
    await response.text();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const selectedTools = fetchMock.mock.calls.map((call) => {
      const payload = JSON.parse(String((call[1] as RequestInit).body)) as {
        tool_choice?: { function?: { name?: string } };
        tools?: Array<{
          function?: {
            name?: string;
            parameters?: {
              properties?: {
                plan?: {
                  type?: string;
                  additionalProperties?: boolean;
                  oneOf?: unknown;
                };
              };
            };
          };
        }>;
      };
      return (
        payload.tool_choice?.function?.name ??
        payload.tools
          ?.map((tool) => tool.function?.name)
          .find((name) => name?.startsWith("create_"))
      );
    });
    expect(selectedTools).toEqual(
      expect.arrayContaining(["create_document", "create_quiz"]),
    );
    expect(selectedTools).not.toContain("submit_plan");
  }, 60_000);

  it("keeps quoted planner subtask verbs inside one creation and enforces the explicit contract locally", async () => {
    const { fetchMock, getSavedArtifact } = setup({});
    fetchMock.mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String((init as RequestInit).body)) as {
        tool_choice?: { function?: { name?: string } };
      };
      const toolName = payload.tool_choice?.function?.name;
      if (toolName === "create_planner_task") {
        return new Response(JSON.stringify({
          model: "deepseek/deepseek-v4-pro-20260423",
          provider: "DeepSeek",
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: "",
              tool_calls: [{
                id: "planner-worker",
                type: "function",
                function: {
                  name: "create_planner_task",
                  // Deliberately omit the requested due date and subtasks. The
                  // harness owns exact user-stated contract values.
                  arguments: JSON.stringify({
                    title: "Review Task Graph Notes",
                    summary: "Review the graph notes.",
                    content: {
                      description: "Review the task graph notes (q57f4cwrc4y1fvkv9qsmmwbaad8af46w).",
                      dueAt: null,
                      startAt: null,
                      endAt: null,
                      allDay: true,
                      status: "todo",
                      priority: "medium",
                      linkedArtifactIds: [],
                      linkedThreadIds: [],
                      subtasks: [],
                      attachments: [],
                      reminders: [],
                      estimateMinutes: null,
                      progressNote: "",
                      sourceRefs: [],
                    },
                    tags: [],
                    conversationTitle: "Review Task Graph Notes",
                    conversationSummary: "Created the review task.",
                    finalResponse: "Created the review task.",
                  }),
                },
              }],
            },
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        model: "deepseek/deepseek-v4-pro-20260423",
        provider: "DeepSeek",
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: "",
            tool_calls: [{
              id: "coordination-worker",
              type: "function",
              function: {
                name: "submit_plan",
                arguments: JSON.stringify({
                  plan: {
                    decision: "answer",
                    intent: {
                      mode: "answer",
                      requestedArtifactTypes: ["task"],
                      requestedVisibleArtifactCount: 0,
                      targetArtifactId: null,
                      targetWorkspaceId: null,
                    },
                    conversationTitle: null,
                    conversationSummary: null,
                    choices: null,
                    operations: [],
                    finalResponse: "The creation worker owns the requested task.",
                  },
                }),
              },
            }],
          },
        }],
      }), { status: 200 });
    });
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({
        action: "run",
        surface: "workspace",
        workspaceId: "workspace-real",
        artifactId: "artifact-real",
        prompt: "Create a planner task titled 'Review Task Graph Notes' due tomorrow at 4:00 PM with exactly 2 subtasks named 'Read both sections' and 'Write one correction'. Add the tag 'task-graph-source' to this document and link the new task to this document with relation follow_up.",
      }),
    }));
    await response.text();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const tools = fetchMock.mock.calls.map((call) =>
      (JSON.parse(String((call[1] as RequestInit).body)) as { tool_choice?: { function?: { name?: string } } })
        .tool_choice?.function?.name,
    );
    expect(tools.filter((name) => name === "create_planner_task")).toHaveLength(1);
    expect(tools.filter((name) => name === "submit_plan")).toHaveLength(1);
    const creationCall = fetchMock.mock.calls.find((call) =>
      (JSON.parse(String((call[1] as RequestInit).body)) as { tool_choice?: { function?: { name?: string } } })
        .tool_choice?.function?.name === "create_planner_task",
    );
    expect(String((creationCall?.[1] as RequestInit).body)).not.toContain("Add the tag");
    const content = getSavedArtifact().content as {
      dueAt?: number;
      description?: string;
      subtasks?: Array<{ title: string; done: boolean }>;
    };
    expect(content.dueAt).toEqual(expect.any(Number));
    expect(new Date(content.dueAt!).getHours()).toBe(16);
    expect(new Date(content.dueAt!).getMinutes()).toBe(0);
    expect(content.description).toBe("Review the task graph notes.");
    expect(content.subtasks).toEqual([
      expect.objectContaining({ title: "Read both sections", done: false }),
      expect.objectContaining({ title: "Write one correction", done: false }),
    ]);
  }, 60_000);

  it("treats multiple-choice questions as one quiz rather than multiple artifacts", async () => {
    const { convexMutation, fetchMock, getSavedArtifact } = setup(quizPlan());
    const quizInput = quizPlan().operations[0].input;
    fetchMock.mockReset().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "deepseek/deepseek-v4-pro-20260423",
          provider: "DeepSeek",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "typed-quiz",
                    type: "function",
                    function: {
                      name: "create_quiz",
                      arguments: JSON.stringify({
                        title: quizInput.title,
                        summary: quizInput.summary,
                        content: quizInput.content,
                        tags: quizInput.tags,
                        conversationTitle: "Cellular Respiration Quiz",
                        conversationSummary: "Created a focused six-question respiration quiz.",
                        finalResponse: "Created the requested six-question quiz.",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/spectra/run", {
        method: "POST",
        body: JSON.stringify({
          action: "run",
          surface: "workspace",
          workspaceId: "workspace-real",
          prompt:
            "Create a separate premium quiz from this flashcard deck with exactly 6 questions: four multiple-choice and two short-answer. Cover all three sections, include explanations for every answer, use varied difficulty, and do not change the deck.",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getSavedArtifact().blueprintKey).toBe("quiz");
    expect(
      convexMutation.mock.calls.some(([name]) =>
        String(name).includes("spectraArtifacts:finalizePending"),
      ),
    ).toBe(true);
    expect(
      convexMutation.mock.calls.some(
        ([name, args]) =>
          String(name).includes("spectraArtifacts:patchPendingContent") &&
          Array.isArray(
            ((args as { content?: { questions?: unknown[] } }).content)
              ?.questions,
          ) &&
          ((args as { content: { questions: unknown[] } }).content.questions
            .length === 6),
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("salvages a complete terminal plan when routed tool arguments append transport JSON", async () => {
    const plan = quizPlan();
    const { convexMutation, fetchMock } = setup(plan);
    fetchMock.mockReset().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "deepseek/deepseek-v4-pro-20260423",
          provider: "DeepSeek",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "submit-with-trailing-json",
                    type: "function",
                    function: {
                      name: "submit_plan",
                      arguments: `${JSON.stringify({ plan })}{"transport":"duplicate"}`,
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/spectra/run", {
        method: "POST",
        body: JSON.stringify({
          action: "run",
          surface: "workspace",
          workspaceId: "workspace-real",
          prompt:
            "Create a quiz from this flashcard deck with exactly 6 questions: four multiple-choice and two short-answer.",
        }),
      }),
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(
      convexMutation.mock.calls.some(([name]) =>
        String(name).includes("spectraArtifacts:finalizePending"),
      ),
    ).toBe(true);
  });

  it("moves an unambiguous artifact summary from the operation envelope without a retry", async () => {
    const plan = quizPlan();
    const operation = plan.operations[0] as unknown as Record<string, unknown>;
    const input = operation.input as Record<string, unknown>;
    operation.summary = input.summary;
    delete input.summary;
    const { fetchMock } = setup(plan);
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/spectra/run", {
        method: "POST",
        body: JSON.stringify({
          action: "run",
          surface: "workspace",
          workspaceId: "workspace-real",
          prompt:
            "Create one quiz with exactly 6 questions: four multiple-choice and two short-answer.",
        }),
      }),
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("creates one six-card deck and does not emit unrelated placement removal", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { convexMutation, fetchMock, getSavedArtifact } = setup(deckPlan());
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "run", surface: "workspace", workspaceId: "workspace-real", prompt: "Create a flashcard deck about photosynthesis with 6 cards. Include memory cues." }) }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string; message?: string });

    const createCall = convexMutation.mock.calls.find(([name]) => String(name).includes("spectraArtifacts:finalizePending"));
    expect(createCall).toBeTruthy();
    expect((getSavedArtifact().content as { cards: unknown[] }).cards).toHaveLength(6);
    expect(convexMutation.mock.calls.some(([name]) => String(name).includes("orgTree:removeFromWorkspace"))).toBe(false);
    const beginRunCall = convexMutation.mock.calls.find(([name]) => String(name).includes("spectraRuns:beginRun"));
    expect(beginRunCall?.[1]).toMatchObject({ sourceSurface: "workspace", workspaceId: "workspace-real" });
    expect(events.some((event) => event.type === "confirmation_required")).toBe(false);
    expect(events.some((event) => event.message === "Validating 6 cards")).toBe(true);
    expect(events.some((event) => event.message === "Saving deck to Biology")).toBe(true);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as { model: string; provider: { order: string[]; only: string[]; allow_fallbacks: boolean }; reasoning?: unknown; stream: boolean; tools?: Array<{ function?: { name?: string } }> };
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(payload.model).toBe("openai/gpt-5.6");
    expect(payload.provider).toEqual({ order: ["OpenAI"], only: ["OpenAI"], allow_fallbacks: false });
    expect(payload.reasoning).toEqual({ effort: "high", exclude: true });
    expect(payload.tools?.map((tool) => tool.function?.name)).toEqual(
      expect.arrayContaining([
        "retrieve_memory",
        "web_search",
        "create_flashcard_deck",
      ]),
    );
    expect(
      payload.tools?.some((tool) => tool.function?.name === "search_objects"),
    ).toBe(false);
    expect(payload.stream).toBe(true);
    expect(new Headers(request.headers).get("X-OpenRouter-Title")).toBe("Spectra AI Operation Engine");
    const completedCall = convexMutation.mock.calls.find(([name, args]) => String(name).includes("spectraRuns:updateStatus") && (args as { status?: string }).status === "completed");
    expect(completedCall?.[1]).toMatchObject({ providerUsed: "OpenAI", modelUsed: "openai/gpt-5.6" });
    const completedIdx = convexMutation.mock.calls.findIndex(([name, args]) => String(name).includes("spectraRuns:updateStatus") && (args as { status?: string }).status === "completed");
    const appendIdx = convexMutation.mock.calls.findIndex(([name, args]) => String(name).includes("spectraThreads:appendMessage") && (args as { role?: string }).role === "assistant");
    expect(completedIdx).toBeGreaterThan(-1);
    expect(appendIdx).toBeGreaterThan(completedIdx);
    expect(info.mock.calls.filter(([label]) => label === "[spectra.agent-loop]").map(([, entry]) => entry)).toEqual([
      { runId: "run-real", stage: "intake", status: "entered" },
      { runId: "run-real", stage: "plan", status: "entered" },
      { runId: "run-real", stage: "resolve", status: "entered" },
      { runId: "run-real", stage: "gather", status: "entered" },
      { runId: "run-real", stage: "act", status: "entered" },
      { runId: "run-real", stage: "verify", status: "entered" },
      { runId: "run-real", stage: "report", status: "entered" },
    ]);
  });

  it("reads focused content on demand before submitting a mutation plan", async () => {
    const plan = deckPlan();
    const { convexQuery, convexMutation, fetchMock } = setup(plan);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: "deepseek/deepseek-v4-pro-20260423",
            provider: "DeepSeek",
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "read-focused",
                      type: "function",
                      function: {
                        name: "read_artifact",
                        arguments: '{"artifactId":"artifact-real"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: "deepseek/deepseek-v4-pro-20260423",
            provider: "DeepSeek",
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "submit",
                      type: "function",
                      function: {
                        name: "submit_plan",
                        arguments: JSON.stringify(plan),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/spectra/run", {
        method: "POST",
        body: JSON.stringify({
          action: "run",
          surface: "artifact",
          workspaceId: "workspace-real",
          artifactId: "artifact-real",
          prompt:
            "Create a separate flashcard deck from this lesson with exactly 6 cards. Do not change this artifact.",
        }),
      }),
    );
    expect(response.status).toBe(200);
    await response.text();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      convexQuery.mock.calls.filter(([name]) =>
        String(name).includes("spectraArtifacts:get"),
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      convexMutation.mock.calls.some(([name]) =>
        String(name).includes("spectraArtifacts:finalizePending"),
      ),
    ).toBe(true);
    const secondPayload = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    ) as { messages: Array<Record<string, unknown>> };
    expect(secondPayload.messages).toContainEqual(
      expect.objectContaining({ role: "tool", tool_call_id: "read-focused" }),
    );
  });

  it("canonicalizes a plural creation placement locally without a model retry", async () => {
    const plan = deckPlan();
    const input = plan.operations[0]!.input as Record<string, unknown>;
    delete input.workspaceId;
    input.placements = [
      { workspaceId: "workspace-real", placement: "context" },
    ];
    const { convexMutation, fetchMock } = setup(plan);
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/spectra/run", {
        method: "POST",
        body: JSON.stringify({
          action: "run",
          surface: "workspace",
          workspaceId: "workspace-real",
          prompt:
            "Create a flashcard deck about photosynthesis with 6 cards. Include memory cues.",
        }),
      }),
    );
    expect(response.status).toBe(200);
    await response.text();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      convexMutation.mock.calls.some(([name]) =>
        String(name).includes("spectraArtifacts:finalizePending"),
      ),
    ).toBe(true);
  });

  it("repairs only missing outer JSON closers after a complete operation streams", async () => {
    const plan = deckPlan();
    const { convexMutation, fetchMock } = setup(plan);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ model: "deepseek/deepseek-v4-pro-20260423", provider: "DeepSeek", choices: [{ message: { content: JSON.stringify(plan).slice(0, -1) } }] }), { status: 200 }));
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "run", surface: "workspace", workspaceId: "workspace-real", prompt: "Create a flashcard deck about photosynthesis with 6 cards. Include memory cues." }) }));
    expect(response.status).toBe(200);
    await response.text();
    expect(convexMutation.mock.calls.some(([name, args]) => String(name).includes("spectraRuns:updateStatus") && (args as { status?: string }).status === "completed")).toBe(true);
  });

  it("preserves complete streamed operations when only the trailing final response string is cut off", async () => {
    const plan = deckPlan();
    const ordered = { decision: plan.decision, intent: plan.intent, conversationTitle: null, conversationSummary: null, choices: null, operations: plan.operations, finalResponse: plan.finalResponse };
    const raw = JSON.stringify(ordered);
    const truncated = raw.slice(0, raw.indexOf("Created a 6-card") + "Created a 6-card".length);
    const { convexMutation, fetchMock } = setup(plan);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ model: "deepseek/deepseek-v4-pro-20260423", provider: "DeepSeek", choices: [{ message: { content: truncated } }] }), { status: 200 }));
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "run", surface: "workspace", workspaceId: "workspace-real", prompt: "Create a flashcard deck about photosynthesis with 6 cards. Include memory cues." }) }));
    expect(response.status).toBe(200);
    await response.text();
    expect(convexMutation.mock.calls.some(([name, args]) => String(name).includes("spectraRuns:updateStatus") && (args as { status?: string }).status === "completed")).toBe(true);
  });

  it("repairs a truncated trailing clarification after an explicitly complete empty operation list", async () => {
    const plan = { decision: "clarify", intent: { mode: "create", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null }, conversationTitle: null, conversationSummary: null, choices: { question: "Which resource?", options: [{ title: "Deck", description: null }, { title: "Quiz", description: null }] }, operations: [], finalResponse: "Which study resource would you like?" };
    const raw = JSON.stringify(plan);
    const truncated = raw.slice(0, raw.indexOf("Which study resource") + "Which study resource".length);
    const { convexMutation, fetchMock } = setup(plan);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ model: "deepseek/deepseek-v4-pro-20260423", provider: "DeepSeek", choices: [{ message: { content: truncated } }] }), { status: 200 }));
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "run", surface: "chat", threadId: "thread-real", prompt: "Create a study resource." }) }));
    expect(response.status).toBe(200);
    await response.text();
    expect(convexMutation.mock.calls.some(([name, args]) => String(name).includes("spectraRuns:updateStatus") && (args as { status?: string; outcome?: string }).status === "awaiting_resolution" && (args as { outcome?: string }).outcome === "awaiting_input")).toBe(true);
  });

  it("salvages a safe zero-operation clarification when optional metadata makes the repaired partial plan invalid", async () => {
    const plan = { decision: "clarify", intent: { mode: "create", requestedArtifactTypes: ["flashcard_deck"], requestedVisibleArtifactCount: 1, targetArtifactId: null, targetWorkspaceId: null }, conversationTitle: null, conversationSummary: null, choices: null, operations: [], finalResponse: "What topic should the flashcard deck cover?" };
    const raw = JSON.stringify({ ...plan, conversationSummary: "x".repeat(500) });
    const truncated = raw.slice(0, raw.indexOf("What topic") + "What topic should the flashcard deck".length);
    const { convexMutation, fetchMock } = setup(plan);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ model: "deepseek/deepseek-v4-pro-20260423", provider: "DeepSeek", choices: [{ message: { content: truncated } }] }), { status: 200 }));
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "run", surface: "chat", threadId: "thread-real", prompt: "Flashcard deck" }) }));
    expect(response.status).toBe(200);
    await response.text();
    expect(convexMutation.mock.calls.some(([name, args]) => String(name).includes("spectraRuns:updateStatus") && (args as { status?: string; outcome?: string }).status === "awaiting_resolution" && (args as { outcome?: string }).outcome === "awaiting_input")).toBe(true);
  });

  it("answers an explicit exact-reply command without invoking the heavy planner", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const answerPlan = { decision: "answer", intent: { mode: "answer", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null }, finalResponse: "unused", operations: [] };
    const { convexMutation, fetchMock } = setup(answerPlan);
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "run", surface: "chat", prompt: "Reply with exactly: Ready." }) }));
    expect(response.status).toBe(200);
    await response.text();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(convexMutation.mock.calls.some(([name, args]) => String(name).includes("spectraRuns:updateStatus") && (args as { finalSummary?: string }).finalSummary === "Ready.")).toBe(true);
    expect(info.mock.calls.filter(([label]) => label === "[spectra.agent-loop]").map(([, entry]) => entry)).toEqual([
      { runId: "run-real", stage: "intake", status: "entered" },
      { runId: "run-real", stage: "plan", status: "entered" },
      { runId: "run-real", stage: "resolve", status: "skipped", reason: "immediate answer has no mutation stages" },
      { runId: "run-real", stage: "gather", status: "skipped", reason: "immediate answer has no mutation stages" },
      { runId: "run-real", stage: "act", status: "skipped", reason: "immediate answer has no mutation stages" },
      { runId: "run-real", stage: "verify", status: "skipped", reason: "immediate answer has no mutation stages" },
      { runId: "run-real", stage: "report", status: "entered" },
    ]);
  });

  it("answers a greeting without hydrating context or invoking the mutation planner", async () => {
    const answerPlan = { decision: "answer", intent: { mode: "answer", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null }, finalResponse: "unused", operations: [] };
    const { convexMutation, fetchMock } = setup(answerPlan);
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "run", surface: "chat", prompt: "Hi" }) }));
    expect(response.status).toBe(200);
    await response.text();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(convexMutation.mock.calls.some(([name, args]) => String(name).includes("spectraRuns:updateStatus") && (args as { finalSummary?: string }).finalSummary?.startsWith("Hi!"))).toBe(true);
  });

  it("offers immediate bounded format choices for an underspecified study resource", async () => {
    const answerPlan = { decision: "answer", intent: { mode: "answer", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null }, finalResponse: "unused", operations: [] };
    const { convexMutation, fetchMock } = setup(answerPlan);
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "run", surface: "chat", prompt: "Create a study resource for me." }) }));
    expect(response.status).toBe(200);
    await response.text();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(convexMutation.mock.calls.some(([name, args]) => String(name).includes("spectraRuns:updateStatus") && (args as { decision?: string }).decision === "clarify")).toBe(true);
  });

  it("uses the full agent-tool recovery route only after the native Luna call fails", async () => {
    const answerPlan = { decision: "answer", intent: { mode: "answer", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null }, finalResponse: "Fallback worked.", operations: [] };
    const { fetchMock } = setup(answerPlan);
    fetchMock.mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "native unavailable" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "openai/gpt-5.6", provider: "OpenAI", choices: [{ message: { content: JSON.stringify(answerPlan) } }] }), { status: 200 }));
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "run", surface: "workspace", workspaceId: "workspace-real", prompt: "Answer briefly." }) }));
    expect(response.status).toBe(200);
    await response.text();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const primary = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    const fallback = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as { provider: unknown; tools?: unknown[]; tool_choice?: unknown };
    expect(Array.isArray(primary.tools)).toBe(true);
    expect(fallback.provider).toEqual({ order: ["OpenAI"], only: ["OpenAI"], allow_fallbacks: false, require_parameters: true });
    expect(Array.isArray(fallback.tools)).toBe(true);
    expect(fallback.tool_choice).toBe("auto");
  });

  it("repairs one malformed fallback response before exposing a failure", async () => {
    const answerPlan = { decision: "answer", intent: { mode: "answer", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null }, finalResponse: "Recovered cleanly.", operations: [] };
    // Operate + empty operations is not a local coerce target (no clarifying cue),
    // so the bounded model-side repair path must recover it exactly once.
    const malformed = { ...answerPlan, decision: "operate", operations: [] };
    const { convexMutation, fetchMock } = setup(answerPlan);
    fetchMock.mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "native unavailable" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "deepseek/deepseek-v4-pro-20260423", provider: "Baidu", choices: [{ message: { content: JSON.stringify(malformed) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "deepseek/deepseek-v4-pro-20260423", provider: "Baidu", choices: [{ message: { content: JSON.stringify(answerPlan) } }] }), { status: 200 }));
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "run", surface: "workspace", workspaceId: "workspace-real", prompt: "Answer briefly." }) }));
    expect(response.status).toBe(200);
    await response.text();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const repairBody = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body)) as { messages?: Array<{ role?: string; content?: string }> };
    expect(repairBody.messages?.some((message) => message.role === "system" && String(message.content).includes("repairing a previously generated plan"))).toBe(true);
    expect(convexMutation.mock.calls.some(([name, args]) => String(name).includes("spectraRuns:updateStatus") && (args as { status?: string; finalSummary?: string }).status === "completed" && (args as { finalSummary?: string }).finalSummary === "Recovered cleanly.")).toBe(true);
  });

  it("repairs one schema-invalid primary submit_plan exactly once", async () => {
    const answerPlan = {
      decision: "answer",
      intent: { mode: "answer", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null },
      finalResponse: "Primary repair worked.",
      operations: [],
    };
    const malformed = { ...answerPlan, decision: "operate", operations: [] };
    const { convexMutation, fetchMock } = setup(answerPlan);
    fetchMock.mockReset().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as {
        messages?: Array<{ role?: string; content?: string }>;
        tools?: unknown;
      };
      const isRepair = body.messages?.some(
        (message) =>
          message.role === "system" &&
          String(message.content).includes("repairing a previously generated plan"),
      );
      if (isRepair) {
        return new Response(
          JSON.stringify({
            model: "deepseek/deepseek-v4-pro-20260423",
            provider: "DeepSeek",
            choices: [{ message: { content: JSON.stringify(answerPlan) } }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          model: "deepseek/deepseek-v4-pro-20260423",
          provider: "DeepSeek",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-plan",
                    type: "function",
                    function: {
                      name: "submit_plan",
                      arguments: JSON.stringify({ plan: malformed }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/spectra/run", {
        method: "POST",
        body: JSON.stringify({
          action: "run",
          surface: "workspace",
          workspaceId: "workspace-real",
          prompt: "Answer briefly about mitochondria.",
        }),
      }),
    );
    expect(response.status).toBe(200);
    await response.text();
    const repairCalls = fetchMock.mock.calls.filter((call) => {
      const body = JSON.parse(String((call[1] as RequestInit).body)) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      return body.messages?.some(
        (message) =>
          message.role === "system" &&
          String(message.content).includes("repairing a previously generated plan"),
      );
    });
    expect(repairCalls).toHaveLength(1);
    expect(
      convexMutation.mock.calls.some(
        ([name, args]) =>
          String(name).includes("spectraRuns:updateStatus") &&
          (args as { status?: string; finalSummary?: string }).status === "completed" &&
          (args as { finalSummary?: string }).finalSummary === "Primary repair worked.",
      ),
    ).toBe(true);
  });

  it("retries the same failed run and result card", async () => {
    const answerPlan = { decision: "answer", intent: { mode: "answer", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null }, finalResponse: "Here is the answer.", operations: [] };
    const { convexMutation } = setup(answerPlan, "failed");
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "retry", runId: "run-real", executionId: "execution-1" }) }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string; runId?: string; card?: { id: string } });

    expect(convexMutation.mock.calls.some(([name]) => String(name).includes("spectraRuns:resetForRetry"))).toBe(true);
    expect(convexMutation.mock.calls.some(([name]) => String(name).includes("spectraRuns:beginRun"))).toBe(false);
    expect(events.find((event) => event.type === "run_created")).toMatchObject({ runId: "run-real", card: { id: "card-real" } });
  });

  it("creates a durable chat thread and persists only clean user-facing messages", async () => {
    const answerPlan = { decision: "answer", intent: { mode: "answer", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null }, conversationTitle: "Photosynthesis in plain language", conversationSummary: "A simple explanation of how plants store light energy.", finalResponse: "Photosynthesis stores light energy as chemical energy.", operations: [] };
    const { convexMutation } = setup(answerPlan);
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "run", surface: "chat", workspaceId: "workspace-real", prompt: "Explain photosynthesis simply." }) }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string; threadId?: string });

    expect(events).toContainEqual(expect.objectContaining({ type: "thread_ready", threadId: "thread-real" }));
    const beginRunCall = convexMutation.mock.calls.find(([name]) => String(name).includes("spectraRuns:beginRun"));
    expect(beginRunCall?.[1]).toMatchObject({ sourceSurface: "chat", workspaceId: "workspace-real", userPrompt: "Explain photosynthesis simply." });
    const metadataCall = convexMutation.mock.calls.find(([name]) => String(name).includes("spectraThreads:applyGeneratedMetadata"));
    expect(metadataCall?.[1]).toMatchObject({ title: "Photosynthesis in plain language", summary: "A simple explanation of how plants store light energy." });
    const messageCalls = convexMutation.mock.calls.filter(([name]) => String(name).includes("spectraThreads:appendMessage"));
    expect(messageCalls.length).toBeGreaterThanOrEqual(1);
    expect(messageCalls.every(([, args]) => (args as { role?: string }).role === "assistant")).toBe(true);
    expect(messageCalls.at(-1)?.[1]).toMatchObject({ role: "assistant", content: answerPlan.finalResponse, runId: "run-real" });
    // Success-facing prose is persisted only after the plan validates. A
    // malformed or failed operation must never leave a partial success claim
    // in the canonical thread.
    expect(messageCalls.some(([, args]) => (args as { metadata?: { partial?: boolean } }).metadata?.partial === true)).toBe(false);
    expect(JSON.stringify(messageCalls)).not.toContain("Analysing request");
  });

  it("continues an older clarification by its asking execution and selected target", async () => {
    const continuationPlan = {
      decision: "operate",
      intent: {
        mode: "update",
        requestedArtifactTypes: ["document"],
        requestedVisibleArtifactCount: 1,
        targetArtifactId: "artifact-chemistry",
        targetWorkspaceId: null,
      },
      finalResponse: "Updated the selected chemistry draft.",
      operations: [{
        type: "artifact.update",
        input: {
          artifactId: "artifact-chemistry",
          blueprintKey: "document",
          title: "Lab notes — revised",
          summary: "Chemistry draft revised.",
          content: { blocks: [{ id: "p1", type: "paragraph", text: "Chemistry draft revised" }], outline: [] },
          tags: ["biology"],
        },
      }],
    };
    const { convexMutation, fetchMock, getSavedArtifact } = setup(
      continuationPlan,
      "queued",
      {
        _id: "artifact-chemistry",
        blueprintKey: "document",
        title: "Lab notes",
        summary: "Chemistry draft",
        content: { blocks: [{ id: "p1", type: "paragraph", text: "Chemistry draft" }], outline: [] },
      },
    );
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({
        action: "run",
        surface: "chat",
        threadId: "thread-real",
        artifactId: "artifact-biology",
        prompt: "Revise the selected Lab notes draft.",
        clarificationId: "clarification-A",
        choiceMessageId: "message-A",
        choiceKey: "artifact-chemistry",
        executionId: "execution-A",
      }),
    }));
    await response.text();
    const begin = convexMutation.mock.calls.find(([name]) => String(name).includes("spectraRuns:beginRun"));
    expect(begin?.[1]).toMatchObject({
      clarificationId: "clarification-A",
      clarificationMessageId: "message-A",
      clarificationExecutionId: "execution-A",
      choiceKey: "artifact-chemistry",
      artifactId: "artifact-biology",
    });
    expect(convexMutation.mock.calls.some(([name, args]) =>
      String(name).includes("spectraArtifacts:update") &&
      (args as { artifactId?: string }).artifactId === "artifact-chemistry",
    )).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
    expect(getSavedArtifact()._id).toBe("artifact-chemistry");
  });

  it("keeps the asking execution in the scheduled continuation payload", async () => {
    const answerPlan = {
      decision: "answer",
      intent: { mode: "answer", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null },
      finalResponse: "The selected draft is ready to review.",
      operations: [],
    };
    const { convexMutation, fetchMock } = setup(answerPlan);
    delete process.env.SPECTRA_TEST_INLINE_RUNS;
    process.env.SPECTRA_APP_URL = "https://spectra.example.test";
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({
        action: "run",
        surface: "chat",
        threadId: "thread-real",
        prompt: "Continue the selected draft.",
        clarificationId: "clarification-A",
        choiceMessageId: "message-A",
        choiceKey: "artifact-chemistry",
        executionId: "execution-A",
      }),
    }));
    await response.text();
    const scheduled = convexMutation.mock.calls.find(([name]) => String(name).includes("spectraRuns:scheduleExecution"));
    expect(scheduled?.[1]).toMatchObject({
      payload: expect.objectContaining({
        clarificationId: "clarification-A",
        choiceMessageId: "message-A",
        choiceKey: "artifact-chemistry",
        clarificationExecutionId: "execution-A",
      }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("settles a scheduled preflight failure as a retryable run", async () => {
    const { convexQuery, convexMutation } = setup({});
    convexQuery.mockImplementationOnce(async (name: string) => {
      if (name.includes("spectraRuns:listRunAttachments"))
        throw new Error("attachment hydration exploded");
      throw new Error(`Unexpected query: ${name}`);
    });
    vi.doMock("@clerk/backend", () => ({
      createClerkClient: () => ({
        sessions: {
          getSessionList: vi.fn().mockResolvedValue({
            data: [{ id: "session-real", lastActiveAt: 2 }],
          }),
          getToken: vi.fn().mockResolvedValue({ jwt: "worker-token" }),
        },
      }),
    }));
    vi.doMock("@/lib/convex-worker-context", () => ({
      withWorkerConvexToken: async (_token: string, work: () => Promise<unknown>) =>
        work(),
    }));
    process.env.CLERK_SECRET_KEY = "clerk-secret";
    process.env.SPECTRA_COLLAB_BRIDGE_KEY = "bridge-key-that-is-long-enough-for-tests";
    const rawBody = JSON.stringify({
      action: "scheduled_run",
      actorClerkId: "actor",
      runId: "run-real",
      resultCardId: "card-real",
      executionId: "execution-1",
      payload: { prompt: "Prepare the study guide.", surface: "chat" },
    });
    const timestamp = Date.now();
    const callbackKey = createHmac("sha256", process.env.SPECTRA_COLLAB_BRIDGE_KEY)
      .update("spectra-event-callback:v1")
      .digest("base64url");
    const digest = createHash("sha256").update(rawBody).digest("base64url");
    const signature = createHmac("sha256", callbackKey)
      .update(`${timestamp}.${digest}`)
      .digest("base64url");
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/spectra/run", {
        method: "POST",
        headers: {
          "x-spectra-scheduler-timestamp": String(timestamp),
          "x-spectra-scheduler-signature": signature,
        },
        body: rawBody,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ completed: true });
    const failure = convexMutation.mock.calls.find(
      ([name, args]) =>
        String(name).includes("spectraRuns:updateStatus") &&
        (args as { status?: string }).status === "failed",
    );
    expect(failure?.[1]).toMatchObject({
      resultTitle: "Paused",
      retryable: true,
      preservedPartial: false,
      resultActions: [
        {
          key: "retry",
          targetType: "run",
          targetId: "run-real",
        },
      ],
    });
  });

  it("sanitizes invalid operation errors before streaming them to the client", async () => {
    const invalidPlan = {
      decision: "operate",
      intent: { mode: "update", requestedArtifactTypes: ["document"], requestedVisibleArtifactCount: 0, targetArtifactId: "missing-artifact", targetWorkspaceId: null },
      finalResponse: "I could not safely update that document.",
      operations: [{
        type: "artifact.update",
        input: {
          artifactId: "missing-artifact",
          blueprintKey: "document",
          title: "Internal id leak check",
          summary: null,
          content: null,
          tags: null,
        },
      }],
    };
    setup(invalidPlan);
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({ action: "run", surface: "workspace", workspaceId: "workspace-real", prompt: "Update this document." }),
    }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string; message?: string });
    const error = events.find((event) => event.type === "error");

    expect(error?.message).toBe("Spectra could not match that request to an open or selected object. Choose the document or workspace you want to use, then try again.");
    expect(error?.message).not.toMatch(/artifactId|workspaceId|threadId|schema|JSON|Convex/i);
  });

  it("routes the target-disambiguation tool into the durable required-input choices", async () => {
    const otherArtifact = {
      _id: "artifact-other",
      blueprintKey: "document",
      title: "Respiration Analysis",
      summary: "A second respiration document.",
      content: { blocks: [{ id: "other-block", type: "paragraph", text: "Analysis" }] },
      placements: [{ workspaceId: "workspace-real", workspaceTitle: "Biology", nodeId: "node-other" }],
      updatedAt: 2,
    };
    const { convexMutation, fetchMock } = setup(
      {},
      "queued",
      {
        blueprintKey: "document",
        title: "Respiration Notes",
        content: { blocks: [{ id: "open-block", type: "paragraph", text: "Notes" }] },
      },
      [otherArtifact],
    );
    fetchMock.mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String((init as RequestInit).body)) as {
        tools?: Array<{ function?: { name?: string } }>;
      };
      expect(payload.tools?.map((tool) => tool.function?.name)).toContain("request_context_target");
      return new Response(JSON.stringify({
        model: "openai/gpt-5.6",
        provider: "OpenAI",
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: "",
            tool_calls: [{
              id: "target-choice",
              type: "function",
              function: {
                name: "request_context_target",
                arguments: JSON.stringify({
                  question: "Which respiration document should I change?",
                  candidates: [
                    { id: "artifact-real", title: "Wrong title", type: "quiz", summary: "Invented summary", workspaceTitle: "Wrong workspace" },
                    { id: "artifact-other", title: "Wrong title", type: "quiz", summary: "Invented summary", workspaceTitle: "Wrong workspace" },
                  ],
                }),
              },
            }],
          },
        }],
      }), { status: 200 });
    });
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({
        action: "run",
        surface: "artifact",
        workspaceId: "workspace-real",
        artifactId: "artifact-real",
        prompt: "Update the conclusion in my respiration work.",
      }),
    }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string });
    const assistantMessage = convexMutation.mock.calls
      .filter(([name]) => String(name).includes("spectraThreads:appendMessage"))
      .at(-1)?.[1] as { metadata?: { choices?: unknown } } | undefined;
    expect(assistantMessage?.metadata?.choices).toEqual({
      question: "Which respiration document should I change?",
      options: [
        { key: "artifact-real", title: "Respiration Notes", description: "document · Biology · A focused deck." },
        { key: "artifact-other", title: "Respiration Analysis", description: "document · Biology · A second respiration document." },
      ],
    });
    expect(convexMutation.mock.calls.some(([name, args]) =>
      String(name).includes("spectraRuns:updateStatus") &&
      (args as { decision?: string }).decision === "clarify",
    )).toBe(true);
    expect(events.some((event) => event.type === "final")).toBe(true);
  });

  it("canonicalizes operation and target id aliases without a model repair", async () => {
    const aliasedPlan = {
      decision: "operate",
      intent: { mode: "update", requestedArtifactTypes: ["flashcard_deck"], requestedVisibleArtifactCount: 0, targetArtifactId: "artifact-real", targetWorkspaceId: null },
      finalResponse: "Updated the memory cue.",
      operations: [{
        id: "artifact.update",
        input: {
          id: "artifact-real",
          contentPatch: { changes: [{ op: "replace", path: "/cards/5/hint", value: "Electron energy pumps protons to build the gradient." }] },
        },
      }],
    };
    const { convexMutation, fetchMock } = setup(aliasedPlan);
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({ action: "run", surface: "workspace", workspaceId: "workspace-real", artifactId: "artifact-real", prompt: "Improve only card six's hint." }),
    }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(convexMutation.mock.calls.some(([name]) => String(name).includes("spectraArtifacts:createPending"))).toBe(false);
    expect(convexMutation.mock.calls.some(([name]) => String(name).includes("spectraArtifacts:discardPendingForRun"))).toBe(false);
    expect(events.some((event) => event.type === "final")).toBe(true);
  });

  it("commits a validated direct focused mutation without a redundant terminal turn", async () => {
    const { convexMutation, fetchMock } = setup({});
    const operation = {
      type: "artifact.update",
      input: {
        artifactId: "artifact-real",
        blueprintKey: "flashcard_deck",
        title: null,
        summary: "Six focused memory cues for durable photosynthesis recall.",
        content: null,
        contentPatch: null,
        tags: null,
      },
    };
    fetchMock.mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String((init as RequestInit).body)) as {
        messages?: Array<{ role?: string }>;
        tools?: Array<{
          function?: {
            name?: string;
            parameters?: {
              properties?: {
                plan?: {
                  type?: string;
                  additionalProperties?: boolean;
                  oneOf?: unknown;
                };
              };
            };
          };
        }>;
        tool_choice?: unknown;
      };
      expect(payload.tools?.map((tool) => tool.function?.name)).toContain(
        "propose_operation",
      );
      const submitPlan = payload.tools?.find(
        (tool) => tool.function?.name === "submit_plan",
      );
      expect(submitPlan?.function?.parameters?.properties?.plan).toMatchObject({
        type: "object",
        additionalProperties: true,
      });
      expect(
        submitPlan?.function?.parameters?.properties?.plan?.oneOf,
      ).toBeUndefined();
      const hasObservation = payload.messages?.some(
        (message) => message.role === "tool",
      );
      expect(payload.tool_choice).toEqual(
        hasObservation
          ? "auto"
          : {
              type: "function",
              function: { name: "propose_operation" },
            },
      );
      const call = hasObservation
        ? {
            id: "submit-final",
            type: "function",
            function: {
              name: "submit_plan",
              arguments: JSON.stringify({
                plan: {
                  decision: "operate",
                  intent: {
                    mode: "update",
                    requestedArtifactTypes: ["flashcard_deck"],
                    requestedVisibleArtifactCount: 0,
                    targetArtifactId: "artifact-real",
                    targetWorkspaceId: null,
                  },
                  conversationTitle: "Recall deck summary",
                  conversationSummary: "Refined the open deck summary.",
                  choices: null,
                  progressUpdates: [],
                  operations: [],
                  finalResponse: "Updated the deck summary.",
                },
              }),
            },
          }
        : {
            id: "stage-summary",
            type: "function",
            function: {
              name: "propose_operation",
              arguments: JSON.stringify({
                workSummary: "Refining the deck's recall purpose",
                operation,
              }),
            },
          };
      return new Response(
        JSON.stringify({
          model: "deepseek/deepseek-v4-pro-20260423",
          provider: "DeepSeek",
          choices: [
            {
              finish_reason: "tool_calls",
              message: { content: "", tool_calls: [call] },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/spectra/run", {
        method: "POST",
        body: JSON.stringify({
          action: "run",
          surface: "workspace",
          workspaceId: "workspace-real",
          artifactId: "artifact-real",
          prompt:
            "Rewrite the open deck summary to better explain how its six memory cues support recall.",
        }),
      }),
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; message?: string });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const recordPlan = convexMutation.mock.calls.find(([name]) =>
      String(name).includes("spectraOperations:recordPlan"),
    );
    expect(recordPlan?.[1]).toMatchObject({ operations: [operation] });
    expect(
      events.some((event) => {
        if (event.type !== "status" && event.type !== "progress") return false;
        const text = [
          event.message,
          (event as { title?: string }).title,
          (event as { detail?: string }).detail,
        ]
          .filter(Boolean)
          .join(" ");
        return text.includes("Refining the deck's recall purpose");
      }),
    ).toBe(true);
    expect(events.some((event) => event.type === "final")).toBe(true);
  });

  it("applies an explicitly supplied focused deck hint without a model call or provisional shell", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { convexMutation, fetchMock, getSavedArtifact } = setup(deckPlan());
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({
        action: "run",
        surface: "workspace",
        workspaceId: "workspace-real",
        artifactId: "artifact-real",
        prompt: "Write a concise memory cue for only card three: Krebs makes high-energy carriers and a little ATP. Preserve every other field exactly.",
      }),
    }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(convexMutation.mock.calls.some(([name]) => String(name).includes("spectraArtifacts:createPending"))).toBe(false);
    const cards = (getSavedArtifact().content as { cards?: Array<{ hint?: string }> }).cards ?? [];
    expect(cards[2]?.hint).toBe("Krebs makes high-energy carriers and a little ATP.");
    expect(events.some((event) => event.type === "final")).toBe(true);
    expect(info.mock.calls.filter(([label]) => label === "[spectra.agent-loop]").map(([, entry]) => entry)).toEqual([
      { runId: "run-real", stage: "intake", status: "entered" },
      { runId: "run-real", stage: "plan", status: "entered" },
      { runId: "run-real", stage: "resolve", status: "entered" },
      { runId: "run-real", stage: "gather", status: "entered" },
      { runId: "run-real", stage: "act", status: "entered" },
      { runId: "run-real", stage: "verify", status: "entered" },
      { runId: "run-real", stage: "report", status: "entered" },
    ]);
  });

  it("fixes only a focused planner due time without a model round trip", async () => {
    const originalDueAt = new Date(2026, 6, 14, 12, 0, 0, 0).getTime();
    const content = {
      description: "Review the agent reliability loop.",
      dueAt: originalDueAt,
      startAt: null,
      endAt: null,
      allDay: false,
      timezone: "UTC",
      recurrence: {
        frequency: "none" as const,
        interval: 1,
        weekdays: [] as number[],
        exceptions: [] as number[],
      },
      status: "todo",
      priority: "high",
      linkedArtifactIds: [],
      linkedThreadIds: [],
      subtasks: [{ id: "step-1", title: "Verify recovery", done: false }],
      attachments: [],
      reminders: [],
      estimateMinutes: 90,
      progressNote: "Acceptance run",
      sourceRefs: [],
    };
    const { convexMutation: _convexMutation, fetchMock, getSavedArtifact } = setup({}, "queued", {
      blueprintKey: "planner_task",
      title: "Launch Agent Reliability Review",
      summary: "Planner acceptance task.",
      content,
      tags: ["reliability"],
    });
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({
        action: "run",
        surface: "workspace",
        workspaceId: "workspace-real",
        artifactId: "artifact-real",
        prompt: "Fix only the due time to 4:00 PM. Keep everything else exactly unchanged.",
      }),
    }));
    await response.text();

    expect(fetchMock).not.toHaveBeenCalled();
    const updated = getSavedArtifact().content as typeof content & {
      assignees?: unknown[];
      watchers?: unknown[];
    };
    expect(new Date(updated.dueAt!).getHours()).toBe(16);
    const { assignees: _assignees, watchers: _watchers, ...rest } = updated;
    expect({ ...rest, dueAt: originalDueAt }).toEqual(content);
  });

  it("does not let a contextual subtask mention hijack a semantic progress-note edit", async () => {
    const content = {
      description: "Review the agent reliability loop.",
      dueAt: new Date(2026, 6, 14, 16, 0, 0, 0).getTime(),
      startAt: null,
      endAt: null,
      allDay: false,
      timezone: "UTC",
      recurrence: {
        frequency: "none" as const,
        interval: 1,
        weekdays: [] as number[],
        exceptions: [] as number[],
      },
      status: "todo",
      priority: "high",
      linkedArtifactIds: [],
      linkedThreadIds: [],
      subtasks: [{ id: "step-1", title: "Verify recovery", done: false }],
      attachments: [],
      reminders: [],
      estimateMinutes: 90,
      progressNote: "Acceptance run",
      sourceRefs: [],
    };
    const { fetchMock, getSavedArtifact } = setup({}, "queued", {
      blueprintKey: "planner_task",
      title: "Launch Agent Reliability Review",
      content,
    });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      model: "deepseek/deepseek-v4-pro-20260423",
      provider: "DeepSeek",
      choices: [{
        finish_reason: "tool_calls",
        message: {
          content: "",
          tool_calls: [{
            id: "progress-note-edit",
            type: "function",
            function: {
              name: "propose_operation",
              arguments: JSON.stringify({
                workSummary: "Clarifying the next verification step",
                operation: {
                  type: "artifact.update",
                  input: {
                    artifactId: "artifact-real",
                    blueprintKey: "planner_task",
                    title: null,
                    summary: null,
                    content: null,
                    contentPatch: {
                      changes: [{
                        path: "/progressNote",
                        value: "Next (step-1): Verify recovery and communication after the remaining reliability checks.",
                      }],
                    },
                    tags: null,
                  },
                },
              }),
            },
          }],
        },
      }],
    }), { status: 200 }));
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({
        action: "run",
        surface: "workspace",
        workspaceId: "workspace-real",
        artifactId: "artifact-real",
        prompt: "Rewrite only the progress note to name the next concrete step in plain student-facing language, without any ids or codes. Base it on the six subtasks and preserve everything else.",
      }),
    }));
    await response.text();

    // "Preserve everything else" narrows the mutation; it must not be
    // mistaken for a request to change everything and trigger a long
    // discovery/submit loop after the first valid focused operation.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestPayload = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as { tool_choice?: unknown };
    expect(requestPayload.tool_choice).toEqual({
      type: "function",
      function: { name: "propose_operation" },
    });
    expect(getSavedArtifact().content).toEqual({
      ...content,
      progressNote:
        "Next: Verify recovery and communication after the remaining reliability checks.",
    });
  });

  it("keeps confirmation operations proposed until the user accepts or rejects them", async () => {
    const workspacePlan = {
      decision: "operate",
      intent: { mode: "create_workspace", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null },
      finalResponse: "I can create a workspace for the exhibition.",
      operations: [{
        type: "workspace.create",
        input: {
          title: "TOK Exhibition",
          description: "Planning and evidence for the exhibition.",
          icon: "BookOpen",
          color: null,
        },
      }],
    };
    const { convexMutation } = setup(workspacePlan);
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({ action: "run", surface: "workspace", workspaceId: "workspace-real", prompt: "Create a new TOK Exhibition workspace." }),
    }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string; card?: { actions?: Array<{ key: string }> } });

    expect(events.some((event) => event.type === "confirmation_required")).toBe(true);
    expect(events.find((event) => event.type === "confirmation_required")?.card?.actions?.map((action) => action.key)).toEqual(["confirm", "cancel"]);
    expect(convexMutation.mock.calls.some(([name]) => String(name) === "spectraWorkspaces:create")).toBe(false);

    const cancelResponse = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({ action: "cancel", runId: "run-real", executionId: "execution-1" }),
    }));
    const cancelEvents = (await cancelResponse.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string; summary?: string });
    expect(cancelEvents).toContainEqual(expect.objectContaining({ type: "final", summary: "No proposed changes were applied." }));
    expect(convexMutation.mock.calls.some(([name]) => String(name).includes("spectraRuns:rejectConfirmation"))).toBe(true);
  });

  it("journals an approved settings tool as one resumable app command", async () => {
    const plan = {
      decision: "operate",
      intent: { mode: "mixed", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null },
      finalResponse: "I can make the toolbar compact after you confirm.",
      operations: [{ type: "app.command", input: { command: "change_spectra_settings", args: { patch: { appearance: { density: "compact" } } } } }],
    };
    const { convexMutation, fetchMock } = setup(plan);
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({ action: "run", surface: "workspace", workspaceId: "workspace-real", prompt: "Make my toolbar compact." }),
    }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string; reasons?: string[] });
    expect(events.some((event) => event.type === "confirmation_required")).toBe(true);
    expect(convexMutation.mock.calls.some(([name]) => String(name).includes("accountPreferences:writeLayer"))).toBe(false);
    const recorded = convexMutation.mock.calls.find(([name]) => String(name).includes("spectraOperations:recordPlan"));
    expect(recorded?.[1]).toMatchObject({ operations: [{ type: "app.command", requiresConfirmation: true }] });

    const confirmResponse = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({ action: "confirm", runId: "run-real", executionId: "execution-1" }),
    }));
    await confirmResponse.text();
    expect(convexMutation.mock.calls.filter(([name]) => String(name).includes("accountPreferences:writeLayer"))).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("routes an open-sheet validation-column edit to sheets update, not a flashcard create", async () => {
    const sheetsContent = {
      workbook: { activeSheetId: "sheet-1" },
      sheets: [
        {
          id: "sheet-1",
          name: "Km vs Vmax",
          rowCount: 12,
          columnCount: 4,
          cells: {
            A1: { value: "Enzyme" },
            B1: { value: "Km" },
            C1: { value: "Vmax" },
            A2: { value: "Hexokinase" },
            B2: { value: 1.2 },
            C2: { value: 100 },
          },
        },
      ],
    };
    const updateOperation = {
      type: "artifact.update",
      input: {
        artifactId: "artifact-real",
        blueprintKey: "sheets",
        title: null,
        summary: null,
        content: null,
        contentPatch: {
          changes: [
            { path: "/sheets/0/cells/D1", value: "Km < 5?" },
            { path: "/sheets/0/cells/D2", value: { formula: "=IF(B2<5,\"yes\",\"no\")" } },
          ],
        },
        tags: null,
      },
    };
    const { convexMutation, fetchMock } = setup(
      {},
      "queued",
      {
        blueprintKey: "sheets",
        title: "Enzyme Km & Vmax Comparison",
        summary: "Comparison table.",
        content: sheetsContent,
      },
    );
    fetchMock.mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String((init as RequestInit).body)) as {
        tools?: Array<{
          function?: {
            name?: string;
            parameters?: {
              properties?: {
                operation?: {
                  properties?: {
                    type?: { const?: string };
                    input?: {
                      properties?: {
                        blueprintKey?: { const?: string };
                      };
                    };
                  };
                };
              };
            };
          };
        }>;
        tool_choice?: unknown;
      };
      expect(payload.tools?.map((tool) => tool.function?.name)).toContain(
        "propose_operation",
      );
      expect(
        payload.tools?.some((tool) => tool.function?.name?.startsWith("create_") && tool.function.name !== "create_calendar_personal_event"),
      ).toBe(false);
      const propose = payload.tools?.find(
        (tool) => tool.function?.name === "propose_operation",
      );
      expect(
        propose?.function?.parameters?.properties?.operation?.properties?.type
          ?.const,
      ).toBe("artifact.update");
      expect(
        propose?.function?.parameters?.properties?.operation?.properties?.input
          ?.properties?.blueprintKey?.const,
      ).toBe("sheets");
      expect(payload.tool_choice).toEqual({
        type: "function",
        function: { name: "propose_operation" },
      });
      return new Response(
        JSON.stringify({
          model: "deepseek/deepseek-v4-pro-20260423",
          provider: "DeepSeek",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "stage-sheets-column",
                    type: "function",
                    function: {
                      name: "propose_operation",
                      arguments: JSON.stringify({
                        workSummary: "Adding a Km validation column",
                        operation: updateOperation,
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/spectra/run", {
        method: "POST",
        body: JSON.stringify({
          action: "run",
          surface: "artifact",
          workspaceId: "workspace-real",
          artifactId: "artifact-real",
          // Reproduce the E-03 mis-chip: workspace focusMode with an open sheet.
          focusMode: "workspace",
          prompt:
            "add a validation column that flags whether each enzyme's Km is below 5",
        }),
      }),
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            type: string;
            preview?: { action?: string; blueprintKey?: string };
          },
      );

    expect(
      convexMutation.mock.calls.some(([name]) =>
        String(name).includes("spectraArtifacts:createPending"),
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === "operation_preview" &&
          event.preview?.action === "create",
      ),
    ).toBe(false);
    const recordPlan = convexMutation.mock.calls.find(([name]) =>
      String(name).includes("spectraOperations:recordPlan"),
    );
    expect(recordPlan?.[1]).toMatchObject({
      operations: [
        expect.objectContaining({
          type: "artifact.update",
          input: expect.objectContaining({
            artifactId: "artifact-real",
            blueprintKey: "sheets",
            contentPatch: expect.objectContaining({
              changes: expect.any(Array),
            }),
          }),
        }),
      ],
    });
    expect(events.some((event) => event.type === "final")).toBe(true);
  });

  it("keeps focused presentation slide edits on artifact.update through quiet encouragement", async () => {
    const presentationContent = {
      theme: { id: "theme-1", name: "Clean" },
      slides: [
        {
          id: "slide-1",
          title: "Agenda",
          speakerNotes: "Welcome the room.",
          objects: [
            {
              id: "obj-1",
              type: "text",
              x: 40,
              y: 40,
              width: 640,
              height: 80,
              content: { text: "Agenda" },
            },
          ],
        },
        {
          id: "slide-2",
          title: "Context",
          speakerNotes: "Set the scene.",
          objects: [
            {
              id: "obj-2",
              type: "text",
              x: 40,
              y: 40,
              width: 640,
              height: 120,
              content: { text: "Context details" },
            },
          ],
        },
        {
          id: "slide-3",
          title: "Deep dive into the cellular respiration pathway with too many words",
          speakerNotes: "Keep the speaker notes exactly.",
          objects: [
            {
              id: "obj-3",
              type: "text",
              x: 40,
              y: 40,
              width: 640,
              height: 160,
              content: {
                text: "A long-winded explanation of glycolysis, the Krebs cycle, and the electron transport chain that should become more concise.",
              },
            },
          ],
        },
      ],
    };
    const updateOperation = {
      type: "artifact.update",
      input: {
        artifactId: "artifact-real",
        blueprintKey: "presentation",
        title: null,
        summary: null,
        content: null,
        contentPatch: {
          changes: [
            {
              path: "/slides/2/title",
              value: "Cellular respiration pathway",
            },
            {
              path: "/slides/2/objects/0/content/text",
              value: "Glycolysis, Krebs, then ETC — concise.",
            },
          ],
        },
        tags: null,
      },
    };
    const { convexMutation, fetchMock } = setup(
      {},
      "queued",
      {
        blueprintKey: "presentation",
        title: "Respiration Deck",
        summary: "Three teaching slides.",
        content: presentationContent,
      },
    );
    let callCount = 0;
    fetchMock.mockImplementation(async (_url, init) => {
      callCount += 1;
      const payload = JSON.parse(String((init as RequestInit).body)) as {
        tools?: Array<{
          function?: {
            name?: string;
            parameters?: {
              properties?: {
                operation?: {
                  properties?: {
                    type?: { const?: string };
                    input?: {
                      properties?: {
                        blueprintKey?: { const?: string };
                      };
                    };
                  };
                };
              };
            };
          };
        }>;
        tool_choice?: unknown;
        response_format?: unknown;
      };
      expect(payload.response_format).toBeUndefined();
      expect(
        payload.tools?.some((tool) => tool.function?.name?.startsWith("create_") && tool.function.name !== "create_calendar_personal_event"),
      ).toBe(false);
      expect(payload.tools?.map((tool) => tool.function?.name)).toContain(
        "propose_operation",
      );
      const propose = payload.tools?.find(
        (tool) => tool.function?.name === "propose_operation",
      );
      expect(
        propose?.function?.parameters?.properties?.operation?.properties?.type
          ?.const,
      ).toBe("artifact.update");
      expect(
        propose?.function?.parameters?.properties?.operation?.properties?.input
          ?.properties?.blueprintKey?.const,
      ).toBe("presentation");
      expect(payload.tool_choice).toEqual({
        type: "function",
        function: { name: "propose_operation" },
      });
      if (callCount === 1) {
        // First agent pass returns an empty draft so quiet encouragement fires.
        return new Response(
          JSON.stringify({
            model: "deepseek/deepseek-v4-pro-20260423",
            provider: "DeepSeek",
            choices: [
              {
                finish_reason: "stop",
                message: { content: "" },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          model: "deepseek/deepseek-v4-pro-20260423",
          provider: "DeepSeek",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "stage-slide-3",
                    type: "function",
                    function: {
                      name: "propose_operation",
                      arguments: JSON.stringify({
                        workSummary: "Making slide 3 more concise",
                        operation: updateOperation,
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/spectra/run", {
        method: "POST",
        body: JSON.stringify({
          action: "run",
          surface: "artifact",
          workspaceId: "workspace-real",
          artifactId: "artifact-real",
          prompt: "make slide 3 more concise and keep the speaker notes",
        }),
      }),
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            type: string;
            preview?: { action?: string; blueprintKey?: string };
            message?: string;
          },
      );

    expect(callCount).toBe(2);
    expect(
      convexMutation.mock.calls.some(([name]) =>
        String(name).includes("spectraArtifacts:createPending"),
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === "operation_preview" &&
          event.preview?.action === "create",
      ),
    ).toBe(false);
    expect(
      events.some((event) =>
        /hollow|incomplete|empty or incomplete/i.test(event.message ?? ""),
      ),
    ).toBe(false);
    const recordPlan = convexMutation.mock.calls.find(([name]) =>
      String(name).includes("spectraOperations:recordPlan"),
    );
    expect(recordPlan?.[1]).toMatchObject({
      operations: [
        expect.objectContaining({
          type: "artifact.update",
          input: expect.objectContaining({
            artifactId: "artifact-real",
            blueprintKey: "presentation",
          }),
        }),
      ],
    });
    expect(events.some((event) => event.type === "final")).toBe(true);
  });

  it("leaves a native document unchanged when pre-commit promotion conflicts", async () => {
    const original = {
      blocks: [{ id: "p1", type: "paragraph", text: "Variable: new_name Scope: Local" }],
    };
    const { convexMutation, getSavedArtifact, materializeDocxArtifact } = setup(
      {
        decision: "operate",
        intent: {
          mode: "update",
          requestedArtifactTypes: ["document"],
          requestedVisibleArtifactCount: 0,
          targetArtifactId: "artifact-real",
          targetWorkspaceId: "workspace-real",
        },
        finalResponse: "Updated the paragraph.",
        operations: [
          {
            type: "artifact.update",
            input: {
              artifactId: "artifact-real",
              blueprintKey: "document",
              title: "Exercises",
              summary: null,
              content: {
                blocks: [
                  {
                    id: "p1",
                    type: "paragraph",
                    text: "Variable: new_name Scope: Local P5V1-NATIVE-AI-2301",
                  },
                ],
              },
              tags: null,
            },
          },
        ],
      },
      "queued",
      {
        blueprintKey: "document",
        nativeFormat: "docx",
        title: "Exercises",
        content: original,
      },
    );
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/spectra/run", {
        method: "POST",
        body: JSON.stringify({
          action: "run",
          surface: "artifact",
          workspaceId: "workspace-real",
          artifactId: "artifact-real",
          prompt: "Update this document. Append P5V1-NATIVE-AI-2301 to the paragraph.",
        }),
      }),
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; message?: string });
    expect(materializeDocxArtifact).toHaveBeenCalled();
    expect(getSavedArtifact().content).toEqual(original);
    expect(
      convexMutation.mock.calls.some(
        ([name, args]) =>
          String(name).includes("spectraArtifacts:stageAiPatch") &&
          (args as { commit?: boolean }).commit === true,
      ),
    ).toBe(false);
    expect(
      convexMutation.mock.calls.filter(([name]) =>
        String(name).includes("spectraOperations:markExecuted"),
      ),
    ).toHaveLength(0);
    expect(events.some((event) => event.type === "error" || event.type === "final")).toBe(true);
  });

  it("applies a native document update once after verified promotion", async () => {
    const original = {
      blocks: [{ id: "p1", type: "paragraph", text: "Variable: new_name Scope: Local" }],
    };
    const next = {
      blocks: [
        {
          id: "p1",
          type: "paragraph",
          text: "Variable: new_name Scope: Local P5V1-NATIVE-AI-2301",
        },
      ],
    };
    const { convexMutation, getSavedArtifact, materializeDocxArtifact } = setup(
      {
        decision: "operate",
        intent: {
          mode: "update",
          requestedArtifactTypes: ["document"],
          requestedVisibleArtifactCount: 0,
          targetArtifactId: "artifact-real",
          targetWorkspaceId: "workspace-real",
        },
        finalResponse: "Updated the paragraph.",
        operations: [
          {
            type: "artifact.update",
            input: {
              artifactId: "artifact-real",
              blueprintKey: "document",
              title: "Exercises",
              summary: null,
              content: next,
              tags: null,
            },
          },
        ],
      },
      "queued",
      {
        blueprintKey: "document",
        nativeFormat: "docx",
        title: "Exercises",
        content: original,
      },
    );
    materializeDocxArtifact.mockResolvedValue({
      state: "pending",
      requestId: "req-native",
      hash: "ee",
    });
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/spectra/run", {
        method: "POST",
        body: JSON.stringify({
          action: "run",
          surface: "artifact",
          workspaceId: "workspace-real",
          artifactId: "artifact-real",
          prompt: "Update this document. Append P5V1-NATIVE-AI-2301 to the paragraph.",
        }),
      }),
    );
    await response.text();
    expect(materializeDocxArtifact).toHaveBeenCalledTimes(1);
    expect(getSavedArtifact().content).toEqual(next);
    expect(
      convexMutation.mock.calls.filter(([name]) =>
        String(name).includes("spectraOperations:markExecuted"),
      ),
    ).toHaveLength(1);
  });
});
