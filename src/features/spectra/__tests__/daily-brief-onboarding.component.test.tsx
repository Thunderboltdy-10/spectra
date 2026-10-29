// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SPECTRA_PREFERENCES } from "../settings/schema";

const harness = vi.hoisted(() => ({ phase: "loading_classes", tour: "done", completedAt: 0, schedule: vi.fn(), request: vi.fn() }));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => args === "skip" ? undefined : getFunctionName(ref) === "managebac:onboardingStatus" ? { phase: harness.phase, completedAt: harness.completedAt } : null,
  useMutation: () => harness.schedule,
}));
vi.mock("../data/use-authed-args", () => ({ useAuthedArgs: (args: unknown) => args }));
vi.mock("../settings/preference-store", () => ({ useSpectraPreferences: () => ({ hydrated: true, preferences: { ...DEFAULT_SPECTRA_PREFERENCES, notifications: { ...DEFAULT_SPECTRA_PREFERENCES.notifications, dailyBrief: true, dailyBriefTime: "23:59" }, integrations: { ...DEFAULT_SPECTRA_PREFERENCES.integrations, tourStatus: harness.tour } } }) }));
import { useDailyBrief } from "../today/use-daily-brief";

function HomeBrief() { useDailyBrief(Date.now()); return null; }
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T10:00:00Z"));
  harness.phase = "loading_classes";
  harness.tour = "done";
  harness.completedAt = Date.now();
  harness.schedule.mockReset().mockResolvedValue(undefined);
  harness.request.mockReset().mockResolvedValue(new Response());
  vi.stubGlobal("fetch", harness.request);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("waits for both class confirmation and a completed first sync", async () => {
  const view = render(<HomeBrief />);
  for (const phase of ["loading_classes", "choose_classes", "syncing"]) {
    harness.phase = phase;
    await act(async () => view.rerender(<HomeBrief />));
    expect(harness.request).not.toHaveBeenCalled();
  }
  harness.phase = "ready";
  harness.tour = "pending";
  await act(async () => view.rerender(<HomeBrief />));
  expect(harness.request).not.toHaveBeenCalled();
});

it("requests the first brief immediately after setup, even before the daily wake time, only once", async () => {
  harness.phase = "ready";
  const view = render(<HomeBrief />);
  await act(async () => {});
  expect(harness.request).toHaveBeenCalledOnce();
  expect(harness.request).toHaveBeenCalledWith("/api/spectra/brief", expect.objectContaining({ method: "POST" }));
  await act(async () => view.rerender(<HomeBrief />));
  expect(harness.request).toHaveBeenCalledOnce();
});
