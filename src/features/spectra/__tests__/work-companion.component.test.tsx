// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpectraArtifact } from "../data/api";

const mocks = vi.hoisted(() => ({ threads: vi.fn() }));

vi.mock("../data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/api")>()),
  getSpectraThreads: mocks.threads,
}));

vi.mock("../components/work-origin", () => ({
  useWorkPlaces: () => [],
  WorkPlaceLink: () => null,
}));

import { WorkConversations, WorkDetails } from "../components/work-companion";

const work = {
  _id: "work-1",
  title: "Photosynthesis notes",
  blueprintKey: "document",
  summary: "How plants make sugar.",
  createdAt: Date.now() - 86_400_000,
  updatedAt: Date.now() - 60_000,
  accessLevel: "edit",
  isShared: false,
} as unknown as SpectraArtifact;

beforeEach(() => {
  mocks.threads.mockResolvedValue({
    threads: [
      { _id: "t1", title: "Explain the light reactions", artifactId: "work-1", updatedAt: Date.now(), status: "active", origin: "artifact", createdAt: Date.now() },
      { _id: "t2", title: "Something else", artifactId: "work-2", updatedAt: Date.now(), status: "active", origin: "artifact", createdAt: Date.now() },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("what the pane says about an artifact", () => {
  it("records who may read it", () => {
    render(<WorkDetails work={work} />);
    expect(screen.getByText("Only you")).toBeTruthy();
  });

  it("lists only this artifact's conversations, and opens one", async () => {
    const onOpenThread = vi.fn();
    render(<WorkConversations work={work} onOpenThread={onOpenThread} />);
    fireEvent.click(await screen.findByText("Explain the light reactions"));
    expect(onOpenThread).toHaveBeenCalledWith({ id: "t1", title: "Explain the light reactions" });
    expect(screen.queryByText("Something else")).toBeNull();
  });

  it("offers another try when conversations fail to load", async () => {
    mocks.threads.mockRejectedValueOnce(new Error("offline"));
    render(<WorkConversations work={work} onOpenThread={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Explain the light reactions")).toBeTruthy();
  });
});
