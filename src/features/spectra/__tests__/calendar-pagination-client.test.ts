import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchCalendarOverview,
  mergeCalendarPages,
} from "../calendar/data/overview-client";
import { CALENDAR_DONE_CURSOR } from "../../../../shared/calendar-pagination";

function response(
  index: number,
  pagination: Record<string, string | null>,
  extra = {},
) {
  return new Response(
    JSON.stringify({
      data: {
        timezone: "Europe/Madrid",
        range: { from: 1000, to: 2000 },
        items: [
          {
            id: `event-${index}`,
            title: `Event ${index}`,
            kind: "personal_event",
            linkedWorkIds: [],
          },
        ],
        unscheduledTasks: [],
        partialTimeItems: [],
        sourceState: { kind: "not_connected" },
        migration: {
          complete: true,
          pageComplete: true,
          migratedArtifacts: 0,
          migratedEvents: 0,
          skippedEvents: 0,
        },
        pagination,
        ...extra,
      },
    }),
    { status: 200 },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Calendar client continuation", () => {
  it("traverses all independent streams without replaying completed discovery", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          1,
          { visible: "range-2", planner: "plan-2", migration: "migration-2" },
          {
            unscheduledTasks: [
              { id: "plan:one", title: "First plan", planArtifactId: "one" },
            ],
            migration: {
              complete: false,
              pageComplete: true,
              migratedArtifacts: 2,
              migratedEvents: 3,
              skippedEvents: 0,
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        response(
          2,
          { visible: "range-3" },
          {
            unscheduledTasks: [
              { id: "plan:two", title: "Second plan", planArtifactId: "two" },
            ],
            migration: {
              complete: true,
              pageComplete: true,
              migratedArtifacts: 1,
              migratedEvents: 4,
              skippedEvents: 0,
            },
          },
        ),
      )
      .mockResolvedValueOnce(response(3, {}));
    vi.stubGlobal("fetch", fetcher);
    const result = await fetchCalendarOverview(1000, 2000);
    expect(result.overview.items.map((item) => item.id)).toEqual([
      "event-1",
      "event-2",
      "event-3",
    ]);
    expect(result.overview.unscheduledTasks.map((item) => item.id)).toEqual([
      "plan:one",
      "plan:two",
    ]);
    expect(result.overview.migration).toMatchObject({
      complete: true,
      migratedArtifacts: 3,
      migratedEvents: 7,
    });
    expect(result.continuation).toBeNull();
    const second = new URL(fetcher.mock.calls[1][0], "https://example.test");
    expect(second.searchParams.get("unscheduledCursor")).toBe(
      CALENDAR_DONE_CURSOR,
    );
    expect(second.searchParams.get("plannerCursor")).toBe("plan-2");
    const third = new URL(fetcher.mock.calls[2][0], "https://example.test");
    expect(third.searchParams.get("plannerCursor")).toBe(CALENDAR_DONE_CURSOR);
    expect(third.searchParams.get("migrationCursor")).toBe(
      CALENDAR_DONE_CURSOR,
    );
  });

  it("stops at its request budget and resumes the exact continuation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(1, { visible: "page-2" }))
      .mockResolvedValueOnce(response(2, { visible: "page-3" }))
      .mockResolvedValueOnce(response(3, { visible: "page-4" }))
      .mockResolvedValueOnce(response(4, {}));
    vi.stubGlobal("fetch", fetcher);
    const first = await fetchCalendarOverview(1000, 2000, { maxPages: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(first.continuation?.cursors.visible).toBe("page-3");
    const rest = await fetchCalendarOverview(1000, 2000, {
      maxPages: 2,
      continuation: first.continuation!,
    });
    expect(rest.continuation).toBeNull();
    expect(
      mergeCalendarPages(first.overview, rest.overview).items,
    ).toHaveLength(4);
    expect(
      new URL(
        fetcher.mock.calls[2][0],
        "https://example.test",
      ).searchParams.get("cursor"),
    ).toBe("page-3");
  });

  it("does not publish or continue a response that arrives after abort", async () => {
    let resolveFetch!: (value: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const pending = fetchCalendarOverview(1000, 2000, {
      signal: controller.signal,
    });
    controller.abort();
    resolveFetch(response(1, { visible: "another-page" }));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports a stuck continuation and does not claim a failed migration completed", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(1, { visible: "same" }))
      .mockResolvedValueOnce(response(2, { visible: "same" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchCalendarOverview(1000, 2000)).rejects.toThrow(
      "next page",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockReset().mockResolvedValueOnce(
      response(
        1,
        {},
        {
          migration: {
            complete: false,
            pageComplete: false,
            migratedArtifacts: 1,
            migratedEvents: 0,
            skippedEvents: 0,
          },
        },
      ),
    );
    expect(
      (await fetchCalendarOverview(1000, 2000)).overview.migration.complete,
    ).toBe(false);
  });
});
