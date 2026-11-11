// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { CalendarItem } from "../calendar/domain/model";
import { addLocalDays, startOfLocalDay } from "../calendar/domain/local-days";
import { greeting } from "../today/today-model";

const io = vi.hoisted(() => ({ story: null as number | null, overview: vi.fn(), threads: vi.fn(), calendar: vi.fn() }));
vi.mock("../administration/use-account-name", () => ({ useAccountName: () => "Andrew" }));
vi.mock("../showcase/showcase-time", () => ({ useShowcaseTime: () => io.story }));
vi.mock("../data/api", () => ({ getSpectraOverview: io.overview, getSpectraThreads: io.threads }));
vi.mock("../calendar/data/overview-client", () => ({ fetchCalendarOverview: io.calendar }));
import { useToday } from "../today/use-today";

beforeEach(() => {
  vi.useFakeTimers();vi.setSystemTime(new Date(2026, 10, 10, 11, 59, 15));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  io.story = null;io.overview.mockReset().mockResolvedValue({ artifacts: [] });io.threads.mockReset().mockResolvedValue({ threads: [] });
  const task = (day: number): CalendarItem => ({ id: `task-${day}`, title: `Day ${day}`, kind: "task", startAt: addLocalDays(startOfLocalDay(Date.now()), day) + 18 * 3_600_000,
    allDay: false, sourceLocked: false, status: "active", timePrecision: "exact", timezone: "Europe/Madrid", revision: 1, linkedWorkIds: [] });
  io.calendar.mockReset().mockResolvedValue({ overview: { items: [task(0), task(1)], unscheduledTasks: [] } });
});
afterEach(() => { cleanup();vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks(); });
const flush = () => act(async () => {});

it("advances Home's clock without reads each minute and refreshes its bounded agenda on a new day", async () => {
  const { result } = renderHook(useToday);await flush();
  expect(result.current.agenda?.today.map(t => t.id)).toEqual(["task-0"]);
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
  expect.soft(greeting(new Date(result.current.now!).getHours(), "Andrew")).toBe("Good afternoon, Andrew.");
  expect(io.overview).toHaveBeenCalledTimes(1);expect(io.threads).toHaveBeenCalledTimes(1);expect(io.calendar).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date(2026, 10, 11, 0, 0, 5));
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect.soft(result.current.agenda?.today.map(t => t.id)).toEqual(["task-1"]);
  expect.soft(io.overview).toHaveBeenCalledTimes(2);expect.soft(io.threads).toHaveBeenCalledTimes(2);expect.soft(io.calendar).toHaveBeenCalledTimes(2);
  expect.soft(io.calendar.mock.calls.at(-1)?.slice(0, 2)).toEqual([startOfLocalDay(Date.now()), addLocalDays(startOfLocalDay(Date.now()), 14)]);
});

it("does no hidden clock work, catches up on return, and cleans up its timer/listeners", async () => {
  const { result, unmount } = renderHook(useToday);await flush();const initial = result.current.now;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  vi.setSystemTime(new Date(2026, 10, 11, 8));
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(result.current.now).toBe(initial);expect(io.calendar).toHaveBeenCalledTimes(1);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect.soft(result.current.now).toBe(Date.now());expect.soft(io.calendar).toHaveBeenCalledTimes(2);
  vi.setSystemTime(new Date(2026, 10, 11, 9));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect.soft(result.current.now).toBe(Date.now());expect.soft(io.calendar).toHaveBeenCalledTimes(2);
  unmount();expect(vi.getTimerCount()).toBe(0);
  await act(async () => { window.dispatchEvent(new Event("focus"));document.dispatchEvent(new Event("visibilitychange")); });
  expect.soft(io.calendar).toHaveBeenCalledTimes(2);
});

it("keeps showcase time fixed without a live timer and follows its explicit changes", async () => {
  io.story = new Date(2026, 10, 8, 20).getTime();
  expect(renderToString(createElement(function Clock() { return String(useToday().now); }))).toBe("null");
  const { result, rerender } = renderHook(useToday);await flush();
  expect(result.current.now).toBe(io.story);expect(vi.getTimerCount()).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(86_400_000); });
  expect(result.current.now).toBe(io.story);expect(io.calendar).toHaveBeenCalledTimes(1);
  io.story = new Date(2026, 10, 9, 7).getTime();rerender();await flush();
  expect(result.current.now).toBe(io.story);expect(io.calendar).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
});

it("clears an earlier calendar failure when the next day's bounded refresh succeeds", async () => {
  io.calendar.mockRejectedValueOnce(new Error("Temporary calendar outage"));
  const { result } = renderHook(useToday);await flush();
  expect(result.current.agendaFailed).toBe(true);expect(result.current.agenda).toBeNull();
  vi.setSystemTime(new Date(2026, 10, 11, 8));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(result.current.agenda?.today.map(t => t.id)).toEqual(["task-1"]);
  expect(result.current.agendaFailed).toBe(false);expect(io.calendar).toHaveBeenCalledTimes(2);
});
