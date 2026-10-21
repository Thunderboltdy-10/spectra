// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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

// A school task opens through the router and Convex; here it only needs to exist.
vi.mock("../school/open-school-task", () => ({
  schoolTaskHref: (recordId: string) => `/school?task=${recordId}`,
  useOpenSchoolTask: () => ({ open: vi.fn(), onTaskClick: () => vi.fn(), workOf: () => Promise.resolve(null) }),
}));

// Class colours come from School's live query; with none, a class is coloured by its name.
vi.mock("convex/react", () => ({ useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }), useQuery: () => undefined, useMutation: () => vi.fn() }));

import { CalendarApplication } from "../calendar/ui/calendar-application";

/** A block's title leads with its time ("09:00 – 10:00: Essay draft"); match it by the event. */
const blockTitled = (title: string) => new RegExp(`: ${title}(\.|$)`);

const ORIGINAL_TZ = process.env.TZ;

type Handler = (url: URL, init?: RequestInit) => Response | undefined;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function overview(items: unknown[] = [], timezone = "Europe/Madrid") {
  return json(200, {
    ok: true,
    data: {
      timezone,
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
/** While set, overview reads never answer: a reload that has not finished. */
let holdGets = false;

function installFetch(
  onPost: Handler,
  items: unknown[] = [],
  timezone = "Europe/Madrid",
) {
  posts = [];
  gets = 0;
  holdGets = false;
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
      if (holdGets) return new Promise<Response>(() => {});
      return overview(items, timezone);
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

  // The composer shows wall-clock times; after the last hour of the day it
  // offers tomorrow morning instead of a slot past midnight.
  it.each([
    ["2026-09-30T18:05:19", "19:00", "20:00"],
    ["2026-09-30T18:00:00", "19:00", "20:00"],
    ["2026-09-30T23:59:59", "9:00", "10:00"],
    ["2027-03-28T01:35:00", "2:00", "3:00"],
    ["2026-10-25T01:35:00", "2:00", "3:00"],
  ])("defaults to the next whole local hour at %s", async (now, start, end) => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(now) });
    installFetch(() => undefined);
    render(<CalendarApplication />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const dialog = screen.getByRole("dialog", { name: "Add an event" });
    expect((within(dialog).getByLabelText("Starts") as HTMLInputElement).value).toBe(start);
    expect((within(dialog).getByLabelText("Ends") as HTMLInputElement).value).toBe(end);
  });

  it("refreshes whole-hour defaults when the composer reopens", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 30, 18, 5) });
    installFetch(() => undefined);
    render(<CalendarApplication />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    vi.setSystemTime(new Date(2026, 8, 30, 19, 17));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect((screen.getByLabelText("Starts") as HTMLInputElement).value).toBe("20:00");
    expect((screen.getByLabelText("Ends") as HTMLInputElement).value).toBe("21:00");
  });

  it("saves whole-hour defaults in the browser zone when Calendar reports UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 30, 18, 5, 19) });
    installFetch(() => undefined, [], "UTC");
    render(<CalendarApplication />);
    await waitFor(() => expect(gets).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const dialog = screen.getByRole("dialog", { name: "Add an event" });
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Revision" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add event" }));
    await waitFor(() => expect(posts.find((post) => post.action === "createPersonalItem")).toMatchObject({
      title: "Revision",
      startAt: Date.parse("2026-09-30T19:00"),
      endAt: Date.parse("2026-09-30T20:00"),
      timezone: "Europe/Madrid",
    }));
  });

  it("places events on the user's own clock even when Calendar reports UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 29, 8, 0) });
    // A student without school data: every stored row says UTC, so the
    // overview reports UTC. 11:00 in Madrid is 09:00 UTC.
    installFetch(() => undefined, [
      {
        id: "event-1",
        kind: "personal_event",
        title: "Chemistry revision",
        startAt: Date.parse("2026-09-29T09:00:00Z"),
        endAt: Date.parse("2026-09-29T10:00:00Z"),
        allDay: false,
        timezone: "UTC",
        timePrecision: "exact",
        status: "active",
        sourceLocked: false,
        linkedWorkIds: [],
        revision: 1,
      },
    ], "UTC");
    render(<CalendarApplication />);
    const block = await screen.findByTitle(blockTitled("Chemistry revision"));
    expect(block.textContent).toMatch(/^11:00/);
    expect(block.style.top).toBe(`${11 * 60}px`);
  });

  it("restores the latest block after another tab changed it", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 29, 8, 0) });
    installFetch(
      () =>
        json(409, {
          ok: false,
          error: {
            code: "CALENDAR_GESTURE_CONFLICT",
            message: "Re-resolve the block before resizing it.",
            status: 409,
          },
        }),
      [workBlock()],
    );
    render(<CalendarApplication />);
    fireEvent.click(await screen.findByTitle(blockTitled("Essay draft")));
    const loadsBefore = gets;
    // The notice must not wait for the reload: a slow reload left the block
    // jumping back with no explanation.
    holdGets = true;
    fireEvent.click(screen.getByRole("button", { name: "30 minutes longer" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0]![0]).toMatch(/^Calendar changed/);
    expect(toastError.mock.calls[0]![1]).toMatchObject({
      id: "calendar-gesture-conflict",
    });
    await waitFor(() => expect(gets).toBeGreaterThan(loadsBefore));
  });

  it("keeps every block that shares a time slot clickable", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 29, 8, 0) });
    installFetch(() => undefined, [
      {
        ...workBlock(),
        taskItemId: undefined,
        planArtifactId: "plan-1",
        planTaskId: "task-1",
        linkedWorkIds: ["plan-1"],
      },
      {
        ...workBlock(),
        id: "official-2",
        kind: "official_event",
        title: "Maths Unit 7 Test",
        taskItemId: undefined,
        sourceLocked: true,
      },
    ]);
    render(<CalendarApplication />);
    const block = await screen.findByTitle(blockTitled("Essay draft"));
    const official = screen.getByTitle(blockTitled("Maths Unit 7 Test"));
    expect(block.style.width).toBe("calc(50% - 8px)");
    expect(official.style.width).toBe("calc(50% - 8px)");
    expect(new Set([block.style.left, official.style.left]).size).toBe(2);
    fireEvent.contextMenu(block);
    expect(screen.getByLabelText("Essay draft details")).toBeTruthy();
    fireEvent.contextMenu(official);
    expect(screen.getByLabelText("Maths Unit 7 Test details")).toBeTruthy();
  });

  it("removes a personal event after confirmation", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 29, 8, 0) });
    installFetch(
      (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.action === "removePersonalItem")
          return json(200, { ok: true, data: { itemId: body.itemId } });
        return undefined;
      },
      [
        {
          ...workBlock(),
          id: "event-2",
          kind: "personal_event",
          title: "Dentist",
          taskItemId: undefined,
        },
      ],
    );
    render(<CalendarApplication />);
    fireEvent.click(await screen.findByTitle(blockTitled("Dentist")));
    fireEvent.click(screen.getByRole("button", { name: "Remove from Calendar" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Remove",
      }),
    );
    await waitFor(() =>
      expect(posts.some((post) => post.action === "removePersonalItem" && post.itemId === "event-2")).toBe(true),
    );
    await waitFor(() => expect(screen.queryByTitle(blockTitled("Dentist"))).toBeNull());
  });

  it("moves and lengthens a personal event, but never an official one", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 29, 8, 0) });
    installFetch(
      (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.action === "resizeWorkBlock")
          return json(200, {
            ok: true,
            data: { ...workBlock(), id: "event-3", kind: "personal_event", title: "Dentist", taskItemId: undefined, endAt: body.endAt, revision: 4 },
          });
        return undefined;
      },
      [
        { ...workBlock(), id: "event-3", kind: "personal_event", title: "Dentist", taskItemId: undefined },
        {
          ...workBlock(),
          id: "official-1",
          kind: "official_event",
          title: "Assembly",
          taskItemId: undefined,
          sourceLocked: true,
          startAt: Date.parse("2026-09-29T09:00:00Z"),
          endAt: Date.parse("2026-09-29T10:00:00Z"),
        },
      ],
    );
    render(<CalendarApplication />);
    const dentist = await screen.findByTitle(blockTitled("Dentist"));
    expect(dentist.getAttribute("draggable")).toBe("true");
    expect(screen.getByTitle(blockTitled("Assembly")).getAttribute("draggable")).not.toBe("true");

    fireEvent.click(dentist);
    fireEvent.click(screen.getByRole("button", { name: "30 minutes longer" }));
    await waitFor(() =>
      expect(
        posts.some(
          (post) =>
            post.action === "resizeWorkBlock" &&
            post.itemId === "event-3" &&
            post.endAt === Date.parse("2026-09-29T15:30:00Z"),
        ),
      ).toBe(true),
    );
  });

  it("keeps a plan's scheduled block's own actions a right-click away", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 29, 8, 0) });
    installFetch(() => undefined, [
      {
        ...workBlock(),
        taskItemId: undefined,
        planArtifactId: "plan-1",
        planTaskId: "task-1",
        linkedWorkIds: ["plan-1"],
      },
    ]);
    render(<CalendarApplication />);
    fireEvent.contextMenu(await screen.findByTitle(blockTitled("Essay draft")));
    expect(screen.getByRole("button", { name: "30 minutes longer" })).toBeTruthy();
  });

  it("does not offer removal for an official school record", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 29, 8, 0) });
    installFetch(() => undefined, [
      {
        ...workBlock(),
        id: "class-1",
        kind: "official_event",
        title: "Maths HL",
        taskItemId: undefined,
        sourceLocked: true,
      },
    ]);
    render(<CalendarApplication />);
    fireEvent.click(await screen.findByTitle(blockTitled("Maths HL")));
    expect(screen.queryByRole("button", { name: "Remove from Calendar" })).toBeNull();
  });

  it("draws an event's notes as rich text with the shared renderer, never as markup", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 29, 8, 0) });
    installFetch(() => undefined, [
      { ...workBlock(), notes: "<p>Bring the <strong>lab book</strong></p><ul><li><p>Room 4</p></li></ul>" },
    ]);
    render(<CalendarApplication />);
    fireEvent.click(await screen.findByTitle(blockTitled("Essay draft")));
    const details = screen.getByLabelText("Essay draft details");
    const prose = details.querySelector(".spectra-prose");
    expect(prose).toBeTruthy();
    expect(prose!.querySelector("strong")?.textContent).toBe("lab book");
    expect(prose!.querySelector("ul li")?.textContent).toBe("Room 4");
    expect(details.textContent).not.toContain("<p>");
  });

  it("draws Markdown notes the same way, and shows no Notes for an empty editor value", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 29, 8, 0) });
    installFetch(() => undefined, [
      { ...workBlock(), notes: "Read **chapter 3** first" },
      { ...workBlock(), id: "block-empty", title: "Empty notes", taskItemId: "task-2", notes: "<p></p>", startAt: Date.parse("2026-09-29T09:00:00Z"), endAt: Date.parse("2026-09-29T10:00:00Z") },
    ]);
    render(<CalendarApplication />);
    fireEvent.click(await screen.findByTitle(blockTitled("Essay draft")));
    const details = screen.getByLabelText("Essay draft details");
    expect(details.querySelector(".spectra-prose strong")?.textContent).toBe("chapter 3");
    expect(details.textContent).not.toContain("**");
    fireEvent.click(await screen.findByTitle(blockTitled("Empty notes")));
    expect(within(screen.getByLabelText("Empty notes details")).queryByText("Notes")).toBeNull();
  });

  it("opens a plan's work in the Side instead of a page of its own", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 29, 8, 0) });
    const { spectraBus } = await import("../events");
    const opened = vi.fn();
    const stop = spectraBus.handle("work.open", opened);
    installFetch(() => undefined, [
      { ...workBlock(), taskItemId: undefined, planArtifactId: "plan-1", planTaskId: "task-1", linkedWorkIds: ["plan-1"] },
    ]);
    render(<CalendarApplication />);
    fireEvent.click(await screen.findByTitle(blockTitled("Essay draft")));
    expect(opened).toHaveBeenCalledWith({ workId: "plan-1" });
    stop();
  });
});

function workBlock() {
  return {
    id: "block-1",
    kind: "scheduled_work_block",
    title: "Essay draft",
    startAt: Date.parse("2026-09-29T14:00:00Z"),
    endAt: Date.parse("2026-09-29T15:00:00Z"),
    allDay: false,
    timezone: "Europe/Madrid",
    timePrecision: "exact",
    status: "active",
    sourceLocked: false,
    taskItemId: "task-1",
    linkedWorkIds: [],
    revision: 3,
  };
}
