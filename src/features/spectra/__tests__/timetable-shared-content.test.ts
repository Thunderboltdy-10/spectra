import { describe, expect, it } from "vitest";
import { sharedTimetableContent } from "../timetable/model";

describe("sharedTimetableContent", () => {
  it("promotes study-layer events so AI schedules are not emptied", () => {
    const shared = sharedTimetableContent({
      timezone: "America/Chicago",
      layers: [
        {
          id: "study",
          name: "Study blocks",
          kind: "study",
          visible: true,
          color: "var(--brand-primary)",
          authority: "user",
          private: true,
        },
      ],
      events: [
        {
          id: "evt-1",
          layerId: "study",
          title: "Enzyme Structure",
          start: "2026-07-27T14:00:00.000Z",
          end: "2026-07-27T15:30:00.000Z",
          allDay: false,
        },
        {
          id: "evt-2",
          layerId: "study",
          title: "Kinetics",
          start: "2026-07-28T14:00:00.000Z",
          end: "2026-07-28T15:30:00.000Z",
          allDay: false,
        },
      ],
    });

    expect(shared.events).toHaveLength(2);
    expect(shared.layers.some((layer) => layer.id === "study")).toBe(true);
    expect(shared.layers.find((layer) => layer.id === "study")?.authority).toBe(
      "workspace",
    );
  });

  it("still strips unused private personal layers without inventing events", () => {
    const shared = sharedTimetableContent({
      timezone: "UTC",
      layers: [
        {
          id: "school",
          name: "School",
          kind: "school",
          visible: true,
          color: "var(--accent-cyan)",
          authority: "school",
        },
        {
          id: "personal",
          name: "Personal",
          kind: "personal",
          visible: true,
          color: "var(--accent-cyan)",
          authority: "user",
          private: true,
        },
      ],
      events: [],
    });

    expect(shared.events).toHaveLength(0);
    expect(shared.layers.map((layer) => layer.id)).toEqual(["school"]);
  });
});
