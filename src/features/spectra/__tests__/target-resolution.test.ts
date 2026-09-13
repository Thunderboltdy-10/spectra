import { describe, expect, it } from "vitest";
import {
  explicitlyNamedExistingArtifactId,
} from "@/app/api/spectra/run/loop/gather";
import { resolveCreatedArtifactDependencies } from "@/app/api/spectra/run/loop/act";
import type { buildContext } from "@/app/api/spectra/run/loop/gather";
import {
  assertCalendarActionContract,
  narrateResolvedTargets,
  promptExplicitlyTargetsFocusedArtifact,
  promptRequestsCalendarAction,
  promptRequestsNewPlannerTask,
  reconcileExplicitDocumentRegions,
  resolveArtifactTarget,
  resolvePlanArtifactTargets,
  resolveWorkspaceMention,
} from "@/app/api/spectra/run/loop/resolve";
import {
  compactCalendarForAgent,
  parseStreamedPlanText,
  safeOperationPreview,
} from "@/app/api/spectra/run/loop/plan";
import {
  parseModelOperation,
  parseSpectraPlan,
} from "@/features/spectra/operations/schema";

type Context = Awaited<ReturnType<typeof buildContext>>;

function candidate(
  id: string,
  title: string,
  blueprintKey = "document",
  updatedAt = 1,
) {
  return {
    id,
    title,
    blueprintKey,
    summary: `${title} school work`,
    updatedAt,
    placements: [
      {
        workspaceId: "workspace-1",
        workspaceTitle: "Physics",
        nodeId: `node-${id}`,
      },
    ],
  };
}

function context(
  artifacts: ReturnType<typeof candidate>[],
  focusedArtifactId: string | null,
  options?: {
    selectedArtifactIds?: string[];
    threadAttachmentArtifactId?: string | null;
  },
) {
  const focusedArtifact =
    artifacts.find((artifact) => artifact.id === focusedArtifactId) ?? null;
  return {
    workspaces: [{ id: "workspace-1", title: "Physics" }],
    threads: [],
    currentWorkspace: { id: "workspace-1", title: "Physics", items: [] },
    focusedArtifact,
    artifacts,
    conversation: [],
    currentThreadId: null,
    selectedArtifactIds: options?.selectedArtifactIds ?? [],
    focusMode: focusedArtifact ? "artifact" : "workspace",
    currentLibraryLocation: null,
    packet: {
      focusedArtifact: focusedArtifact
        ? {
            id: focusedArtifact.id,
            title: focusedArtifact.title,
            type: focusedArtifact.blueprintKey,
          }
        : null,
      workspaceIndex: artifacts.map((artifact) => ({
        id: artifact.id,
        title: artifact.title,
        type: artifact.blueprintKey,
        summary: artifact.summary,
        updatedAt: artifact.updatedAt,
        placements: artifact.placements,
      })),
      selectedObjects: [],
    },
    memoryRetrieval: null,
    retainedAgentId: null,
    threadAttachmentArtifactId: options?.threadAttachmentArtifactId ?? null,
  } as unknown as Context;
}

function updatePlan(
  artifactId: string,
  blueprintKey: "document" | "presentation" = "document",
) {
  return parseSpectraPlan({
    decision: "operate",
    intent: {
      mode: "update",
      requestedArtifactTypes: [blueprintKey],
      requestedVisibleArtifactCount: 0,
      targetArtifactId: artifactId,
      targetWorkspaceId: null,
    },
    conversationTitle: "Update school work",
    conversationSummary: "A bounded target update.",
    choices: null,
    operations: [
      {
        type: "artifact.update",
        input: {
          artifactId,
          blueprintKey,
          title: null,
          summary: "Revised",
          content: null,
          contentPatch: null,
          tags: null,
        },
      },
    ],
    finalResponse: "Updated the focused artifact.",
  });
}

describe("P4.I2 artifact target resolution", () => {
  it("keeps Calendar work-block identity ahead of noisy imported task rows", () => {
    const compact = compactCalendarForAgent({
      timezone: "UTC",
      range: { from: 1, to: 2 },
      items: Array.from({ length: 246 }, (_, index) => ({
        id: `task-${index}`,
        kind: "task",
        title: `Imported task ${index}`,
        notes: "x".repeat(800),
      })),
      scheduledWorkBlocks: [
        {
          id: "block-2",
          kind: "scheduled_work_block",
          title: "Named saved task",
          planArtifactId: "artifact-2",
          planTaskId: "task-1",
          revision: 4,
          startAt: 3,
          endAt: 4,
        },
      ],
      unscheduledTasks: [],
      partialTimeItems: [],
    }) as {
      scheduledWorkBlocks: Array<Record<string, unknown>>;
      items: Array<Record<string, unknown>>;
    };
    expect(compact.scheduledWorkBlocks).toMatchObject([
      {
        id: "block-2",
        planArtifactId: "artifact-2",
        planTaskId: "task-1",
        revision: 4,
      },
    ]);
    expect(compact.items).toHaveLength(80);
    expect(JSON.stringify(compact).length).toBeLessThan(80_000);
  });

  it("lets a unique named existing artifact override stale open focus", () => {
    expect(
      explicitlyNamedExistingArtifactId(
        "Move the V8-03 second calendar graph work block to tomorrow.",
        [
          { _id: "open", title: "V8-03 calendar graph test" },
          { _id: "target", title: "V8-03 second calendar graph" },
        ],
      ),
    ).toBe("target");
  });

  it("does not steal focus from an explicitly new artifact request", () => {
    expect(
      explicitlyNamedExistingArtifactId(
        "Create a planner task called V8-03 second calendar graph and put it on my calendar.",
        [{ _id: "target", title: "V8-03 second calendar graph" }],
      ),
    ).toBeUndefined();
  });

  it("does not guess when two owned artifacts share the named title", () => {
    expect(
      explicitlyNamedExistingArtifactId(
        "Move the Revision block tomorrow.",
        [
          { _id: "one", title: "Revision" },
          { _id: "two", title: "Revision" },
        ],
      ),
    ).toBeUndefined();
  });

  it("keeps Calendar scheduling separate from planner-task edits", () => {
    const calendarPrompt =
      "Put Evaluation of DP1 work on tomorrow morning from 09:00 to 10:00.";
    expect(promptRequestsCalendarAction(calendarPrompt)).toBe(true);
    const plannerUpdate = parseSpectraPlan({
      ...updatePlan("planner-task"),
      intent: {
        ...updatePlan("planner-task").intent,
        requestedArtifactTypes: ["planner_task"],
      },
      operations: [
        {
          type: "artifact.update",
          input: {
            artifactId: "planner-task",
            blueprintKey: "planner_task",
            title: null,
            summary: null,
            content: null,
            contentPatch: {
              changes: [{ path: "/dueAt", value: Date.now() }],
            },
            tags: null,
          },
        },
      ],
    });
    expect(() =>
      assertCalendarActionContract(plannerUpdate.operations, calendarPrompt),
    ).toThrow(/Calendar request/i);
    expect(() =>
      assertCalendarActionContract(
        plannerUpdate.operations,
        "Set the due date for tomorrow.",
      ),
    ).not.toThrow();
  });

  it("requires a real Calendar mutation when a request creates a planner task", () => {
    const create = parseModelOperation({
      type: "artifact.create",
      input: {
        blueprintKey: "planner_task",
        title: "First task",
        summary: null,
        content: {
          taskTitle: "First task",
          status: "todo",
          timezone: "UTC",
          recurrence: {
            frequency: "none",
            interval: 1,
            weekdays: [],
            exceptions: [],
          },
          subtasks: [],
        },
        tags: [],
        workspaceId: null,
        placement: "inbox",
        pinned: false,
        exclusivePin: false,
      },
    });
    const schedule = parseModelOperation({
      type: "app.command",
      input: {
        command: "calendar.schedule",
        args: {
          planArtifactId: "@created:0",
          planTaskId: null,
          taskItemId: "@created:0",
          startAt: 1_000,
          endAt: 2_000,
          timezone: "UTC",
        },
      },
    });
    const prompt = "Create First task and put it on my calendar tomorrow from 09:00 to 10:00.";
    expect(() => assertCalendarActionContract([create], prompt)).toThrow(
      /without a Calendar block/i,
    );
    expect(() => assertCalendarActionContract([create, schedule], prompt)).not.toThrow();
    const resolved = resolveCreatedArtifactDependencies(
      schedule,
      new Map([[0, "artifact-first-task"]]),
    );
    expect(resolved).toMatchObject({
      input: {
        args: {
          planArtifactId: "artifact-first-task",
          planTaskId: "task-1",
        },
      },
    });
    expect(resolved).not.toMatchObject({ input: { args: { taskItemId: expect.anything() } } });
  });

  it("does not turn an existing Calendar task into a duplicate planner create", () => {
    const existingPrompt =
      "Put V8-03 calendar graph test on my calendar tomorrow from 09:00 to 10:00.";
    expect(promptRequestsNewPlannerTask(existingPrompt)).toBe(false);
    const create = parseModelOperation({
      type: "artifact.create",
      input: {
        blueprintKey: "planner_task",
        title: "V8-03 calendar graph test",
        summary: null,
        content: {
          taskTitle: "V8-03 calendar graph test",
          status: "todo",
          timezone: "UTC",
          recurrence: {
            frequency: "none",
            interval: 1,
            weekdays: [],
            exceptions: [],
          },
          subtasks: [],
        },
        tags: [],
        workspaceId: null,
        placement: "inbox",
        pinned: false,
        exclusivePin: false,
      },
    });
    expect(() => assertCalendarActionContract([create], existingPrompt)).toThrow(
      /existing work/i,
    );
  });

  it("resolves the longest owned workspace title from natural placement language", () => {
    expect(
      resolveWorkspaceMention("Put the guide in Chemistry Lab.", [
        { id: "lab", title: "Lab" },
        { id: "chemistry", title: "Chemistry Lab" },
      ]),
    ).toBe("chemistry");
  });

  it("redirects a wrong focused plan to the explicitly named similar artifact", () => {
    const artifacts = Array.from({ length: 12 }, (_, index) =>
      candidate(
        `pendulum-${index}`,
        `Pendulum IA ${index + 1}`,
        "document",
        index + 1,
      ),
    );
    const result = resolvePlanArtifactTargets(
      updatePlan("pendulum-0"),
      context(artifacts, "pendulum-0"),
      "Rewrite the conclusion in Pendulum IA 10 and preserve its data table.",
    );
    expect(result.plan.decision).toBe("operate");
    expect(result.plan.operations[0]).toMatchObject({
      type: "artifact.update",
      input: { artifactId: "pendulum-9" },
    });
    expect(result.targetResolutions[0]).toMatchObject({
      status: "resolved",
      resolvedArtifactId: "pendulum-9",
      resolvedTitle: "Pendulum IA 10",
    });
  });

  it("resolves a named cross-type target instead of the open document", () => {
    const artifacts = [
      candidate("open-doc", "Respiration Notes", "document"),
      candidate("target-deck", "Respiration Seminar", "presentation", 2),
    ];
    const ctx = context(artifacts, "open-doc");
    expect(
      promptExplicitlyTargetsFocusedArtifact(
        "Make slide 3 in Respiration Seminar more concise.",
        ctx.packet,
      ),
    ).toBe(false);
    const result = resolvePlanArtifactTargets(
      updatePlan("open-doc", "presentation"),
      ctx,
      "Make slide 3 in Respiration Seminar more concise.",
    );
    expect(result.plan.operations[0]).toMatchObject({
      input: { artifactId: "target-deck", blueprintKey: "presentation" },
    });
  });

  it("resolves a named cross-type archive without trusting the modeled type", () => {
    const artifacts = [
      candidate("open-doc", "Respiration Notes", "document"),
      candidate("target-deck", "Respiration Seminar", "presentation", 2),
    ];
    const result = resolvePlanArtifactTargets(
      parseSpectraPlan({
        decision: "operate",
        intent: {
          mode: "archive",
          requestedArtifactTypes: ["document"],
          requestedVisibleArtifactCount: 0,
          targetArtifactId: "open-doc",
          targetWorkspaceId: null,
        },
        choices: null,
        operations: [
          {
            type: "artifact.archive",
            input: { artifactId: "open-doc" },
          },
        ],
        finalResponse: "Archived the open document.",
      }),
      context(artifacts, "open-doc"),
      "Archive Respiration Seminar.",
    );
    expect(result.plan.operations[0]).toMatchObject({
      input: { artifactId: "target-deck" },
    });
  });

  it("asks through bounded choices when duplicate titles are genuinely ambiguous", () => {
    const artifacts = [
      candidate("essay-a", "Physics Essay", "document", 2),
      candidate("essay-b", "Physics Essay", "document", 1),
      candidate("essay-open", "Physics Notes", "document", 3),
    ];
    const result = resolvePlanArtifactTargets(
      updatePlan("essay-open"),
      context(artifacts, "essay-open"),
      "Rewrite the introduction in Physics Essay.",
    );
    expect(result.plan.decision).toBe("clarify");
    expect(result.plan.operations).toEqual([]);
    const choices = result.plan.choices;
    if (!choices || !("options" in choices))
      throw new Error("Expected one bounded target-choice question.");
    expect(choices.options).toHaveLength(2);
    expect(choices.options.map((option) => option.title)).toEqual(
      expect.arrayContaining([
        "Physics Essay (copy 1)",
        "Physics Essay (copy 2)",
      ]),
    );
  });

  it("uses visible focus only for an explicit deictic edit", () => {
    const artifacts = [
      candidate("open", "Current Lab Notes", "document"),
      candidate("other", "Other Lab Notes", "document", 2),
    ];
    const resolution = resolveArtifactTarget({
      prompt: "Update this document's summary.",
      reference: "open",
      blueprintKey: "document",
      role: "update",
      candidates: artifacts,
      focusedArtifactId: "open",
    });
    expect(resolution).toMatchObject({
      status: "resolved",
      resolvedArtifactId: "open",
    });
  });

  it("does not treat the only owned artifact as a fallback for an ungrounded id", () => {
    const artifacts = [candidate("only", "Only Lab Notes", "document")];
    expect(() =>
      resolvePlanArtifactTargets(
        updatePlan("invented-id"),
        context(artifacts, null),
        "Improve my work.",
      ),
    ).toThrow(/target could not be resolved/i);
  });

  it("keeps a thread attachment as a prior that cannot beat a named target", () => {
    const artifacts = [
      candidate("attached", "Old Thread Draft", "document", 3),
      candidate("named", "Final Thread Draft", "document", 2),
    ];
    const result = resolvePlanArtifactTargets(
      updatePlan("attached"),
      context(artifacts, null, {
        threadAttachmentArtifactId: "attached",
      }),
      "Update Final Thread Draft with the new conclusion.",
    );
    expect(result.plan.operations[0]).toMatchObject({
      input: { artifactId: "named" },
    });
  });

  it("resolves both named sides of a link without confusing their roles", () => {
    const artifacts = [
      candidate("outline", "Respiration Outline", "document"),
      candidate("deck", "Respiration Seminar", "presentation", 2),
    ];
    const result = resolvePlanArtifactTargets(
      parseSpectraPlan({
        decision: "operate",
        intent: {
          mode: "link",
          requestedArtifactTypes: [],
          requestedVisibleArtifactCount: 0,
          targetArtifactId: null,
          targetWorkspaceId: "workspace-1",
        },
        choices: null,
        operations: [
          {
            type: "artifact.link",
            input: {
              sourceArtifactId: "outline",
              targetArtifactId: "deck",
              relationType: "supports",
              label: null,
              explanation: null,
              workspaceId: "workspace-1",
            },
          },
        ],
        finalResponse: "Linked the two artifacts.",
      }),
      context(artifacts, null),
      "Link Respiration Outline to Respiration Seminar.",
    );
    expect(result.plan.operations[0]).toMatchObject({
      input: {
        sourceArtifactId: "outline",
        targetArtifactId: "deck",
      },
    });
    expect(result.targetResolutions).toHaveLength(2);
    expect(
      result.targetResolutions.every((target) => target.status === "resolved"),
    ).toBe(true);
  });

  it("keeps a prior created-artifact dependency as a resolved link target", () => {
    const artifacts = [
      candidate("deck", "Respiration Seminar", "presentation", 2),
    ];
    const result = resolvePlanArtifactTargets(
      parseSpectraPlan({
        decision: "operate",
        intent: {
          mode: "mixed",
          requestedArtifactTypes: ["document"],
          requestedVisibleArtifactCount: 1,
          targetArtifactId: null,
          targetWorkspaceId: "workspace-1",
        },
        choices: null,
        operations: [
          {
            type: "artifact.create",
            input: {
              blueprintKey: "document",
              title: "Respiration Questions",
              summary: "Seminar questions",
              content: { blocks: [] },
              tags: [],
              workspaceId: "workspace-1",
              placement: "context",
            },
          },
          {
            type: "artifact.link",
            input: {
              sourceArtifactId: "@created:0",
              targetArtifactId: "deck",
              relationType: "supports",
              label: null,
              explanation: null,
              workspaceId: "workspace-1",
            },
          },
        ],
        finalResponse: "Created and linked the questions.",
      }),
      context(artifacts, null),
      "Create Respiration Questions and link it to Respiration Seminar.",
    );
    expect(result.plan.operations[1]).toMatchObject({
      input: {
        sourceArtifactId: "@created:0",
        targetArtifactId: "deck",
      },
    });
    expect(result.targetResolutions[0]).toMatchObject({
      status: "resolved",
      resolvedArtifactId: "@created:0",
      resolvedTitle: "Respiration Questions",
    });
  });

  it("canonicalizes a document region against the resolved target, not focus", () => {
    const open = {
      ...candidate("open", "Open Notes"),
      content: {
        blocks: [
          { id: "open-heading", type: "heading", text: "Analysis" },
          { id: "open-body", type: "paragraph", text: "Open body" },
        ],
      },
    };
    const target = {
      ...candidate("target", "Target Notes", "document", 2),
      content: {
        blocks: [
          { id: "intro", type: "paragraph", text: "Intro" },
          { id: "target-heading", type: "heading", text: "Analysis" },
          { id: "target-body", type: "paragraph", text: "Target body" },
        ],
      },
    };
    const plan = parseSpectraPlan({
      ...updatePlan("target"),
      operations: [
        {
          type: "artifact.update",
          input: {
            artifactId: "target",
            blueprintKey: "document",
            title: null,
            summary: null,
            content: null,
            contentPatch: {
              changes: [{ path: "/blocks/1/text", value: "Clearer body" }],
            },
            tags: null,
          },
        },
      ],
    });
    const reconciled = reconcileExplicitDocumentRegions(
      plan,
      'Replace the first paragraph under "Analysis" with: "Clearer body"',
      context([open, target], "open"),
    );
    expect(
      reconciled.operations[0]?.type === "artifact.update"
        ? reconciled.operations[0].input.contentPatch?.changes
        : [],
    ).toEqual([{ path: "/blocks/2/text", value: "Clearer body" }]);
  });

  it("names the resolved target in narration and operation previews", () => {
    const plan = narrateResolvedTargets(updatePlan("target"), [
      {
        role: "update",
        requestedReference: "target",
        blueprintKey: "document",
        status: "resolved",
        confidence: 1,
        resolvedArtifactId: "target",
        resolvedTitle: "Target Notes",
        candidates: [],
      },
    ]);
    expect(plan.finalResponse).toContain("Target Notes");
    expect(plan.finalResponse).not.toMatch(/focused artifact/i);
    expect(
      safeOperationPreview(plan.operations[0]!, "Target Notes"),
    ).toMatchObject({ title: "Updating Target Notes", targetId: "target" });
  });

  it("normalizes a flattened streamed calendar command into executable args", () => {
    const plan = parseStreamedPlanText(
      JSON.stringify({
        decision: "operate",
        intent: {
          mode: "mixed",
          requestedArtifactTypes: [],
          requestedVisibleArtifactCount: 0,
          targetArtifactId: null,
          targetWorkspaceId: null,
        },
        conversationTitle: "Calendar scheduling",
        conversationSummary: "Schedule a saved planner task.",
        choices: null,
        operations: [
          {
            type: "app.command",
            input: {
              command: "calendar.schedule",
              planArtifactId: "@created:0",
              planTaskId: null,
              taskItemId: "@created:0",
              startAt: 1000,
              endAt: 2000,
              timezone: "UTC",
            },
          },
        ],
        finalResponse: "Scheduled the task.",
      }),
    );
    expect(plan.operations[0]).toMatchObject({
      type: "app.command",
      input: {
        command: "calendar.schedule",
        args: {
          planArtifactId: "@created:0",
          planTaskId: null,
          taskItemId: "@created:0",
          startAt: 1000,
          endAt: 2000,
          timezone: "UTC",
        },
      },
    });
  });
});
