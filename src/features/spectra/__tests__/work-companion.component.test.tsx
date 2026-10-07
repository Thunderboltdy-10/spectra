// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpectraArtifact } from "../data/api";

const mocks = vi.hoisted(() => ({ threads: vi.fn(), related: vi.fn(), refresh: vi.fn() }));

vi.mock("../data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/api")>()),
  getSpectraThreads: mocks.threads,
}));

vi.mock("../semantic/use-semantic", () => ({ useRelated: mocks.related }));

import { CompanionSheet, WorkCompanionPanel, relatedReasonText, type CompanionTab } from "../components/work-companion";
import { spectraBus } from "../events";

const work = {
  _id: "work-1",
  title: "Photosynthesis notes",
  blueprintKey: "document",
  summary: "How plants make sugar.",
  updatedAt: Date.now() - 60_000,
  accessLevel: "edit",
  isShared: false,
} as unknown as SpectraArtifact;

beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.localStorage.clear();
  mocks.related.mockReturnValue(relatedState({ status: "empty" }));
  mocks.threads.mockResolvedValue({
    threads: [
      { _id: "t1", title: "Explain the light reactions", artifactId: "work-1", updatedAt: Date.now(), status: "active", origin: "artifact", createdAt: 0 },
      { _id: "t2", title: "Something else", artifactId: "work-2", updatedAt: Date.now(), status: "active", origin: "artifact", createdAt: 0 },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function relatedState(overrides: Record<string, unknown>) {
  return { status: "results", results: [], mode: "hybrid", cached: false, degraded: null, error: null, tookMs: 1, refresh: mocks.refresh, ...overrides };
}

const linked = {
  _id: "work-2",
  title: "Light reactions",
  blueprintKey: "presentation",
  updatedAt: Date.now() - 120_000,
} as unknown as SpectraArtifact;

function Panel({
  onOpenThread,
  onOpenWork = () => {},
}: {
  onOpenThread: (thread: { id: string; title: string }) => void;
  onOpenWork?: (work: SpectraArtifact) => void;
}) {
  const [tab, setTab] = useState<CompanionTab>("details");
  return (
    <div className="flex">
      <main />
      <WorkCompanionPanel work={work} artifacts={[work, linked]} tab={tab} onTabChange={setTab} onOpenWork={onOpenWork} onOpenThread={onOpenThread} />
    </div>
  );
}

describe("Work companion", () => {
  it("opens on Details and offers the five companion tabs", () => {
    render(<Panel onOpenThread={() => {}} />);
    for (const name of ["Details", "Comments", "Activity", "Related", "Conversations"])
      expect(screen.getByRole("tab", { name })).toBeTruthy();
    expect(screen.getByText("How plants make sugar.")).toBeTruthy();
    expect(screen.getByText("Only you")).toBeTruthy();
  });

  it("lists only this work's conversations, and opens one", async () => {
    const onOpenThread = vi.fn();
    render(<Panel onOpenThread={onOpenThread} />);
    fireEvent.click(screen.getByRole("tab", { name: "Conversations" }));
    fireEvent.click(await screen.findByText("Explain the light reactions"));
    expect(onOpenThread).toHaveBeenCalledWith({ id: "t1", title: "Explain the light reactions" });
    expect(screen.queryByText("Something else")).toBeNull();
  });

  it("says plainly when nothing is related", () => {
    render(<Panel onOpenThread={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Related" }));
    expect(mocks.related).toHaveBeenCalledWith("work-1", { limit: 12 });
    expect(screen.getByText("Nothing related yet")).toBeTruthy();
  });

  it("lists related work from the semantic layer with why each is listed, and opens it", () => {
    mocks.related.mockReturnValue(relatedState({
      results: [
        { kind: "artifact", itemId: "work-2", title: "Light reactions", typeLabel: "Slides", subtype: "presentation", anchor: { kind: "artifact", artifactId: "work-2" }, score: 1, ownership: "mine", reasons: [{ type: "link", relation: "related", direction: "outgoing" }] },
        { kind: "artifact", itemId: "work-9", title: "Chlorophyll quiz", typeLabel: "Quiz", subtype: "quiz", anchor: { kind: "artifact", artifactId: "work-9" }, score: 0.8, ownership: "shared", reasons: [{ type: "similar", similarity: 0.8 }] },
        { kind: "thread", itemId: "t1", title: "Explain the light reactions", typeLabel: "Chat", anchor: { kind: "thread", threadId: "t1" }, score: 1, ownership: "mine", reasons: [{ type: "thread_about" }] },
      ],
    }));
    const onOpenWork = vi.fn();
    const opened = vi.fn();
    const stop = spectraBus.handle("work.open", opened);
    render(<Panel onOpenThread={() => {}} onOpenWork={onOpenWork} />);
    fireEvent.click(screen.getByRole("tab", { name: "Related" }));
    expect(screen.getByText(/Linked from this work/)).toBeTruthy();
    expect(screen.getByText(/^Similar/)).toBeTruthy();
    // Conversations have their own tab.
    expect(screen.queryByText("Explain the light reactions")).toBeNull();
    fireEvent.click(screen.getByText("Light reactions"));
    expect(onOpenWork).toHaveBeenCalledWith(linked);
    // Work the page has not loaded opens in the Side by id.
    fireEvent.click(screen.getByText("Chlorophyll quiz"));
    expect(opened).toHaveBeenCalledWith({ workId: "work-9", surface: "panel" });
    stop();
  });

  it("shows a ghost while related work loads, a retry when it fails, and a quiet note when only links answer", () => {
    mocks.related.mockReturnValue(relatedState({ status: "loading" }));
    const { rerender } = render(<Panel onOpenThread={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Related" }));
    expect(screen.getByRole("status", { name: "Finding related work" })).toBeTruthy();
    mocks.related.mockReturnValue(relatedState({ status: "error", error: "Search failed." }));
    rerender(<Panel onOpenThread={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    mocks.related.mockReturnValue(relatedState({
      mode: "links_only",
      degraded: "embeddings_unavailable",
      results: [{ kind: "artifact", itemId: "work-2", title: "Light reactions", typeLabel: "Slides", subtype: "presentation", anchor: { kind: "artifact", artifactId: "work-2" }, score: 1, ownership: "mine", reasons: [{ type: "link", relation: "source_for", direction: "incoming", label: "Source" }] }],
    }));
    rerender(<Panel onOpenThread={() => {}} />);
    expect(screen.getByText("Showing linked work only right now.")).toBeTruthy();
    expect(screen.getByText(/^Source ·/)).toBeTruthy();
  });

  it("names a link's direction when it has no label of its own", () => {
    expect(relatedReasonText([{ type: "link", relation: "related", direction: "incoming" }])).toBe("Links to this work");
    expect(relatedReasonText([{ type: "similar", similarity: 0.7 }, { type: "link", relation: "related", direction: "outgoing" }])).toBe("Linked from this work");
    expect(relatedReasonText([{ type: "thread_about" }])).toBeNull();
  });

  it("comes in as a sheet over work in the Side, and Esc returns to the work", () => {
    const onClose = vi.fn();
    const onOpenFull = vi.fn();
    function Side() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div ref={ref}>
          <aside data-studio-panel aria-label="Work studio" />
          <CompanionSheet
            rootRef={ref}
            work={work}
            artifacts={[work]}
            tab="details"
            onTabChange={() => {}}
            onClose={onClose}
            onOpenFull={onOpenFull}
            onOpenWork={() => {}}
            onOpenThread={() => {}}
          />
        </div>
      );
    }
    render(<Side />);
    const sheet = screen.getByRole("dialog", { name: "About Photosynthesis notes" });
    expect(sheet.closest("[data-studio-panel]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open full" }));
    expect(onOpenFull).toHaveBeenCalledOnce();
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
