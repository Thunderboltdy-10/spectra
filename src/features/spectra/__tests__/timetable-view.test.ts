import { describe, expect, it } from "vitest";
import { pathTouches } from "../components/ai-region-path";
import {
  pickTimetableAnchorDate,
  sharedTimetableContent,
  timetableFocusMinutes,
  type TimetableEvent,
  type TimetableLayer,
} from "../timetable/model";

const studyLayer: TimetableLayer = {
  id: "study",
  name: "Study",
  kind: "study",
  visible: true,
  color: "var(--brand-primary)",
  authority: "workspace",
};

const classLayer: TimetableLayer = {
  id: "classes",
  name: "Classes",
  kind: "class",
  visible: true,
  color: "var(--accent-mint)",
  authority: "school",
};

function event(
  partial: Partial<TimetableEvent> & Pick<TimetableEvent, "id" | "start" | "end">,
): TimetableEvent {
  return {
    layerId: "study",
    title: "Block",
    allDay: false,
    ...partial,
  };
}

describe("pickTimetableAnchorDate", () => {
  it("anchors to the earliest upcoming event, not today", () => {
    const now = new Date("2026-07-25T10:00:00.000Z");
    expect(
      pickTimetableAnchorDate({
        timezone: "UTC",
        now,
        events: [
          event({
            id: "e1",
            start: "2026-07-27T09:00:00.000Z",
            end: "2026-07-27T10:30:00.000Z",
          }),
          event({
            id: "e2",
            start: "2026-07-28T09:00:00.000Z",
            end: "2026-07-28T10:00:00.000Z",
          }),
        ],
      }),
    ).toBe("2026-07-27");
  });

  it("falls back to the earliest past event when all are past", () => {
    const now = new Date("2026-08-10T10:00:00.000Z");
    expect(
      pickTimetableAnchorDate({
        timezone: "UTC",
        now,
        events: [
          event({
            id: "e1",
            start: "2026-07-20T09:00:00.000Z",
            end: "2026-07-20T10:00:00.000Z",
          }),
          event({
            id: "e2",
            start: "2026-07-22T09:00:00.000Z",
            end: "2026-07-22T10:00:00.000Z",
          }),
        ],
      }),
    ).toBe("2026-07-20");
  });
});

describe("timetableFocusMinutes", () => {
  it("counts study-layer minutes in view", () => {
    expect(
      timetableFocusMinutes(
        [
          event({
            id: "e1",
            start: "2026-07-27T09:00:00.000Z",
            end: "2026-07-27T10:30:00.000Z",
          }),
        ],
        [studyLayer],
      ),
    ).toBe(90);
  });

  it("falls back to busy events when no study/personal layers match", () => {
    expect(
      timetableFocusMinutes(
        [
          event({
            id: "e1",
            layerId: "classes",
            start: "2026-07-27T09:00:00.000Z",
            end: "2026-07-27T11:00:00.000Z",
          }),
        ],
        [classLayer],
      ),
    ).toBe(120);
  });
});

describe("sharedTimetableContent study layers", () => {
  it("keeps AI study layers without authority user so events are not wiped", () => {
    const shared = sharedTimetableContent({
      timezone: "UTC",
      layers: [
        {
          id: "revision",
          name: "Enzyme revision",
          kind: "study",
          visible: true,
          color: "var(--brand-primary)",
        },
      ],
      events: [
        {
          id: "e1",
          layerId: "revision",
          title: "Glycolysis",
          start: "2026-07-27T09:00:00.000Z",
          end: "2026-07-27T10:00:00.000Z",
          allDay: false,
        },
      ],
    });
    expect(shared.layers).toHaveLength(1);
    expect(shared.events).toHaveLength(1);
    expect(shared.events[0]?.title).toBe("Glycolysis");
  });

  it("promotes sole user-authority study layers so AI creates are not empty", () => {
    const shared = sharedTimetableContent({
      timezone: "UTC",
      layers: [
        {
          id: "personal-study",
          name: "Private study",
          kind: "study",
          visible: true,
          color: "var(--brand-primary)",
          authority: "user",
        },
      ],
      events: [
        {
          id: "e1",
          layerId: "personal-study",
          title: "Glycolysis",
          start: "2026-07-27T09:00:00.000Z",
          end: "2026-07-27T10:00:00.000Z",
          allDay: false,
        },
      ],
    });
    expect(shared.layers).toHaveLength(1);
    expect(shared.layers[0]?.authority).toBe("workspace");
    expect(shared.events).toHaveLength(1);
  });

  it("still strips user-authority layers when other shared events exist", () => {
    const shared = sharedTimetableContent({
      timezone: "UTC",
      layers: [
        {
          id: "classes",
          name: "Classes",
          kind: "class",
          visible: true,
          color: "var(--accent-mint)",
          authority: "school",
        },
        {
          id: "personal-study",
          name: "Private study",
          kind: "study",
          visible: true,
          color: "var(--brand-primary)",
          authority: "user",
        },
      ],
      events: [
        {
          id: "c1",
          layerId: "classes",
          title: "Biology",
          start: "2026-07-27T09:00:00.000Z",
          end: "2026-07-27T10:00:00.000Z",
          allDay: false,
        },
        {
          id: "e1",
          layerId: "personal-study",
          title: "Private",
          start: "2026-07-27T11:00:00.000Z",
          end: "2026-07-27T12:00:00.000Z",
          allDay: false,
        },
      ],
    });
    expect(shared.layers.map((layer) => layer.id)).toEqual(["classes"]);
    expect(shared.events).toHaveLength(1);
    expect(shared.events[0]?.title).toBe("Biology");
  });
});

describe("timetable AI region path matching", () => {
  it("lights event cards from whole-create / and concrete event paths", () => {
    expect(pathTouches(["/"], "/events/0")).toBe(true);
    expect(pathTouches(["/events/0", "/events/1"], "/events/1")).toBe(true);
    expect(pathTouches(["/events/0"], "/events/3")).toBe(false);
  });

  it("does not treat /events/N as a whole-collection match target", () => {
    // Studio checks includes("/") / includes("/events") separately so a
    // single-event edit does not light every card via pathTouches("/events").
    expect(pathTouches(["/events/0"], "/events")).toBe(true);
    expect(["/events/0"].includes("/events")).toBe(false);
    expect(["/"].includes("/")).toBe(true);
  });
});
