import { describe, expect, it } from "vitest";
import {
  contentPatchChangeMatchesSaved,
  normalizeContentPatchShape,
} from "../ai/content-patch-verify";
import { coerceProposedOperation } from "@/app/api/spectra/run/loop/plan";
import { parseModelOperation } from "@/features/spectra/operations/schema";

describe("content patch verification", () => {
  it("accepts unicode dash and whitespace soft matches for document text", () => {
    expect(
      contentPatchChangeMatchesSaved(
        "/blocks/3/text",
        "Reversible inhibitors bind non-covalently to the enzyme-inhibitor complex.",
        "Reversible inhibitors bind non-covalently to the enzyme–inhibitor complex.",
        { blueprintKey: "document" },
      ),
    ).toBe(true);
  });

  it("accepts document text when a concurrent marker sits inside the authored span", () => {
    expect(
      contentPatchChangeMatchesSaved(
        "/blocks/3/text",
        "Reversible inhibitors bind non-covalently to the enzyme-inhibitor complex. Enzyme activity is restored when the inhibitor is removed by dialysis or dilution. G03-OK-final9",
        "other",
        {
          blueprintKey: "document",
          artifactContent: {
            blocks: [
              {
                id: "b3",
                type: "paragraph",
                text: "Reversible inhibitors bind non-covalently to the enzyme–inhibitor complex. Enzyme activity is restored when the inhibitor is removed by dialysis or dilution. G03-VERIFY-ms1ok9 G03-OK-final9",
              },
            ],
          },
        },
      ),
    ).toBe(true);
  });

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
                color: "var(--accent-mint)",
                authority: "school",
              },
            ],
            events: [saved],
          },
        },
      ),
    ).toBe(true);
  });

  it("accepts planner status aliases between in_progress and doing", () => {
    expect(
      contentPatchChangeMatchesSaved("/status", "in_progress", "doing", {
        blueprintKey: "planner_task",
      }),
    ).toBe(true);
    expect(
      contentPatchChangeMatchesSaved(
        "/content/status",
        "In Progress",
        "doing",
        {
          blueprintKey: "planner_task",
        },
      ),
    ).toBe(true);
  });

  it("rejects a same-region AI patch whose unique token never landed", () => {
    const saved =
      "P5V1-SAME-REGION P5V1-A-SAME P5V1-B-SAME P5V1-AI1-SAME";
    expect(
      contentPatchChangeMatchesSaved(
        "/blocks/8/text",
        "P5V1-SAME-REGION P5V1-A-SAME P5V1-B-SAME P5V1-AI2-SAME",
        saved,
        {
          blueprintKey: "document",
          artifactContent: {
            blocks: [{ id: "b8", type: "paragraph", text: saved }],
          },
        },
      ),
    ).toBe(false);
  });

  it("accepts a same-region AI patch when the unique token survived a concurrent peer token", () => {
    const saved =
      "P5V1-SAME-REGION P5V1-A-SAME P5V1-B-SAME P5V1-AI1-SAME P5V1-AI2-SAME";
    expect(
      contentPatchChangeMatchesSaved(
        "/blocks/8/text",
        "P5V1-SAME-REGION P5V1-A-SAME P5V1-B-SAME P5V1-AI2-SAME",
        saved,
        {
          blueprintKey: "document",
          artifactContent: {
            blocks: [{ id: "b8", type: "paragraph", text: saved }],
          },
        },
      ),
    ).toBe(true);
  });
});

describe("normalizeContentPatchShape (v5-ai-dock)", () => {
  it("wraps a bare changes array into { changes }", () => {
    expect(
      normalizeContentPatchShape([
        {
          path: "/blocks/0",
          value: {
            id: "intro",
            type: "paragraph",
            text: "A short one-sentence intro.",
          },
        },
      ]),
    ).toEqual({
      changes: [
        {
          path: "/blocks/0",
          value: {
            id: "intro",
            type: "paragraph",
            text: "A short one-sentence intro.",
          },
        },
      ],
    });
  });

  it("wraps a single {path,value} object and strips JSON Patch op", () => {
    expect(
      normalizeContentPatchShape({
        op: "replace",
        path: "/blocks/0/text",
        value: "Intro line",
      }),
    ).toEqual({
      changes: [{ path: "/blocks/0/text", value: "Intro line" }],
    });
  });

  it("lets coerceProposedOperation + parse accept array contentPatch document edits", () => {
    const coerced = coerceProposedOperation(
      {
        type: "artifact.update",
        targetArtifactId: "doc-1",
        blueprintKey: "document",
        contentPatch: [
          {
            path: "/blocks/0",
            value: {
              id: "intro",
              type: "paragraph",
              text: "A short one-sentence intro at the top.",
            },
          },
        ],
      },
      "context",
      {
        focusedArtifact: {
          id: "doc-1",
          blueprintKey: "document",
          content: { blocks: [{ id: "title", type: "heading", text: "Title" }] },
        },
      },
      "Add a short one-sentence intro at the top of this document.",
    );
    const operation = parseModelOperation(coerced);
    expect(operation.type).toBe("artifact.update");
    if (operation.type === "artifact.update") {
      expect(operation.input.artifactId).toBe("doc-1");
      expect(operation.input.blueprintKey).toBe("document");
      expect(operation.input.contentPatch).toEqual({
        changes: [
          {
            path: "/blocks/0",
            value: {
              id: "intro",
              type: "paragraph",
              text: "A short one-sentence intro at the top.",
            },
          },
        ],
      });
    }
  });
});
