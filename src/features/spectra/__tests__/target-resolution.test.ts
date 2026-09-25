import { describe, expect, it } from "vitest";
import {
  explicitArtifactIdsFromPrompt,
  explicitlyNamedExistingArtifactId,
} from "@/app/api/spectra/run/loop/gather";
import { resolveCreatedArtifactDependencies } from "@/app/api/spectra/run/loop/act";
import type { buildContext } from "@/app/api/spectra/run/loop/gather";
import {
  assertCalendarActionContract,
  narrateResolvedTargets,
  promptExplicitlyTargetsFocusedArtifact,
  promptPlacesIntoWorkspace,
  promptRequestsCalendarAction,
  promptRequestsNewPlannerTask,
  reconcileExplicitRequestContract,
  reconcileExplicitDocumentRegions,
  resolveArtifactTarget,
  resolvePlanArtifactTargets,
  resolveWorkspaceMention,
  toolFulfillsEntireRequest,
  applicationToolMayCompleteRequest,
} from "@/app/api/spectra/run/loop/resolve";
import { compactOperationsRemappingCreated } from "@/features/spectra/operations/schema";
import {
  compactCalendarForAgent,
  parseStreamedPlanText,
  safeOperationPreview,
} from "@/app/api/spectra/run/loop/plan";
import {
  parseModelOperation,
  parseSpectraPlan,
} from "@/features/spectra/operations/schema";
import { validatePlanAgainstIntent } from "@/features/spectra/operations/validate-plan";

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
  it("recognizes exact user-named artifact ids without treating run ids as artifacts", () => {
    expect(
      explicitArtifactIdsFromPrompt(
        "Update wx76vwa1ttg0p5vccm7m3h8ry98f1718 and wx71ayyqjky5hqv5sr200mp9s58f1fj7 in thread y579h3ry6wwa0yk8czce64agsh8f012q for run wh72nexx212zaxd0ppvw8kvnxh8f0myt.",
      ),
    ).toEqual([
      "wx76vwa1ttg0p5vccm7m3h8ry98f1718",
      "wx71ayyqjky5hqv5sr200mp9s58f1fj7",
    ]);
  });

  it("retains each bounded Calendar page and exact off-range targets for the next model read", () => {
    const compact = compactCalendarForAgent({
      range: { from: 1, to: 2 },
      items: Array.from({ length: 100 }, (_, index) => ({ id: `event-${index}`, kind: "personal_event", title: `Event ${index}` })),
      targetedItems: [{ id: "distant-block", kind: "scheduled_work_block", title: "Distant", revision: 3 }],
      pagination: { visible: "next-page" },
    }) as { items: unknown[]; targetedItems: unknown[]; pagination: unknown };
    expect(compact.items).toHaveLength(100);
    expect(compact.targetedItems).toMatchObject([{ id: "distant-block", revision: 3 }]);
    expect(compact.pagination).toEqual({ visible: "next-page" });
  });
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
      coverage: Record<string, unknown>;
      counts: Record<string, unknown>;
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
    expect(compact.coverage).toMatchObject({
      complete: false,
      truncatedVisibleItems: true,
      rangeBounded: true,
    });
    expect(compact.counts).toMatchObject({
      visibleItems: 246,
      returnedVisibleItems: 80,
      scheduledWorkBlocks: 1,
    });
    expect(JSON.stringify(compact).length).toBeLessThan(80_000);
  });

  it("does not treat an empty range-bounded overview as complete calendar truth", () => {
    const compact = compactCalendarForAgent({
      timezone: "UTC",
      range: { from: 1_000, to: 2_000 },
      items: [],
      scheduledWorkBlocks: [],
      unscheduledTasks: [],
      partialTimeItems: [
        {
          id: "deadline-1",
          kind: "official_deadline",
          title: "Unknown-time deadline",
          timePrecision: "unknown",
        },
      ],
      sourceState: { kind: "not_connected" },
      migration: { complete: false, partial: true, migratedArtifacts: 0, migratedEvents: 0, skippedEvents: 1 },
    }) as {
      coverage: Record<string, unknown>;
      counts: Record<string, unknown>;
      partialTimeItems: unknown[];
      migration: Record<string, unknown>;
    };
    expect(compact.coverage.complete).toBe(false);
    expect(compact.coverage.rangeBounded).toBe(true);
    expect(compact.coverage.emptyIsNotComplete).toMatch(/empty items array/i);
    expect(compact.counts).toMatchObject({
      visibleItems: 0,
      returnedVisibleItems: 0,
      partialTimeItems: 1,
    });
    expect(compact.partialTimeItems).toHaveLength(1);
    expect(compact.migration.partial).toBe(true);
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

  it("keeps multi-target updates valid after resolving each owned artifact", () => {
    const artifacts = [
      candidate("guide-a", "Urban Heat Guide", "document"),
      candidate("deck-b", "Urban Heat Presentation", "presentation", 2),
    ];
    const guide = updatePlan("guide-a", "document");
    const deck = updatePlan("deck-b", "presentation");
    const plan = parseSpectraPlan({
      ...guide,
      intent: {
        ...guide.intent,
        requestedArtifactTypes: ["document", "presentation"],
        targetArtifactId: null,
      },
      operations: [guide.operations[0], deck.operations[0]],
      finalResponse: "Updated the guide and presentation.",
    });
    const artifactBlueprints = new Map([
      ["guide-a", "document"],
      ["deck-b", "presentation"],
    ] as const);
    const resolved = resolvePlanArtifactTargets(
      plan,
      context(artifacts, null, { selectedArtifactIds: ["guide-a", "deck-b"] }),
      "Update guide-a and deck-b in place.",
    ).plan;

    expect(resolved.operations.map((operation) =>
      operation.type === "artifact.update" ? operation.input.artifactId : null,
    )).toEqual(["guide-a", "deck-b"]);
    expect(resolved.intent.targetArtifactId).toBeNull();
    expect(() =>
      validatePlanAgainstIntent(resolved, {
        artifactIds: new Set(["guide-a", "deck-b"]),
        artifactBlueprints,
        workspaceIds: new Set(),
        placementNodes: new Map(),
      }),
    ).not.toThrow();
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
    const basePlan = updatePlan("essay-open");
    const result = resolvePlanArtifactTargets(
      parseSpectraPlan({
        ...basePlan,
        intent: {
          ...basePlan.intent,
          obligations: [
            {
              id: "revise-introduction",
              description: "Revise the requested introduction.",
              operationIndexes: [0],
            },
          ],
        },
      }),
      context(artifacts, "essay-open"),
      "Rewrite the introduction in Physics Essay.",
    );
    expect(result.plan.decision).toBe("clarify");
    expect(result.plan.operations).toEqual([]);
    expect(result.plan.intent.obligations).toBeUndefined();
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

  it("remaps retained obligations when explicit request reconciliation filters an update", () => {
    const plan = parseSpectraPlan({
      decision: "operate",
      intent: {
        mode: "mixed",
        requestedArtifactTypes: ["document"],
        requestedVisibleArtifactCount: 1,
        targetArtifactId: null,
        targetWorkspaceId: null,
        obligations: [
          {
            id: "forbidden-update",
            description: "Edit the original document.",
            operationIndexes: [0],
          },
          {
            id: "new-document",
            description: "Create the separate study draft.",
            operationIndexes: [1],
          },
        ],
      },
      operations: [
        {
          type: "artifact.update",
          input: {
            artifactId: "original-doc",
            blueprintKey: "document",
            title: null,
            summary: "Unrequested edit",
            content: null,
            contentPatch: null,
            tags: null,
          },
        },
        {
          type: "artifact.create",
          input: {
            blueprintKey: "document",
            title: "Study draft",
            summary: null,
            content: {
              blocks: [{ id: "p1", type: "paragraph", text: "New draft" }],
              outline: [],
            },
            tags: [],
            workspaceId: null,
            placement: "inbox",
            pinned: false,
            exclusivePin: false,
          },
        },
      ],
      finalResponse: "Created a study draft and updated the original.",
    });

    const reconciled = reconcileExplicitRequestContract(
      plan,
      'Create a separate document named "Study draft" and do not edit the original document.',
    );
    expect(reconciled.operations.map((operation) => operation.type)).toEqual([
      "artifact.create",
    ]);
    expect(reconciled.intent.obligations?.map((entry) => [entry.id, entry.operationIndexes])).toEqual([
      ["new-document", [0]],
    ]);
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

  it("uses the explicitly open artifact to disambiguate duplicate titles", () => {
    const duplicates = [
      candidate("open-essay", "Physics Essay", "document", 2),
      candidate("other-essay", "Physics Essay", "document", 1),
    ];
    const resolution = resolveArtifactTarget({
      prompt: "Append one paragraph to the currently open Physics Essay.",
      reference: "Physics Essay",
      blueprintKey: "document",
      role: "update",
      candidates: duplicates,
      focusedArtifactId: "open-essay",
    });
    expect(resolution).toMatchObject({
      status: "resolved",
      resolvedArtifactId: "open-essay",
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


  it("does not treat a slide move as a Calendar request", () => {
    expect(
      promptRequestsCalendarAction("Move the slide 2 heading above the diagram."),
    ).toBe(false);
    expect(
      promptRequestsCalendarAction(
        "Put Evaluation of DP1 work on tomorrow morning from 09:00 to 10:00.",
      ),
    ).toBe(true);
  });

  it("allows a planner note update when paired with a Calendar schedule", () => {
    const update = parseModelOperation({
      type: "artifact.update",
      input: {
        artifactId: "planner-task",
        blueprintKey: "planner_task",
        title: null,
        summary: null,
        content: null,
        contentPatch: {
          changes: [{ path: "/notes", value: "Bring the IA rubric" }],
        },
        tags: null,
      },
    });
    const schedule = parseModelOperation({
      type: "app.command",
      input: {
        command: "calendar.schedule",
        args: {
          planArtifactId: "planner-task",
          planTaskId: "task-1",
          taskItemId: null,
          startAt: 1_000,
          endAt: 2_000,
          timezone: "UTC",
        },
      },
    });
    const prompt =
      "Update the note on Evaluation of DP1 work and schedule it tomorrow from 09:00 to 10:00.";
    expect(promptRequestsCalendarAction(prompt)).toBe(true);
    expect(() => assertCalendarActionContract([update], prompt)).toThrow(
      /Calendar request/i,
    );
    expect(() =>
      assertCalendarActionContract([update, schedule], prompt),
    ).not.toThrow();
  });

  it("does not rewrite create destinations from a source-only workspace mention", () => {
    expect(
      promptPlacesIntoWorkspace(
        "Create a guide from Chemistry Lab notes for tomorrow.",
        "Chemistry Lab",
      ),
    ).toBe(false);
    expect(
      resolveWorkspaceMention(
        "Create a guide from Chemistry Lab notes for tomorrow.",
        [
          { id: "lab", title: "Chemistry Lab" },
          { id: "bio", title: "Biology" },
        ],
        { requireDestinationLanguage: true },
      ),
    ).toBeUndefined();
    expect(
      resolveWorkspaceMention(
        "Put the guide in Chemistry Lab.",
        [
          { id: "lab", title: "Chemistry Lab" },
          { id: "bio", title: "Biology" },
        ],
        { requireDestinationLanguage: true },
      ),
    ).toBe("lab");
  });

  it("keeps the agent loop open after the first tool on multi-obligation prompts", () => {
    expect(
      toolFulfillsEntireRequest(
        "Schedule the essay block tomorrow at 09:00 and then open the study guide.",
        "schedule_calendar_task",
      ),
    ).toBe(false);
    expect(
      toolFulfillsEntireRequest(
        "Schedule two distinct blocks for the IA and the quiz tomorrow.",
        "schedule_calendar_task",
      ),
    ).toBe(false);
    expect(
      toolFulfillsEntireRequest(
        "Put Evaluation of DP1 work on tomorrow morning from 09:00 to 10:00.",
        "schedule_calendar_task",
      ),
    ).toBe(true);
    expect(
      toolFulfillsEntireRequest(
        "Insert a reference to the reading and then summarize it.",
        "insert_reference",
      ),
    ).toBe(false);
  });

  it("remaps @created dependencies after dropped operations", () => {
    const createA = parseModelOperation({
      type: "artifact.create",
      input: {
        blueprintKey: "document",
        title: "Guide A",
        summary: "A",
        content: { blocks: [{ id: "b1", type: "paragraph", text: "A" }], outline: [] },
        tags: [],
        workspaceId: "workspace-1",
        placement: "context",
        pinned: false,
        exclusivePin: false,
      },
    });
    const refresh = parseModelOperation({
      type: "app.command",
      input: {
        command: "trigger_managebac_sync",
        args: {},
      },
    });
    const createB = parseModelOperation({
      type: "artifact.create",
      input: {
        blueprintKey: "document",
        title: "Guide B",
        summary: "B",
        content: { blocks: [{ id: "b2", type: "paragraph", text: "B" }], outline: [] },
        tags: [],
        workspaceId: "workspace-1",
        placement: "context",
        pinned: false,
        exclusivePin: false,
      },
    });
    const link = parseModelOperation({
      type: "artifact.link",
      input: {
        sourceArtifactId: "@created:2",
        targetArtifactId: "@created:0",
        relationType: "supports",
        label: null,
        explanation: null,
        workspaceId: "workspace-1",
      },
    });
    const compacted = compactOperationsRemappingCreated(
      [createA, refresh, createB, link],
      (operation) =>
        !(
          operation.type === "app.command" &&
          operation.input.command === "trigger_managebac_sync"
        ),
    );
    expect(compacted).toHaveLength(3);
    expect(compacted[2]).toMatchObject({
      input: {
        sourceArtifactId: "@created:1",
        targetArtifactId: "@created:0",
      },
    });
    const plan = parseSpectraPlan({
      decision: "operate",
      intent: {
        mode: "mixed",
        requestedArtifactTypes: ["document"],
        requestedVisibleArtifactCount: 2,
        targetArtifactId: null,
        targetWorkspaceId: "workspace-1",
      },
      choices: null,
      operations: [
        {
          type: "app.command",
          input: { command: "trigger_managebac_sync", args: {} },
        },
        {
          type: "app.command",
          input: { command: "trigger_managebac_sync", args: {} },
        },
        {
          type: "artifact.create",
          input: {
            blueprintKey: "document",
            title: "After refresh",
            summary: "x",
            content: { blocks: [{ id: "b", type: "paragraph", text: "x" }], outline: [] },
            tags: [],
            workspaceId: "workspace-1",
            placement: "context",
          },
        },
        {
          type: "artifact.link",
          input: {
            sourceArtifactId: "@created:2",
            targetArtifactId: "deck",
            relationType: "supports",
            label: null,
            explanation: null,
            workspaceId: "workspace-1",
          },
        },
      ],
      finalResponse: "Refreshed once and linked.",
    });
    expect(plan.operations).toHaveLength(3);
    expect(plan.operations[2]).toMatchObject({
      input: { sourceArtifactId: "@created:1" },
    });
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

  it("rejects slide ordinal negatives that must not become Calendar", () => {
    expect(
      promptRequestsCalendarAction("Move slide 12 of the deck above the figure."),
    ).toBe(false);
    expect(
      promptRequestsCalendarAction("Resize presentation slide 3 heading."),
    ).toBe(false);
    expect(
      promptRequestsCalendarAction("Put the block on Friday at 3 pm."),
    ).toBe(true);
  });

  it("keeps Unicode source mentions from becoming destinations and refuses duplicate titles", () => {
    expect(
      promptPlacesIntoWorkspace(
        "Create a guide from Química Lab notes for tomorrow.",
        "Química Lab",
      ),
    ).toBe(false);
    expect(
      resolveWorkspaceMention(
        "Put the guide in Química Lab.",
        [
          { id: "lab-a", title: "Química Lab" },
          { id: "lab-b", title: "Quimica Lab" },
        ],
        { requireDestinationLanguage: true },
      ),
    ).toBeUndefined();
    expect(
      resolveWorkspaceMention(
        "Put the guide in Química Lab.",
        [{ id: "lab-a", title: "Química Lab" }],
        { requireDestinationLanguage: true },
      ),
    ).toBe("lab-a");
  });

  it("does not treat a queued reference insert as request completion", () => {
    expect(
      applicationToolMayCompleteRequest(
        "Insert a reference to the reading.",
        "insert_reference",
        { status: 0, ok: true, data: { status: "queued_refresh" } },
      ),
    ).toBe(false);
    expect(
      applicationToolMayCompleteRequest(
        "Insert a reference to the reading.",
        "insert_reference",
        { status: 0, ok: true, data: { status: "verified_native_write" } },
      ),
    ).toBe(true);
  });

  it("treats personal-event create as a Calendar write that can complete a sole Add-event request", () => {
    expect(
      toolFulfillsEntireRequest(
        "Add a personal event called Study hall tomorrow at 3pm",
        "create_calendar_personal_event",
      ),
    ).toBe(true);
    expect(
      toolFulfillsEntireRequest(
        "Create a verification note and add a calendar event for the review",
        "create_calendar_personal_event",
      ),
    ).toBe(false);
  });

});
