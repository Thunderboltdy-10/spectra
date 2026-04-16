import { describe, expect, it } from "vitest";
import { MAX_RAG_SOURCES, limitRagRetrievalSources, type RetrievalResult } from "@/lib/orchestrator/retrieval";
import { retrieveManagebacRuntimeContext } from "@/lib/managebac/client";

describe("limitRagRetrievalSources", () => {
  it("caps retrieval to at most five unique source files", () => {
    const result: RetrievalResult = {
      citations: [
        { filename: "A.pdf", sourceType: "pack", text: "A", score: 0.9 },
        { filename: "B.pdf", sourceType: "pack", text: "B", score: 0.88 },
        { filename: "C.pdf", sourceType: "pack", text: "C", score: 0.87 },
        { filename: "D.pdf", sourceType: "pack", text: "D", score: 0.86 },
        { filename: "E.pdf", sourceType: "pack", text: "E", score: 0.85 },
        { filename: "F.pdf", sourceType: "pack", text: "F", score: 0.84 },
      ],
      sourceBlock: "raw",
    };

    const limited = limitRagRetrievalSources(result);
    expect(limited.citations).toHaveLength(MAX_RAG_SOURCES);
    expect(limited.citations.map((citation) => citation.filename)).toEqual(["A.pdf", "B.pdf", "C.pdf", "D.pdf", "E.pdf"]);
  });

  it("deduplicates by filename before applying cap", () => {
    const result: RetrievalResult = {
      citations: [
        { filename: "Physics Notes.pdf", sourceType: "pack", text: "first", score: 0.6 },
        { filename: "physics notes.pdf", sourceType: "pack", text: "second", score: 0.59 },
        { filename: "Chemistry.pdf", sourceType: "pack", text: "chem", score: 0.58 },
      ],
      sourceBlock: "raw",
    };

    const limited = limitRagRetrievalSources(result);
    expect(limited.citations).toHaveLength(2);
    expect(limited.citations[0]?.filename).toBe("Physics Notes.pdf");
    expect(limited.citations[1]?.filename).toBe("Chemistry.pdf");
  });
});


describe("retrieveManagebacRuntimeContext", () => {
  it("returns the most relevant normalized ManageBac records for a prompt", () => {
    const result = retrieveManagebacRuntimeContext({
      message: "What assignments are due soon for biology and what does my timetable say?",
      snapshot: {
        available: true,
        student: { id: "stu_1", name: "Ava", gradeLevel: "11", email: "ava@example.com" },
        workstreams: [
          { _id: "ws_bio", title: "Biology HL", subjectCode: "BIO", description: "Internal assessment prep" },
        ],
        plannerItems: [
          { _id: "plan_1", title: "Biology IA draft", description: "Draft due soon", dueAt: Date.UTC(2026, 3, 20) },
        ],
        artifacts: [
          { _id: "art_1", title: "ManageBac timetable", description: "Monday period 1 Biology" },
        ],
        announcements: [
          { id: "ann_1", title: "CAS deadline", summary: "Upload evidence this week" },
        ],
      },
    });

    expect(result.available).toBe(true);
    expect(result.items[0]?.kind).toBe("assignment");
    expect(result.sourceBlock).toContain("MANAGEBAC CONTEXT");
    expect(result.sourceBlock).toContain("Biology IA draft");
  });
});
