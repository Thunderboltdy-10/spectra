// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpectraArtifact } from "../data/api";

const mocks = vi.hoisted(() => ({ threads: vi.fn() }));

vi.mock("../data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/api")>()),
  getSpectraThreads: mocks.threads,
}));

import { CompanionSheet, WorkCompanionPanel, type CompanionTab } from "../components/work-companion";

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

function Panel({ onOpenThread }: { onOpenThread: (thread: { id: string; title: string }) => void }) {
  const [tab, setTab] = useState<CompanionTab>("details");
  return (
    <div className="flex">
      <main />
      <WorkCompanionPanel work={work} artifacts={[work]} tab={tab} onTabChange={setTab} onOpenWork={() => {}} onOpenThread={onOpenThread} />
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

  it("says plainly when nothing is linked", () => {
    render(<Panel onOpenThread={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Related" }));
    expect(screen.getByText("Nothing linked yet")).toBeTruthy();
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
