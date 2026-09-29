// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: toastError,
    success: vi.fn(),
    message: vi.fn(),
  }),
}));

import { CalendarApplication } from "../calendar/ui/calendar-application";

const ORIGINAL_TZ = process.env.TZ;

type Handler = (url: URL, init?: RequestInit) => Response | undefined;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function overview(items: unknown[] = []) {
  return json(200, {
    ok: true,
    data: {
      timezone: "Europe/Madrid",
      items,
      unscheduledTasks: [],
      partialTimeItems: [],
      sourceState: { kind: "available" },
      migration: {
        complete: true,
        migratedArtifacts: 0,
        migratedEvents: 0,
        skippedEvents: 0,
      },
      pagination: {},
    },
  });
}

let posts: Array<Record<string, unknown>> = [];
let gets = 0;

function installFetch(onPost: Handler, items: unknown[] = []) {
  posts = [];
  gets = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        if (body.action === "ensureMigration") return json(200, { ok: true, data: {} });
        return onPost(url, init) ?? json(200, { ok: true, data: {} });
      }
      gets += 1;
      return overview(items);
    }),
  );
}

beforeAll(() => {
  // Madrid leaves summer time on Sunday 25 October 2026 (a 25-hour day).
  process.env.TZ = "Europe/Madrid";
  class NoopResizeObserver {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  toastError.mockReset();
  vi.unstubAllGlobals();
  class NoopResizeObserver {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
});

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("Calendar application", () => {
  it("shows each date once across the autumn daylight-saving change", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 21, 12, 0) });
    installFetch(() => undefined);
    const { container } = render(<CalendarApplication />);
    await waitFor(() => expect(gets).toBeGreaterThan(0));
    const heads = [
      ...container.querySelectorAll(".spectra-calendar-day-head strong"),
    ].map((node) => Number(node.textContent));
    // The grid spans Monday 12 October to Monday 2 November.
    expect(heads.slice(0, 20)).toEqual([
      12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
      30, 31,
    ]);
    expect(heads.at(-1)).toBe(2);
  });

  it("proposes an event start one hour after the user's own clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 29, 10, 0) });
    installFetch(() => undefined);
    render(<CalendarApplication />);
    fireEvent.click(screen.getByRole("button", { name: "Add event" }));
    expect((screen.getByLabelText("Starts") as HTMLInputElement).value).toBe(
      "2026-09-29T11:00",
    );
    expect((screen.getByLabelText("Ends") as HTMLInputElement).value).toBe(
      "2026-09-29T12:00",
    );
  });
});
