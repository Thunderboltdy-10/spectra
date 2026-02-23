import { describe, expect, it } from "vitest";
import { MAX_RAG_SOURCES, limitRagRetrievalSources, type RetrievalResult } from "@/lib/orchestrator/retrieval";

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
