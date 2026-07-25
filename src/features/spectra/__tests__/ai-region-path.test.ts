import { describe, expect, it } from "vitest";
import {
  contentDerivedHighlightPaths,
  creationHighlightFallbackPaths,
  expandAppendPointer,
  highlightPathsFromContentPatchChanges,
  materializeAiChangedPaths,
  normalizeAiPointer,
  pathTouches,
  preferStreamingContentSource,
  resolveAiHighlightPaths,
  sheetsAiTouchesCell,
  sheetsAiTouchesColumn,
  sheetsCellHighlightPaths,
  updatingHighlightFallbackPaths,
} from "../components/ai-region-path";

describe("resolveAiHighlightPaths", () => {
  it("prefers concrete preview and effect paths", () => {
    expect(
      resolveAiHighlightPaths({
        previewPaths: ["/nodes/0"],
        effectChangedPaths: ["/edges/1"],
        creationFallbackPaths: ["/"],
      }),
    ).toEqual(["/nodes/0", "/edges/1", "/"]);
  });

  it("falls back when create preview/effects are empty shells", () => {
    expect(
      resolveAiHighlightPaths({
        previewPaths: [],
        effectChangedPaths: [],
        effectRegionPointers: [],
        creationFallbackPaths: creationHighlightFallbackPaths(
          "creating",
          "whiteboard",
        ),
      }),
    ).toEqual(["/"]);
  });

  it("does not flood sheets via create fallback", () => {
    expect(
      resolveAiHighlightPaths({
        previewPaths: [],
        creationFallbackPaths: creationHighlightFallbackPaths(
          "creating",
          "sheets",
        ),
      }),
    ).toEqual([]);
  });

  it("lights whiteboard node and edge targets via whole-create /", () => {
    const paths = resolveAiHighlightPaths({
      previewPaths: [],
      creationFallbackPaths: ["/"],
    });
    expect(pathTouches(paths, "/nodes/0")).toBe(true);
    expect(pathTouches(paths, "/edges/2")).toBe(true);
    expect(pathTouches(paths, "/profile/purpose")).toBe(true);
  });

  it("unions content-derived paths when structural pointers miss collections", () => {
    const paths = resolveAiHighlightPaths({
      effectRegionPointers: ["/pages/0", "/layers/0"],
      contentDerivedPaths: ["/nodes/0", "/nodes/1", "/edges/0"],
    });
    expect(pathTouches(paths, "/nodes/0")).toBe(true);
    expect(pathTouches(paths, "/nodes/1")).toBe(true);
    expect(pathTouches(paths, "/edges/0")).toBe(true);
  });

  it("normalizes pointers missing a leading slash", () => {
    expect(normalizeAiPointer("nodes/0")).toBe("/nodes/0");
    expect(
      pathTouches(
        resolveAiHighlightPaths({ previewPaths: ["nodes/0"] }),
        "/nodes/0",
      ),
    ).toBe(true);
  });

  it("uses sheets cell-derived paths when create concrete paths are empty", () => {
    const derived = contentDerivedHighlightPaths("sheets", {
      sheets: [{ cells: { A1: { value: "x" }, B2: { value: 1 } } }],
    });
    const paths = resolveAiHighlightPaths({
      previewPaths: [],
      creationFallbackPaths: creationHighlightFallbackPaths("creating", "sheets"),
      contentDerivedPaths: derived,
    });
    expect(paths).toEqual(["/sheets/0/cells/A1", "/sheets/0/cells/B2"]);
    expect(sheetsAiTouchesCell(paths, 0, "A1")).toBe(true);
    expect(sheetsAiTouchesCell(paths, 0, "C3")).toBe(false);
  });
});

describe("creationHighlightFallbackPaths", () => {
  it("covers presentation, code, timetable, and agent creates", () => {
    for (const key of [
      "presentation",
      "code",
      "timetable",
      "agent",
      "whiteboard",
    ] as const) {
      expect(creationHighlightFallbackPaths("creating", key)).toEqual(["/"]);
    }
    expect(creationHighlightFallbackPaths("updating", "whiteboard")).toEqual(
      [],
    );
  });
});

describe("updatingHighlightFallbackPaths", () => {
  it("lights non-sheets focused edits while concrete paths are empty", () => {
    expect(
      updatingHighlightFallbackPaths("updating", "document", false),
    ).toEqual(["/"]);
    expect(
      updatingHighlightFallbackPaths("updating", "quiz", false),
    ).toEqual(["/"]);
    expect(
      updatingHighlightFallbackPaths("updating", "whiteboard", false),
    ).toEqual(["/"]);
  });

  it("drops the fallback once concrete paths stream in", () => {
    expect(
      updatingHighlightFallbackPaths("updating", "document", true),
    ).toEqual([]);
  });

  it("never floods sheets via whole-artifact /", () => {
    expect(
      updatingHighlightFallbackPaths("updating", "sheets", false),
    ).toEqual([]);
  });

  it("ignores creating/idle states", () => {
    expect(
      updatingHighlightFallbackPaths("creating", "document", false),
    ).toEqual([]);
    expect(
      updatingHighlightFallbackPaths("edited", "document", false),
    ).toEqual([]);
  });
});

describe("contentDerivedHighlightPaths", () => {
  it("expands whiteboard nodes and edges", () => {
    expect(
      contentDerivedHighlightPaths("whiteboard", {
        nodes: [{ id: "a" }, { id: "b" }],
        edges: [{ id: "e1" }],
      }),
    ).toEqual(["/nodes/0", "/nodes/1", "/edges/0"]);
  });

  it("expands presentation slides", () => {
    expect(
      contentDerivedHighlightPaths("presentation", {
        slides: [{ id: "s1" }, { id: "s2" }],
      }),
    ).toEqual(["/slides/0", "/slides/1"]);
  });

  it("expands timetable events and code files", () => {
    expect(
      contentDerivedHighlightPaths("timetable", {
        events: [{ id: "e1" }, { id: "e2" }],
      }),
    ).toEqual(["/events/0", "/events/1"]);
    expect(
      contentDerivedHighlightPaths("code", {
        files: [{ id: "f1", path: "main.py", source: "print(1)" }],
      }),
    ).toEqual(["/files/0"]);
  });

  it("expands sheets cells without emitting /", () => {
    expect(
      contentDerivedHighlightPaths("sheets", {
        sheets: [{ cells: { A1: { value: "Km" }, B1: { value: 1.2 } } }],
      }),
    ).toEqual(["/sheets/0/cells/A1", "/sheets/0/cells/B1"]);
  });
});

describe("expandAppendPointer / materializeAiChangedPaths", () => {
  it("maps /questions/- onto the last question after append", () => {
    const content = {
      questions: [{ id: "q1" }, { id: "q2" }, { id: "q3" }],
    };
    expect(expandAppendPointer("/questions/-", content)).toBe("/questions/2");
    expect(
      materializeAiChangedPaths(["/questions/-"], content, "quiz"),
    ).toEqual(["/questions/2"]);
    expect(
      pathTouches(
        materializeAiChangedPaths(["/questions/-"], content, "quiz"),
        "/questions/2",
      ),
    ).toBe(true);
  });

  it("maps /cards/- and /events/- the same way", () => {
    expect(
      expandAppendPointer("/cards/-", { cards: [{ id: "a" }, { id: "b" }] }),
    ).toBe("/cards/1");
    expect(
      expandAppendPointer("/events/-", { events: [{ id: "e1" }] }),
    ).toBe("/events/0");
  });

  it("expands sheets / into concrete cells and uppercases addresses", () => {
    const content = {
      sheets: [{ cells: { a1: { value: 1 }, B2: { value: 2 } } }],
    };
    expect(materializeAiChangedPaths(["/"], content, "sheets").sort()).toEqual(
      ["/sheets/0/cells/A1", "/sheets/0/cells/B2"].sort(),
    );
    expect(
      materializeAiChangedPaths(["/sheets/0/cells/d1"], content, "sheets"),
    ).toEqual(["/sheets/0/cells/D1"]);
  });

  it("expands sheets cells-map patch changes to authored cells only", () => {
    const content = {
      sheets: [
        {
          cells: {
            A1: { value: "Enzyme" },
            D1: { value: "Km below 5?" },
            D2: { formula: "=B2<5" },
          },
        },
      ],
    };
    const paths = highlightPathsFromContentPatchChanges(
      [
        {
          path: "/sheets/0/cells",
          value: {
            D1: { value: "Km below 5?" },
            D2: { formula: "=B2<5" },
          },
        },
      ],
      content,
      "sheets",
    );
    expect(paths.sort()).toEqual(
      ["/sheets/0/cells/D1", "/sheets/0/cells/D2"].sort(),
    );
    expect(sheetsAiTouchesCell(paths, 0, "D1")).toBe(true);
    expect(sheetsAiTouchesCell(paths, 0, "A1")).toBe(false);
    expect(sheetsAiTouchesColumn(paths, 0, 3)).toBe(true);
    expect(sheetsAiTouchesColumn(paths, 0, 0)).toBe(false);
  });

  it("does not let bare / flood sheets cells before materialize", () => {
    expect(sheetsAiTouchesCell(["/"], 0, "A1")).toBe(false);
    expect(sheetsAiTouchesCell(["/sheets/0"], 0, "A1")).toBe(false);
    expect(sheetsAiTouchesColumn(["/"], 0, 0)).toBe(false);
  });

  it("path-prefix lights cells when /sheets/N/cells lags exact addresses", () => {
    expect(sheetsAiTouchesCell(["/sheets/0/cells"], 0, "A1")).toBe(true);
    expect(sheetsAiTouchesCell(["/sheets/0/cells"], 0, "Z9")).toBe(true);
    expect(sheetsAiTouchesCell(["/sheets/1/cells"], 0, "A1")).toBe(false);
  });

  it("materializes lagging /sheets/N/cells into concrete addresses when present", () => {
    const content = {
      sheets: [{ cells: { A1: { value: 1 }, C2: { value: 2 } } }],
    };
    expect(
      materializeAiChangedPaths(["/sheets/0/cells"], content, "sheets").sort(),
    ).toEqual(["/sheets/0/cells/A1", "/sheets/0/cells/C2"].sort());
  });
});

describe("sheetsCellHighlightPaths", () => {
  it("scopes to a single sheet when requested", () => {
    expect(
      sheetsCellHighlightPaths(
        {
          sheets: [
            { cells: { A1: { value: 1 } } },
            { cells: { B1: { value: 2 } } },
          ],
        },
        "/sheets/1",
      ),
    ).toEqual(["/sheets/1/cells/B1"]);
  });
});

describe("preferStreamingContentSource", () => {
  it("prefers richer live content over lagging preview during create", () => {
    expect(
      preferStreamingContentSource({
        local: { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }] },
        preview: { nodes: [{ id: "a" }] },
        blueprintKey: "whiteboard",
        aiState: "creating",
      }),
    ).toBe("local");
  });

  it("prefers richer preview when live is still the empty shell", () => {
    expect(
      preferStreamingContentSource({
        local: { slides: [{ id: "s1" }] },
        preview: { slides: [{ id: "s1" }, { id: "s2" }, { id: "s3" }] },
        blueprintKey: "presentation",
        aiState: "creating",
      }),
    ).toBe("preview");
  });

  it("prefers richer sheets preview by cell count", () => {
    expect(
      preferStreamingContentSource({
        local: { sheets: [{ cells: { A1: { value: 1 } } }] },
        preview: {
          sheets: [{ cells: { A1: { value: 1 }, B1: { value: 2 }, C1: { value: 3 } } }],
        },
        blueprintKey: "sheets",
        aiState: "creating",
      }),
    ).toBe("preview");
  });
});

describe("focused-edit catch-up lighting", () => {
  it("keeps concrete quiz append path after materialize (no whole-list flood)", () => {
    const content = {
      questions: Array.from({ length: 11 }, (_, index) => ({
        id: `q${index + 1}`,
      })),
    };
    const concrete = materializeAiChangedPaths(
      ["/questions/-"],
      content,
      "quiz",
    );
    const derived = contentDerivedHighlightPaths("quiz", content);
    const paths = resolveAiHighlightPaths({
      previewPaths: concrete,
      contentDerivedPaths: derived,
    });
    expect(paths).toEqual(["/questions/10"]);
    expect(pathTouches(paths, "/questions/10")).toBe(true);
    expect(pathTouches(paths, "/questions/0")).toBe(false);
  });

  it("lights whiteboard nodes from derived paths when only pages/layers arrived", () => {
    const paths = resolveAiHighlightPaths({
      effectRegionPointers: ["/pages/0", "/layers/0"],
      contentDerivedPaths: contentDerivedHighlightPaths("whiteboard", {
        nodes: [{ id: "n1" }],
        edges: [{ id: "e1" }],
      }),
      creationFallbackPaths: creationHighlightFallbackPaths(
        "creating",
        "whiteboard",
      ),
    });
    expect(pathTouches(paths, "/nodes/0")).toBe(true);
    expect(pathTouches(paths, "/edges/0")).toBe(true);
  });

  it("lights mid-edit document/quiz studios while changedPaths are still empty", () => {
    for (const key of ["document", "quiz", "presentation", "code"] as const) {
      const fallback = updatingHighlightFallbackPaths("updating", key, false);
      const paths = resolveAiHighlightPaths({
        previewPaths: [],
        effectChangedPaths: [],
        creationFallbackPaths: fallback,
        contentDerivedPaths:
          key === "document"
            ? contentDerivedHighlightPaths("document", {
                blocks: [{ id: "b1", text: "Hi" }],
              })
            : key === "quiz"
              ? contentDerivedHighlightPaths("quiz", {
                  questions: [{ id: "q1" }],
                })
              : key === "presentation"
                ? contentDerivedHighlightPaths("presentation", {
                    slides: [{ id: "s1" }],
                  })
                : contentDerivedHighlightPaths("code", {
                    files: [{ id: "f1", path: "main.py" }],
                  }),
      });
      expect(paths.includes("/")).toBe(true);
      expect(pathTouches(paths, "/")).toBe(true);
    }
  });

  it("does not keep sticky / once focused-edit concrete paths arrive", () => {
    const paths = resolveAiHighlightPaths({
      previewPaths: ["/questions/4"],
      creationFallbackPaths: updatingHighlightFallbackPaths(
        "updating",
        "quiz",
        true,
      ),
      contentDerivedPaths: contentDerivedHighlightPaths("quiz", {
        questions: [{ id: "q1" }, { id: "q2" }, { id: "q3" }, { id: "q4" }, { id: "q5" }],
      }),
    });
    expect(paths).toEqual(["/questions/4"]);
    expect(pathTouches(paths, "/questions/4")).toBe(true);
    expect(pathTouches(paths, "/questions/0")).toBe(false);
  });

  it("path-prefix lights sheets mid-edit before exact cell addresses stream", () => {
    const content = {
      sheets: [{ cells: { A1: { value: "Km" }, B1: { value: 3.2 } } }],
    };
    const coarse = materializeAiChangedPaths(
      ["/sheets/0/cells"],
      content,
      "sheets",
    );
    const paths = resolveAiHighlightPaths({
      previewPaths: coarse,
      creationFallbackPaths: updatingHighlightFallbackPaths(
        "updating",
        "sheets",
        coarse.length > 0,
      ),
    });
    expect(sheetsAiTouchesCell(paths, 0, "A1")).toBe(true);
    expect(sheetsAiTouchesCell(paths, 0, "B1")).toBe(true);
  });
});
