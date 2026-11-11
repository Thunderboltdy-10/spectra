// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ membership: null as unknown, ready: true, phase: "loading_classes", sync: vi.fn(), pathname: "/home", toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true }),
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => getFunctionName(ref) === "identity:session" ? { catalog: harness.membership } : getFunctionName(ref) === "managebac:onboardingStatus" ? { phase: harness.phase } : { connection: { state: harness.ready ? "connected" : "not_connected" } },
}));
vi.mock("next/navigation", () => ({ usePathname: () => harness.pathname }));
vi.mock("../data/api", () => ({ syncSpectraManageBacOnLogin: harness.sync }));
vi.mock("@/components/ui/toast", () => ({ toast: harness.toast }));
import { SchoolLoginSync } from "../school/school-login-sync";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
  harness.membership = null;
  harness.ready = true;
  harness.phase = "loading_classes";
  harness.pathname = "/home";
  harness.sync.mockReset();
  Object.values(harness.toast).forEach((mock) => mock.mockClear());
});

it("waits for the student's class choice without silently selecting classes", async () => {
  harness.membership = { accountId: "account", schoolId: "school" };
  harness.phase = "choose_classes";
  render(<SchoolLoginSync />);
  await act(async () => vi.advanceTimersByTimeAsync(60 * 60_000));
  expect(harness.sync).not.toHaveBeenCalled();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("starts when an invitation supplies membership, even while already inside the app", async () => {
  const view = render(<SchoolLoginSync />);
  expect(harness.sync).not.toHaveBeenCalled();
  harness.membership = { accountId: "account", schoolId: "school" };
  harness.sync.mockResolvedValue({ jobs: [{ kind: "classes", completion: { status: "completed" } }], queued: [] });
  await act(async () => view.rerender(<SchoolLoginSync />));
  expect(harness.sync).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(2 * 60 * 60_000));
  expect(harness.sync).toHaveBeenCalledOnce();
});

it("respects the server cooldown and retries while the app stays open", async () => {
  harness.membership = { accountId: "account", schoolId: "school" };
  harness.sync.mockResolvedValueOnce({ skipped: true, nextAttemptAt: Date.now() + 15 * 60_000 })
    .mockResolvedValueOnce({ jobs: [{ kind: "classes", errorCode: "FAILED", errorSummary: "Provider unavailable." }], queued: [], nextAttemptAt: Date.now() + 30 * 60_000 });
  await act(async () => { render(<SchoolLoginSync />); });
  await act(async () => vi.advanceTimersByTimeAsync(15 * 60_000 - 1));
  expect(harness.sync).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(harness.sync).toHaveBeenCalledTimes(2);
});

it("waits for a school connection and cancels retries on unmount", async () => {
  harness.membership = { accountId: "account", schoolId: "school" };
  harness.ready = false;
  const view = render(<SchoolLoginSync />);
  expect(harness.sync).not.toHaveBeenCalled();
  harness.ready = true;
  harness.sync.mockResolvedValue({ skipped: true, nextAttemptAt: Date.now() + 5 * 60_000 });
  await act(async () => view.rerender(<SchoolLoginSync />));
  view.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
  expect(harness.sync).toHaveBeenCalledOnce();
});
