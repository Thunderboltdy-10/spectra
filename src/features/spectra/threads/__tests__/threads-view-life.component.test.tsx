// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  departures: new Map<string, boolean>(),
  arrivals: new Set<string>(),
}));

vi.mock("../../data/api", () => ({
  getSpectraThreads: vi.fn(async () => ({
    threads: [
      { _id: "t1", status: "active", title: "Essay plan", updatedAt: Date.now(), lastMessageAt: Date.now() },
      { _id: "t2", status: "active", title: "Chemistry notes", updatedAt: Date.now(), lastMessageAt: Date.now() },
    ],
  })),
}));
vi.mock("../../hooks/use-spectra-router", () => ({ useSpectraRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../island/run-tabs", () => ({ useRunTabs: () => [], isActiveRunStatus: () => false }));
vi.mock("../../semantic/use-semantic", () => ({ useThreadSearch: () => ({ results: [], status: "idle", degraded: false }) }));
vi.mock("../../life/life", () => ({ life: { on: false } }));
vi.mock("../../life/use-life", () => ({
  unformElement: vi.fn(),
  useLifeArrival: (_ref: unknown, key: string) => {
    h.arrivals.add(key);
  },
  useLifeDeparture: (_ref: unknown, enabled: boolean, _figure: unknown, key: string) => {
    h.departures.set(key, enabled);
  },
}));

import { ThreadsView } from "../threads-view";

afterEach(() => {
  cleanup();
  h.departures.clear();
  h.arrivals.clear();
});

describe("threads view life", () => {
  it("keys each conversation, so one that moves to another group travels there", async () => {
    render(<ThreadsView onClose={() => {}} />);
    await screen.findByText("Essay plan");
    expect([...h.arrivals]).toEqual(expect.arrayContaining(["thread:t1", "thread:t2"]));
    expect(h.departures.get("thread:t1")).toBe(true);
  });

  it("narrowing a search is a filter: nothing parts", async () => {
    render(<ThreadsView onClose={() => {}} />);
    await act(async () => {});
    fireEvent.change(screen.getByRole("textbox", { name: "Find a conversation" }), { target: { value: "essay" } });
    expect(screen.getByText("Essay plan")).toBeTruthy();
    expect(h.departures.get("thread:t1")).toBe(false);
  });
});
