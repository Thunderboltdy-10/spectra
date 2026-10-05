// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioContractProvider, type StudioContract } from "../components/artifact-studio-shell";
import { TaskStudio, dueDistance, taskInputs, taskInstant } from "../components/task-studio";
import { isSingleTask } from "../plan/model";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn(async () => ({})), useQuery: () => undefined }));
vi.mock("../settings/preference-store", () => ({
  useSpectraPreferences: () => ({
    preferences: { workbar: {}, writing: { smartCompletion: false } },
    hydrated: true,
    update: () => {},
    replace: () => {},
    reset: () => {},
  }),
}));

const contract = {
  artifactId: "work-1",
  type: "planner_task",
  role: "edit",
  can: () => true,
  modes: [],
  readOnly: false,
  surface: "full",
  sync: { state: "saved", label: "Saved" },
  responsive: {
    minInlineSize: 320,
    preferredInlineSize: 960,
    supportsPanel: true,
    supportsTile: true,
    supportsCompact: true,
    toolbarPriorities: [],
    canvasExtent: "infinite",
  },
  density: "comfortable",
  compatibilityProfile: "spectra-native",
  fidelity: { artifact: "NATIVE" },
  inspector: { open: null, show: () => {}, hide: () => {} },
  history: { canUndo: false, canRedo: false, step: () => {} },
} as unknown as StudioContract;

const ZONE = "Europe/Madrid";
const base = { taskTitle: "Return the library book", status: "todo", priority: "medium", timezone: ZONE, subtasks: [], reminders: [] };

let latest: Record<string, unknown> = {};
function Harness({ initial }: { initial: Record<string, unknown> }) {
  const [content, setContent] = useState(initial);
  return (
    <StudioContractProvider value={contract}>
      <TaskStudio mode="tab" title="Task" content={content} onChange={(next) => {
          latest = next as Record<string, unknown>;
          setContent(latest);
        }} readOnly={false} />
    </StudioContractProvider>
  );
}

beforeEach(() => {
  latest = {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a planner task", () => {
  it("is one thing: a title, notes and done, with no steps until someone adds them", () => {
    render(<Harness initial={base} />);
    expect(screen.getByLabelText("Title")).toHaveProperty("value", "Return the library book");
    expect(screen.getByLabelText("Notes")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Steps" })).toBeNull();
    expect(screen.queryByRole("region", { name: "More" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add steps" })).toBeTruthy();
  });

  it("is ticked off in place", () => {
    render(<Harness initial={base} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark as done" }));
    expect(latest.status).toBe("done");
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark as not done" }));
    expect(latest.status).toBe("todo");
  });

  it("writes the same fields Spectra writes, never a plan of many tasks", () => {
    render(<Harness initial={base} />);
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "It is the blue one." } });
    fireEvent.click(screen.getByRole("button", { name: "Add steps" }));
    fireEvent.change(screen.getByLabelText("Step"), { target: { value: "Find it" } });
    expect(latest.description).toBe("It is the blue one.");
    expect(latest.subtasks).toEqual([expect.objectContaining({ title: "Find it", done: false })]);
    expect(latest.tasks).toBeUndefined();
    expect(isSingleTask(latest)).toBe(true);
  });

  it("lets an empty step go when you leave it", () => {
    render(<Harness initial={base} />);
    fireEvent.click(screen.getByRole("button", { name: "Add steps" }));
    fireEvent.blur(screen.getByLabelText("Step"));
    expect(latest.subtasks).toEqual([]);
  });

  it("keeps a school deadline as the school wrote it, beside the student's own target", () => {
    const fromSchool = {
      ...base,
      dueAt: taskInstant("2026-10-16", null, ZONE),
      source: { provider: "managebac", externalId: "a-1", status: "active", lockedFields: ["taskTitle", "description", "dueAt", "source"] },
    };
    render(<Harness initial={fromSchool} />);
    expect(screen.getByLabelText("Title")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Due")).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Your target"), { target: { value: "2026-10-12" } });
    expect(taskInputs((latest.personalOverlay as { targetDueAt: number }).targetDueAt, ZONE).date).toBe("2026-10-12");
    expect(latest.dueAt).toBe(fromSchool.dueAt);
  });
});

describe("due times in the task's zone", () => {
  it("reads back the day and time it was given", () => {
    const at = taskInstant("2026-10-08", "09:30", ZONE);
    expect(taskInputs(at, ZONE)).toEqual({ date: "2026-10-08", time: "09:30" });
    expect(new Date(at).toISOString()).toBe("2026-10-08T07:30:00.000Z");
  });

  it("puts a day without a time at its end", () => {
    expect(taskInputs(taskInstant("2026-10-08", null, ZONE), ZONE)).toEqual({ date: "2026-10-08", time: "23:59" });
  });

  it("says how near the day is", () => {
    const now = taskInstant("2026-10-05", "12:00", ZONE);
    expect(dueDistance(taskInstant("2026-10-05", null, ZONE), now, ZONE)).toBe("Today");
    expect(dueDistance(taskInstant("2026-10-06", null, ZONE), now, ZONE)).toBe("Tomorrow");
    expect(dueDistance(taskInstant("2026-10-09", null, ZONE), now, ZONE)).toBe("In 4 days");
    expect(dueDistance(taskInstant("2026-10-03", null, ZONE), now, ZONE)).toBe("2 days late");
  });
});
