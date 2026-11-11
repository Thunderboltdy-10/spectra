// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

const api = vi.hoisted(() => ({ reads: 0 }));
vi.mock("../../data/api", () => ({
  getSpectraRunTabs: vi.fn(async () => {
    api.reads += 1;
    return { runTabs: [] };
  }),
  invalidateSpectraRunTabsCache: vi.fn(),
}));

import { spectraBus } from "../../events";
import { clearRunTabs, useRunTabs } from "../run-tabs";

function Reader() {
  useRunTabs();
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  api.reads = 0;
  clearRunTabs();
});
afterEach(() => vi.useRealTimers());

it("reads the tabs at most once a second for a burst of changes, after the burst (E3)", async () => {
  const view = render(<Reader />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  const mounted = api.reads;
  await act(async () => {
    for (let index = 0; index < 8; index++) {
      spectraBus.emit("run.changed", { runId: `run-${index}` });
      spectraBus.emit("threads.changed", {});
      await vi.advanceTimersByTimeAsync(100);
    }
  });
  expect(api.reads - mounted).toBeLessThanOrEqual(1);
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(api.reads - mounted).toBe(1);
  view.unmount();
});
