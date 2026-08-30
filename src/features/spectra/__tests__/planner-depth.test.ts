import { describe, expect, it, vi } from "vitest";
import {
  capabilitiesFor,
  projectBindingsFromIr,
} from "../capabilities";
import { requireArtifactTypeManifest } from "../artifacts/registry";
import { commandContext, commandForBinding, executeCommand } from "../commands";
import { dispatchStudioCommand } from "../commands/dispatch";
import { planWorkbarOverflow } from "../components/workbar-overflow";
import type { CalendarItem } from "../calendar/domain/model";
import {
  normalizePlanContent,
  planContentSchema,
  validatePlanDependencies,
} from "../plan/model";
import {
  PLAN_DUE_REFUSAL,
  completePlanTask,
  derivePlanWorkload,
  nextPlanOccurrence,
  parsePlanDue,
  savePlanView,
  setPlanParent,
} from "../plan/operations";
import { planListView, planViewTaskIds } from "../plan/projections";

function planFixture() {
  return normalizePlanContent({
    version: 3,
    title: "Revision",
    timezone: "UTC",
    linkedArtifactIds: ["brief-1"],
    linkedThreadIds: ["thread-1"],
    source: {
      provider: "managebac",
      externalId: "assignment-legacy",
      status: "active",
      lockedFields: ["taskTitle", "description", "dueAt", "source"],
    },
    tasks: [
      {
        id: "essay",
        title: "Draft essay",
        description: "",
        status: "doing",
        priority: "high",
        labels: ["writing", "exam"],
        assignees: [{ accountId: "student-1", name: "Student" }],
        dueAt: Date.UTC(2026, 7, 31, 16),
        calendarBlockIds: ["legacy-block-that-is-not-time-truth"],
        checklist: [{ id: "outline", title: "Outline", done: true }],
        recurrence: {
          frequency: "weekly",
          interval: 1,
          weekdays: [1, 3],
          exceptions: [],
        },
        reminders: [{ id: "one-hour", minutesBefore: 60, enabled: true }],
      },
      {
        id: "read",
        title: "Read sources",
        description: "",
        status: "todo",
        priority: "medium",
        labels: ["research"],
      },
    ],
    views: [],
  });
}

function scheduledBlock(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: "calendar-block-1",
    kind: "scheduled_work_block",
    title: "Draft essay",
    startAt: 1_000,
    endAt: 5_401_000,
    allDay: false,
    timezone: "UTC",
    timePrecision: "exact",
    status: "active",
    sourceLocked: false,
    planArtifactId: "plan-1",
    planTaskId: "essay",
    linkedWorkIds: [],
    revision: 1,
    ...overrides,
  };
}

describe("P12.I5 planner depth", () => {
  it("migrates legacy/v3 plans idempotently into canonical Plan v4", () => {
    const plan = planFixture();
    expect(plan.version).toBe(4);
    expect(requireArtifactTypeManifest("planner_task").schemas.currentVersion).toBe(4);
    expect(plan.linkedArtifactIds).toEqual(["brief-1"]);
    expect(plan.linkedThreadIds).toEqual(["thread-1"]);
    expect(plan.source?.lockedFields).toEqual([
      "tasks/0/title",
      "tasks/0/description",
      "tasks/0/dueAt",
      "source",
    ]);
    expect(plan.tasks[0]).toMatchObject({
      priority: "high",
      labels: ["writing", "exam"],
      assigneeIds: ["student-1"],
      reminders: [{ minutesBefore: 60, enabled: true }],
    });
    expect(normalizePlanContent(plan)).toEqual(plan);
  });

  it("resolves only bounded natural dates from an injected clock and timezone", () => {
    const now = Date.UTC(2026, 7, 31, 10);
    expect(parsePlanDue("tomorrow at 4pm", { now, timezone: "UTC" })).toEqual({
      ok: true,
      dueAt: Date.UTC(2026, 8, 1, 16),
      precision: "time",
      label: expect.stringContaining("Sep"),
    });
    expect(parsePlanDue("09/04/2026", { now, timezone: "UTC" })).toEqual({
      ok: false,
      reason: PLAN_DUE_REFUSAL,
    });
  });

  it("advances a recurrence on the same task and records the occurrence", () => {
    const plan = planFixture();
    const completed = completePlanTask(plan, "essay", Date.UTC(2026, 7, 31, 17));
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    const task = completed.plan.tasks.find((candidate) => candidate.id === "essay")!;
    expect(completed.advanced).toBe(true);
    expect(task.id).toBe("essay");
    expect(task.dueAt).toBe(Date.UTC(2026, 8, 2, 16));
    expect(task.status).toBe("todo");
    expect(task.checklist[0]?.done).toBe(false);
    expect(task.completedOccurrences).toEqual([
      {
        completedAt: Date.UTC(2026, 7, 31, 17),
        scheduledDueAt: Date.UTC(2026, 7, 31, 16),
      },
    ]);
  });

  it("refuses completion while a dependency remains unfinished", () => {
    const plan = planFixture();
    const blocked = {
      ...plan,
      tasks: plan.tasks.map((task) =>
        task.id === "essay" ? { ...task, dependencyIds: ["read"] } : task,
      ),
    };
    expect(completePlanTask(blocked, "essay", Date.UTC(2026, 7, 31, 17))).toEqual({
      ok: false,
      reason: "Finish 1 task this depends on first.",
    });
  });

  it("skips recurrence exceptions by timezone-local date", () => {
    const timezone = "America/Los_Angeles";
    const mondayAtFour = Date.UTC(2026, 7, 31, 23);
    const wednesdayAtMidnight = Date.UTC(2026, 8, 2, 7);
    expect(
      nextPlanOccurrence(
        mondayAtFour,
        {
          frequency: "weekly",
          interval: 1,
          weekdays: [1, 3],
          exceptions: [wednesdayAtMidnight],
        },
        timezone,
      ),
    ).toBe(Date.UTC(2026, 8, 7, 23));
  });

  it("treats recurrence end dates as inclusive local calendar dates", () => {
    const timezone = "America/Los_Angeles";
    const mondayAtFour = Date.UTC(2026, 7, 31, 23);
    const wednesdayAtFour = Date.UTC(2026, 8, 2, 23);
    const wednesdayAtMidnight = Date.UTC(2026, 8, 2, 7);
    const recurrence = {
      frequency: "weekly" as const,
      interval: 1,
      weekdays: [1, 3],
      untilAt: wednesdayAtMidnight,
      exceptions: [],
    };
    expect(nextPlanOccurrence(mondayAtFour, recurrence, timezone)).toBe(
      wednesdayAtFour,
    );
    expect(nextPlanOccurrence(wednesdayAtFour, recurrence, timezone)).toBeUndefined();
  });

  it("refuses dependency and parent cycles before commit", () => {
    const plan = planFixture();
    const dependencyCycle = {
      ...plan,
      tasks: plan.tasks.map((task) =>
        task.id === "essay"
          ? { ...task, dependencyIds: ["read"] }
          : { ...task, dependencyIds: ["essay"] },
      ),
    };
    expect(() => validatePlanDependencies(dependencyCycle)).toThrow(
      "PLAN_DEPENDENCY_CYCLE",
    );
    const nested = setPlanParent(plan, "read", "essay");
    expect(() => setPlanParent(nested, "essay", "read")).toThrow(
      "PLAN_PARENT_CYCLE",
    );
  });

  it("rejects relationship cycles at the Plan schema boundary", () => {
    const plan = planFixture();
    const cyclic = {
      ...plan,
      tasks: plan.tasks.map((task) =>
        task.id === "essay"
          ? { ...task, dependencyIds: ["read"] }
          : { ...task, dependencyIds: ["essay"] },
      ),
    };
    const parsed = planContentSchema.safeParse(cyclic);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["tasks"],
          message: "Task relationships cannot contain cycles.",
        }),
      ]),
    );
  });

  it("preserves source metadata and personal overlays idempotently", () => {
    const plan = normalizePlanContent({
      ...planFixture(),
      source: {
        provider: "managebac",
        externalId: "assignment-42",
        version: "7",
        hash: "sha256:abc",
        status: "changed",
        lockedFields: ["title", "dueAt"],
      },
      personalOverlay: {
        targetDueAt: Date.UTC(2026, 8, 1, 16),
        note: "Aim to finish a day early.",
      },
    });
    expect(plan).toMatchObject({
      source: {
        provider: "managebac",
        externalId: "assignment-42",
        version: "7",
        hash: "sha256:abc",
        status: "changed",
        lockedFields: ["title", "dueAt"],
      },
      personalOverlay: {
        targetDueAt: Date.UTC(2026, 8, 1, 16),
        note: "Aim to finish a day early.",
      },
    });
    expect(normalizePlanContent(plan)).toEqual(plan);
  });

  it("restores a saved filter with list, board, and timeline task parity", () => {
    const saved = savePlanView(planFixture(), {
      id: "writing-view",
      title: "Writing",
      kind: "board",
      filters: { priorities: ["high"], labels: ["writing"] },
    });
    const filter = saved.views.find((view) => view.id === "writing-view")!.filters;
    const ids = planViewTaskIds(saved, filter);
    expect([...ids.list]).toEqual(["essay"]);
    expect([...ids.board]).toEqual(["essay"]);
    expect([...ids.timeline]).toEqual(["essay"]);
  });

  it("keeps nested tasks directly beneath their parent in List order", () => {
    const plan = planFixture();
    const read = plan.tasks.find((task) => task.id === "read")!;
    const nested = {
      ...plan,
      tasks: [
        plan.tasks.find((task) => task.id === "essay")!,
        { ...read, id: "other", title: "Unrelated task", order: 1 },
        { ...read, parentTaskId: "essay", order: 100 },
      ],
    };
    expect(
      planListView(nested).flatMap((section) =>
        section.rows.map((row) => [row.task.id, row.depth]),
      ),
    ).toEqual([
      ["essay", 0],
      ["read", 1],
      ["other", 0],
    ]);
  });

  it("derives workload only from Calendar items, never legacy block ids", () => {
    const plan = planFixture();
    expect(derivePlanWorkload(plan, [], { artifactId: "plan-1" })[0]).toMatchObject({
      task: { id: "essay" },
      scheduledMinutes: 0,
      blockCount: 0,
    });
    expect(
      derivePlanWorkload(plan, [scheduledBlock()], { artifactId: "plan-1" })[0],
    ).toMatchObject({
      task: { id: "essay" },
      scheduledMinutes: 90,
      blockCount: 1,
    });
    expect(
      derivePlanWorkload(
        plan,
        [scheduledBlock({ planArtifactId: "another-plan" })],
        { artifactId: "plan-1" },
      )[0],
    ).toMatchObject({ scheduledMinutes: 0, blockCount: 0 });
    expect(
      derivePlanWorkload(
        plan,
        [scheduledBlock({ planArtifactId: undefined })],
        { artifactId: "plan-1" },
      )[0],
    ).toMatchObject({ scheduledMinutes: 0, blockCount: 0 });
  });

  it("keeps planner capability definitions symmetric with manifest operations", () => {
    const manifest = requireArtifactTypeManifest("planner_task");
    const operations = new Set(manifest.operations);
    const planner = capabilitiesFor("planner_task");
    expect(planner.length).toBeGreaterThan(30);
    for (const definition of planner) {
      if (!definition.manifestOperation) continue;
      expect(operations.has(`planner_task.${definition.manifestOperation.replaceAll("_", ".")}`)).toBe(true);
      expect(definition.ai.description.trim()).not.toBe("");
    }
  });

  it("dispatches planner keyboard commands through the same IR binding", () => {
    const onFind = vi.fn();
    const [binding] = projectBindingsFromIr("planner_task", [
      { id: "find", label: "Find tasks", onSelect: onFind },
    ]);
    const command = commandForBinding("planner_task", binding!, 0);
    expect(command.shortcut).toBe("Mod+F");
    expect(
      executeCommand(
        command,
        commandContext("planner_task", () => true, "edit"),
        null,
      ),
    ).toBe(true);
    expect(onFind).toHaveBeenCalledOnce();

    const onStatus = vi.fn();
    const bindings = projectBindingsFromIr("planner_task", [
      { id: "task.status", label: "Status", onSelect: onStatus },
    ]);
    const params = { taskId: "essay", status: "done", completedAt: 1 };
    expect(
      dispatchStudioCommand({
        type: "planner_task",
        id: "task.status",
        bindings,
        ctx: commandContext("planner_task", () => true, "edit"),
        params,
      }),
    ).toBe(true);
    expect(onStatus).toHaveBeenCalledWith(params);
  });

  it("keeps narrow planner workbar commands reachable and in authored order", () => {
    const authored = [
      { id: "add-task", fullWidth: 92, iconWidth: 32, priority: "essential" as const },
      { id: "find", fullWidth: 76, iconWidth: 32, priority: "essential" as const },
      { id: "filters", fullWidth: 82, iconWidth: 32, priority: "essential" as const },
      { id: "import", fullWidth: 92, iconWidth: 32, priority: "secondary" as const },
      { id: "export-csv", fullWidth: 110, iconWidth: 32, priority: "advanced" as const },
    ];
    const result = planWorkbarOverflow(authored, 150);
    const reachable = authored
      .map((item) => item.id)
      .filter(
        (id) => result.visibleIds.includes(id) || result.overflowIds.includes(id),
      );
    expect(reachable).toEqual(authored.map((item) => item.id));
    expect(result.overflowIds).toEqual(
      authored
        .map((item) => item.id)
        .filter((id) => result.overflowIds.includes(id)),
    );
  });
});
