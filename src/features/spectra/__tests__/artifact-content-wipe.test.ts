import { describe, expect, it, vi } from "vitest";
import { classifyArtifactContentWipe } from "../operations/artifact-content-wipe";
import { applyResolvedContentPatch } from "../ai/document-content-patch";
import { canonicalArtifactWriteContent } from "../operations/artifact-write-content";
import { ARTIFACT_TYPE_KEYS } from "../artifacts/types";

const document = (text: string) => ({ blocks: [{ id: "body", type: "paragraph", text }] });
const presentation = (objects: unknown[]) => ({ theme: { id: "default" }, slides: [{ id: "slide", title: "Slide", objects }] });
const object = (type: string, content: unknown) => ({ id: "object", type, content, x: 10, y: 10, width: 200, height: 100, rotation: 0 });
const workbook = (cells: Record<string, unknown>, charts: unknown[] = []) => ({
  workbook: { calculationMode: "automatic", locale: "en" },
  sheets: [{ id: "sheet", name: "Sheet", cells, tables: [], charts }], activeSheetId: "sheet",
});

describe("artifact content deletion classification", () => {
  it.each(ARTIFACT_TYPE_KEYS)("canonical %s defaults are repeatable and idempotent", type => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const first = canonicalArtifactWriteContent(type, {});
      now.mockReturnValue(2_000);
      expect(canonicalArtifactWriteContent(type, {})).toEqual(first);
      expect(canonicalArtifactWriteContent(type, first)).toEqual(first);
    } finally {
      now.mockRestore();
    }
  });

  it("normalizes missing and colliding Code identities consistently without losing a file", () => {
    const content = {
      files: [
        { id: "kept", path: "a.js", source: "1" },
        { id: "kept", path: "b.js", source: "2" },
        { path: "c.js", source: "3" },
      ],
      tests: [{ source: "assert(1)" }, { id: "test-1", source: "assert(2)" }],
      resourceBindings: [{ artifactId: "source-1" }, { id: "binding-1", artifactId: "source-2" }],
      parameters: [{ key: "x", type: "number" }, { id: "parameter-1", key: "y", type: "number" }],
    };
    const first = canonicalArtifactWriteContent("code", content) as typeof content;
    expect(first.files.map(file => file.source)).toEqual(["1", "2", "3"]);
    expect(new Set(first.files.map(file => file.id)).size).toBe(3);
    expect(canonicalArtifactWriteContent("code", content)).toEqual(first);
    expect(canonicalArtifactWriteContent("code", first)).toEqual(first);
  });

  it("does not invent current timestamps when canonicalizing historical Foundry content", () => {
    const section = { id: "s", kind: "text", facet: "objective", value: { kind: "text", text: "Teach" } };
    const content = { foundry: { state: { sections: [section], history: [{ id: "h", action: "answered", previous: section }] } } };
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const first = canonicalArtifactWriteContent("agent", content);
      now.mockReturnValue(2_000);
      expect(canonicalArtifactWriteContent("agent", content)).toEqual(first);
    } finally {
      now.mockRestore();
    }
  });

  it("detects an empty document through the same resolved patch path as execution", () => {
    const before = document("Keep this authored explanation");
    const after = applyResolvedContentPatch(before, { changes: [{ path: "/blocks/id:body/text", value: "" }] });
    expect(classifyArtifactContentWipe("document", before, after).fullContentDeletion).toBe(true);
  });

  it("does not let titles, summaries, citations metadata or empty styled paragraphs disguise a body wipe", () => {
    const after = { ...document("  "), outline: [{ id: "old", title: "Cached outline", level: 1 }], sources: [{ id: "source", title: "Retained source" }] };
    expect(classifyArtifactContentWipe("document", document("Authored text"), after).fullContentDeletion).toBe(true);
  });

  it("allows blank-to-blank editing and substantive rewrites of any length", () => {
    expect(classifyArtifactContentWipe("document", document(""), document(" ")).fullContentDeletion).toBe(false);
    expect(classifyArtifactContentWipe("document", document("A very long section"), document("x")).fullContentDeletion).toBe(false);
    expect(classifyArtifactContentWipe("document", document(""), document("New work")).fullContentDeletion).toBe(false);
  });

  it("treats an actual embedded image as authored document content", () => {
    const before = { blocks: [], tiptap: { type: "doc", content: [{ type: "image", attrs: { src: "https://example.test/fixture.png" } }] } };
    expect(classifyArtifactContentWipe("document", before, document("")).fullContentDeletion).toBe(true);
  });

  it("requires approval for clearing every slide object even if notes remain", () => {
    const before = presentation([object("text", { text: "Authored slide" })]);
    const after = presentation([]);
    Object.assign(after.slides[0], { speakerNotes: "Retained notes" });
    expect(classifyArtifactContentWipe("presentation", before, after).fullContentDeletion).toBe(true);
    expect(classifyArtifactContentWipe("presentation", before, { theme: { id: "default" }, slides: [] }).fullContentDeletion).toBe(true);
  });

  it("preserves ordinary diagram rewrites using real unlabeled shapes", () => {
    const before = presentation([object("text", { text: "Replace with a diagram" })]);
    const after = presentation([object("shape", { shape: "ellipse", text: "" })]);
    expect(classifyArtifactContentWipe("presentation", before, after).fullContentDeletion).toBe(false);
  });

  it("treats zero, false and formulas as populated data, not empty styling", () => {
    const before = workbook({ A1: { value: 0 }, A2: { value: false }, A3: { formula: "=SUM(A1)" } });
    const after = workbook({ A1: { style: { bold: true } } });
    expect(classifyArtifactContentWipe("sheets", before, after).fullContentDeletion).toBe(true);
    expect(classifyArtifactContentWipe("sheets", before, workbook({ B1: { value: 0 } })).fullContentDeletion).toBe(false);
    expect(classifyArtifactContentWipe("sheets", workbook({}), after).fullContentDeletion).toBe(false);
  });

  it("does not let residual chart configuration disguise deleting all sheet values", () => {
    const before = workbook({ A1: { value: 7 } });
    const after = workbook({}, [{ id: "chart", type: "bar", title: "Residual", range: "A1:A2" }]);
    expect(classifyArtifactContentWipe("sheets", before, after).fullContentDeletion).toBe(true);
  });

  it("detects cumulative clear operations on a single artifact", () => {
    const before = { blocks: [{ id: "a", type: "paragraph", text: "First" }, { id: "b", type: "paragraph", text: "Second" }] };
    const middle = applyResolvedContentPatch(before, { changes: [{ path: "/blocks/id:a/text", value: "" }] });
    const after = applyResolvedContentPatch(middle, { changes: [{ path: "/blocks/id:b/text", value: "" }] });
    expect(classifyArtifactContentWipe("document", before, middle).fullContentDeletion).toBe(false);
    expect(classifyArtifactContentWipe("document", middle, after).fullContentDeletion).toBe(true);
  });

  it("treats removal of all Code files as clearing even when normalization creates a starter file", () => {
    const before = { files: [{ id: "file", path: "main.js", language: "javascript", source: "console.log(7)" }] };
    expect(classifyArtifactContentWipe("code", before, { files: [] }).fullContentDeletion).toBe(true);
    expect(classifyArtifactContentWipe("code", before, { files: [{ id: "new", path: "new.js", source: "0" }] }).fullContentDeletion).toBe(false);
  });

  it("recognizes authored equations and native images via the canonical document adapter", () => {
    const equation = { blocks: [{ id: "math", type: "math", latex: "x^2" }] };
    expect(classifyArtifactContentWipe("document", equation, document("")).fullContentDeletion).toBe(true);
    const native = { tiptap: { type: "doc", content: [{ type: "nativeDocxImage", attrs: { native: { partName: "word/media/image1.png" } } }] } };
    expect(classifyArtifactContentWipe("document", native, document("")).fullContentDeletion).toBe(true);
  });

  it("does not let generated true/false choices conceal an emptied question", () => {
    const before = { questions: [{ id: "q", type: "true_false", prompt: "The Earth orbits the Sun", correctAnswer: "True" }] };
    const after = { questions: [{ id: "q", type: "true_false", prompt: "", correctAnswer: "" }] };
    expect(classifyArtifactContentWipe("quiz", before, after).fullContentDeletion).toBe(true);
  });

  it("reads current multi-task plans without letting obsolete legacy titles conceal a wipe", () => {
    const before = { taskTitle: "Legacy title", tasks: [{ id: "t", title: "Study", description: "Revise" }] };
    expect(classifyArtifactContentWipe("planner_task", before, { taskTitle: "Legacy title", tasks: [] }).fullContentDeletion).toBe(true);
  });

  it("reads whiteboard string content through the current node text adapter", () => {
    const before = { nodes: [{ id: "n", type: "text", content: "Authored idea" }], edges: [] };
    expect(classifyArtifactContentWipe("whiteboard", before, { nodes: [], edges: [] }).fullContentDeletion).toBe(true);
  });

  it("counts Foundry procedures and extracted source text while ignoring empty binding metadata", () => {
    const before = { foundry: { skills: [{ id: "s", name: "Research", procedure: [{ order: 1, action: "Compare the source arguments" }] }] } };
    const empty = { foundry: { evidenceBindings: [{ id: "e", sourceId: "retained-source", label: "Source" }] } };
    expect(classifyArtifactContentWipe("agent", before, empty).fullContentDeletion).toBe(true);
    const extraction = { foundry: { evidenceBindings: [{ id: "e", sourceId: "source", extraction: { rules: [{ statement: "Compare the arguments" }] } }] } };
    expect(classifyArtifactContentWipe("agent", extraction, empty).fullContentDeletion).toBe(true);
  });

  it.each([
    ["quiz", { questions: [{ id: "q", prompt: "Explain", correctAnswer: "Answer", type: "short_answer" }] }, { questions: [{ id: "q", prompt: "", correctAnswer: "", type: "short_answer" }] }],
    ["flashcard_deck", { cards: [{ id: "c", front: "Term", back: "Meaning" }] }, { cards: [{ id: "c", front: "", back: "" }] }],
    ["planner_task", { taskTitle: "Study", description: "Prepare" }, { taskTitle: "", description: "" }],
    ["agent", { instructions: { regionId: "body", text: "Tutor mathematics" } }, { instructions: { regionId: "body", text: "" } }],
    ["timetable", { events: [{ id: "e", title: "Study", start: "2026-09-25T12:00:00Z", end: "2026-09-25T13:00:00Z", layerId: "personal" }] }, { events: [] }],
    ["whiteboard", { nodes: [{ id: "n", type: "text", content: { text: "Idea" }, x: 0, y: 0, width: 100, height: 100 }], edges: [] }, { nodes: [], edges: [] }],
  ] as const)("recognizes emptied %s authored content", (type, before, after) => {
    expect(classifyArtifactContentWipe(type, before, after).fullContentDeletion).toBe(true);
  });
});
