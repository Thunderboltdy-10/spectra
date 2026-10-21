// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  departures: new Map<string, boolean>(),
  arrivals: new Set<string>(),
  search: { results: [] as unknown[], status: "idle", degraded: false },
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
vi.mock("../../semantic/use-semantic", () => ({ useThreadSearch: () => h.search }));
vi.mock("../../life/life", () => ({ life: { on: false } }));
vi.mock("../../school/use-class-book", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../school/use-class-book")>()),
  useClassBook: () => ({ loading: false, classes: [], named: () => null, idNamed: () => null, of: () => null }),
}));
vi.mock("../../life/use-life", () => ({
  unformElement: vi.fn(),
  useLifeArrival: (_ref: unknown, key: string) => {
    h.arrivals.add(key);
  },
  useLifeDeparture: (_ref: unknown, enabled: boolean, _figure: unknown, key: string) => {
    h.departures.set(key, enabled);
  },
}));

import { ThreadsBrowser } from "../threads-view";

afterEach(() => {
  cleanup();
  h.departures.clear();
  h.arrivals.clear();
  h.search = { results: [], status: "idle", degraded: false };
});

describe("threads browser life", () => {
  it("keys each conversation, so one that moves to another group travels there", async () => {
    render(<ThreadsBrowser onChoose={() => {}} />);
    await screen.findByText("Essay plan");
    expect([...h.arrivals]).toEqual(expect.arrayContaining(["thread:t1", "thread:t2"]));
    expect(h.departures.get("thread:t1")).toBe(true);
  });

  it("narrowing a search is a filter: nothing parts", async () => {
    render(<ThreadsBrowser onChoose={() => {}} />);
    await act(async () => {});
    fireEvent.change(screen.getByRole("searchbox", { name: "Search threads" }), { target: { value: "essay" } });
    expect(screen.getByText("Essay plan")).toBeTruthy();
    expect(h.departures.get("thread:t1")).toBe(false);
  });

  it("while a search is still looking, a ghost stands in, not \"nothing matches\"", async () => {
    h.search = { results: [], status: "loading", degraded: false };
    render(<ThreadsBrowser onChoose={() => {}} />);
    await act(async () => {});
    fireEvent.change(screen.getByRole("searchbox", { name: "Search threads" }), { target: { value: "photosynthesis" } });
    expect(screen.getByRole("status", { name: "Searching threads" })).toBeTruthy();
    expect(screen.queryByText(/No thread matches/)).toBeNull();
  });
});
