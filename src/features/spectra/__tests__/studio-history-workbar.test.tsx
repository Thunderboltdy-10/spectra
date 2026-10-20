// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuizStudio } from "../components/quiz-studio";
import { FlashcardStudio } from "../components/flashcard-studio";
import { PlanStudio } from "../components/plan-studio";
import { TimetableStudio } from "../components/timetable-studio";
import {
  StudioContractProvider,
  type StudioContract,
} from "../components/artifact-studio-shell";
import type { WorkType } from "../work/registry";

// Quiz, flashcards, plan and timetable undo through the shell's content
// history. Like the whiteboard, their workbar leads with Undo and Redo, so the
// history is reachable without the keyboard. A lone task is a calm sheet with
// no workbar; it undoes through the shell.
vi.mock("convex/react", () => ({ useMutation: () => vi.fn(async () => ({})), useQuery: () => undefined }));
vi.mock("../data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/api")>()),
  getArtifactAssets: vi.fn(async () => ({ assets: [] })),
}));
vi.mock("../settings/preference-store", () => ({
  useSpectraPreferences: () => ({
    preferences: { workbar: {}, writing: { smartCompletion: false }, notifications: { reminderTime: "09:00" } },
    hydrated: true,
    update: () => {},
    replace: () => {},
    reset: () => {},
  }),
}));

function contract(type: WorkType, history: StudioContract["history"]): StudioContract {
  return {
    artifactId: "work-1",
    type,
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
    history,
  } as StudioContract;
}

const studios: Array<[string, WorkType, () => ReactNode]> = [
  ["quiz", "quiz", () => <QuizStudio artifactId="work-1" mode="tab" content={{ questions: [] }} onChange={() => {}} />],
  ["flashcards", "flashcard_deck", () => <FlashcardStudio artifactId="work-1" mode="tab" content={{ cards: [] }} onChange={() => {}} />],
  ["plan", "planner_task", () => <PlanStudio mode="tab" title="Plan" content={{ tasks: [] }} onChange={() => {}} readOnly={false} />],
  ["timetable", "timetable", () => <TimetableStudio artifactId="work-1" artifacts={[]} content={{}} onChange={() => {}} readOnly={false} />],
];

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

describe.each(studios)("%s workbar undo", (_name, type, studio) => {
  it("offers Undo and Redo that step the shell history", async () => {
    const step = vi.fn();
    render(
      <StudioContractProvider value={contract(type, { canUndo: true, canRedo: false, step })}>
        {studio()}
      </StudioContractProvider>,
    );
    const undo = await screen.findByRole("button", { name: /^Undo/ });
    const redo = screen.getByRole("button", { name: /^Redo/ });
    expect((undo as HTMLButtonElement).disabled).toBe(false);
    expect((redo as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(undo);
    });
    expect(step).toHaveBeenCalledWith("undo");
  });
});
