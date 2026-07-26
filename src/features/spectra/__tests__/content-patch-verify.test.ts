import { describe, expect, it } from "vitest";
import { contentPatchChangeMatchesSaved } from "../ai/content-patch-verify";

describe("content patch verification", () => {
  it("accepts a normalized first-item write at a numeric array slot", () => {
    expect(
      contentPatchChangeMatchesSaved(
        "/events/0",
        {
          title: "Enzyme inhibition retrieval practice",
          start: "2026-07-26T21:15:00+02:00",
          end: "2026-07-26T21:45:00+02:00",
          allDay: false,
        },
        {
          id: "event-1",
          layerId: "classes",
          title: "Enzyme inhibition retrieval practice",
          start: "2026-07-26T19:15:00.000Z",
          end: "2026-07-26T19:45:00.000Z",
          allDay: false,
          timezone: "Europe/Madrid",
          status: "confirmed",
          availability: "busy",
        },
      ),
    ).toBe(true);
  });

  it("verifies a timetable event after an unavailable layer is canonicalized", () => {
    const saved = {
      id: "event-1",
      layerId: "classes",
      title: "Enzyme inhibition retrieval practice",
      start: "2026-07-26T19:15:00.000Z",
      end: "2026-07-26T19:45:00.000Z",
      allDay: false,
      timezone: "Europe/Madrid",
      status: "confirmed" as const,
      availability: "busy" as const,
    };
    expect(
      contentPatchChangeMatchesSaved(
        "/events/0",
        {
          layerId: "study",
          title: "Enzyme inhibition retrieval practice",
          start: "2026-07-26T21:15:00+02:00",
          end: "2026-07-26T21:45:00+02:00",
          allDay: false,
        },
        saved,
        {
          blueprintKey: "timetable",
          artifactContent: {
            timezone: "Europe/Madrid",
            layers: [
              {
                id: "classes",
                name: "Classes",
                kind: "class",
                visible: true,
                color: "#26a879",
                authority: "school",
              },
            ],
            events: [saved],
          },
        },
      ),
    ).toBe(true);
  });
});
