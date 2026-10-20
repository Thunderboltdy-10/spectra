// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanStudio } from "../components/plan-studio";
import { StudioContractProvider, type StudioContract } from "../components/artifact-studio-shell";
import { normalizePlanContent } from "../plan/model";

// Importing a CSV reads the file asynchronously. The import lands on the plan
// as it is when the file has been read, not as it was when the import began,
// so a task added meanwhile (by this user or a collaborator) is kept.

vi.mock("../settings/preference-store", () => ({
  useSpectraPreferences: () => ({
    preferences: { workbar: {}, writing: { smartCompletion: false }, notifications: { reminderTime: "09:00" } },
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
} as unknown as StudioContract;

const task = (id: string, title: string) => ({ id, title, status: "todo" });

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("plan CSV import", () => {
  it("keeps a task added while the file was being read", async () => {
    const onChange = vi.fn();
    const view = (content: unknown) => (
      <StudioContractProvider value={contract}>
        <PlanStudio mode="tab" title="Plan" content={content} onChange={onChange} readOnly={false} />
      </StudioContractProvider>
    );
    const { container, rerender } = render(view({ tasks: [task("a", "Read chapter 1")] }));

    let finishReading: (text: string) => void = () => {};
    const file = new File([""], "tasks.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", {
      value: () => new Promise<string>((resolve) => (finishReading = resolve)),
    });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    fireEvent.change(input);

    // While the file is read, a collaborator adds a task.
    rerender(view({ tasks: [task("a", "Read chapter 1"), task("b", "Peer task")] }));

    await act(async () => {
      finishReading("Title\nImported task\n");
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const titles = normalizePlanContent(onChange.mock.calls[0]![0]).tasks.map((item) => item.title);
    expect(titles).toEqual(["Read chapter 1", "Peer task", "Imported task"]);
  });
});
