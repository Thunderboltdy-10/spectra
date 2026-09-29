// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimetableStudio } from "../components/timetable-studio";
import type { SpectraArtifact } from "../data/api";
import { normalizeTimetableContent, type TimetableContent } from "../timetable/model";
import { StudioContractProvider, type StudioContract } from "../components/artifact-studio-shell";

// The event editor's pickers are the shared Select, not native <select>s.
// Radix rejects an empty-string item value, so "Does not repeat" and the
// "Link work…" prompt are mapped, and the link picker resets after each pick.

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

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
tomorrow.setHours(10, 0, 0, 0);
const end = new Date(tomorrow.getTime() + 60 * 60 * 1000);

const initial = {
  layers: [{ id: "study", name: "Study", kind: "study" }],
  events: [
    { id: "e1", layerId: "study", title: "Maths revision", start: tomorrow.toISOString(), end: end.toISOString(), allDay: false },
  ],
};

const artifacts = [
  { _id: "doc-1", title: "Essay draft", status: "active", blueprintKey: "document" },
] as unknown as SpectraArtifact[];

let latest: TimetableContent | undefined;

const contract = {
  artifactId: "work-1",
  type: "timetable",
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

function Harness() {
  const [content, setContent] = useState<unknown>(initial);
  return (
    <StudioContractProvider value={contract}>
    <TimetableStudio
      artifactId="work-1"
      artifacts={artifacts}
      content={content}
      onChange={(next) => {
        latest = normalizeTimetableContent(next);
        setContent(next);
      }}
      readOnly={false}
    />
    </StudioContractProvider>
  );
}

async function choose(name: string, option: string) {
  const trigger = screen.getByRole("combobox", { name });
  expect(trigger.tagName).toBe("BUTTON");
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
  await act(async () => {
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
  });
}

beforeEach(() => {
  latest = undefined;
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openEvent() {
  render(<Harness />);
  await act(async () => {});
  const upcoming = screen.getAllByText("Maths revision").map((node) => node.closest("button")).filter(Boolean);
  await act(async () => {
    fireEvent.click(upcoming[upcoming.length - 1]!);
  });
  expect(screen.getByRole("complementary", { name: "Event details" })).toBeTruthy();
}

describe("timetable event pickers", () => {
  it("sets and clears the recurrence through the shared Select", async () => {
    await openEvent();
    await choose("Recurrence", "Weekly");
    expect(latest?.events.find((event) => event.id === "e1")?.recurrence).toBe("FREQ=WEEKLY");
    await choose("Recurrence", "Does not repeat");
    expect(latest?.events.find((event) => event.id === "e1")?.recurrence).toBeUndefined();
  });

  it("sets whether the event shows as busy or free", async () => {
    await openEvent();
    await choose("Show as", "Free");
    expect(latest?.events.find((event) => event.id === "e1")?.availability).toBe("free");
  });

  it("links work and returns the picker to its prompt", async () => {
    await openEvent();
    await choose("Linked work", "Essay draft");
    expect(latest?.events.find((event) => event.id === "e1")?.artifactIds).toEqual(["doc-1"]);
    expect(screen.getByRole("combobox", { name: "Linked work" }).textContent).toContain("Link work…");
  });

  it("moves the event to another calendar", async () => {
    await openEvent();
    const calendar = screen.getByRole("combobox", { name: "Calendar" });
    expect(calendar.tagName).toBe("BUTTON");
    expect(calendar.textContent).toContain("Study");
  });
});
