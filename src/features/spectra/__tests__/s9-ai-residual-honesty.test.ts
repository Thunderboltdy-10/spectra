import { describe, expect, it, vi } from "vitest";
import {
  calendarSemanticAction,
  calendarUndoInverse,
  interpretCalendarMutationResult,
  isCalendarMutationCommand,
  normalizeCalendarCommand,
} from "../calendar/domain/command";
import { evaluateApplicationAuthority } from "../ai/authority-execution";
import { spectraToolExecutor } from "../tools/execution/tool-executor";
import { spectraToolRegistry } from "../tools/registry";

describe("S9-AI residual honesty (Calendar / authority / approval)", () => {
  it("normalizes legacy Calendar aliases onto one operation identity", () => {
    expect(normalizeCalendarCommand("calendar.scheduleTask")).toBe(
      "schedule_calendar_task",
    );
    expect(normalizeCalendarCommand("calendar.move_work_block")).toBe(
      "move_calendar_block",
    );
    expect(isCalendarMutationCommand("calendar.resize")).toBe(true);
    expect(isCalendarMutationCommand("navigate_spectra")).toBe(false);
  });

  it("interprets schedule results with shared postcondition and undo identity", () => {
    const action = calendarSemanticAction("schedule_calendar_task", {
      planArtifactId: "planner-1",
      planTaskId: "task-1",
      startAt: 1000,
      endAt: 2000,
      timezone: "UTC",
    });
    const { item } = interpretCalendarMutationResult(action, {
      id: "block-1",
      kind: "scheduled_work_block",
      title: "Essay",
      startAt: 1000,
      endAt: 2000,
      allDay: false,
      timezone: "UTC",
      timePrecision: "exact",
      status: "active",
      sourceLocked: false,
      planArtifactId: "planner-1",
      planTaskId: "task-1",
      linkedWorkIds: ["planner-1"],
      revision: 1,
    });
    expect(calendarUndoInverse("schedule_calendar_task", item)).toMatchObject({
      kind: "remove_work_block",
      itemId: "block-1",
      convexMutation: "calendar:removePersonalItem",
    });
  });

  it("does not claim zero local files when the local-effect count is unknown", () => {
    const result = evaluateApplicationAuthority({
      command: "change_sync_policy",
      args: { targetIds: ["work-1"], patch: {} },
      localFileCount: 0,
      localFileCountUnknown: true,
    });
    expect(result.decision).toBe("confirm");
    expect(result.consequence).toMatch(/unknown/i);
    expect(result.consequence).not.toMatch(/No files on this PC would change/i);
  });

  it("does not execute a tool when approval is declined", async () => {
    const definition = spectraToolRegistry.require("schedule_calendar_task");
    const execute = vi.spyOn(definition, "execute").mockResolvedValue({ ok: true });
    const result = await spectraToolExecutor.execute(
      {
        id: "cal-1",
        name: "schedule_calendar_task",
        input: {
          planArtifactId: "planner-1",
          planTaskId: "task-1",
          startAt: 1000,
          endAt: 2000,
          timezone: "UTC",
        },
      },
      {
        requireApproval: async () => false,
      },
    );
    expect(result).toMatchObject({ ok: false, code: "approval_declined" });
    expect(execute).not.toHaveBeenCalled();
    execute.mockRestore();
  });
});
