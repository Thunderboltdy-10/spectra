import { describe, expect, it } from "vitest";
import { buildThreadSnapshot, formatThreadSnapshotForPrompt } from "@/lib/orchestrator/history";

describe("thread snapshot helpers", () => {
  it("preserves recent turns, commitments, unresolved tasks, and constraints", () => {
    const snapshot = buildThreadSnapshot([
      { _id: "1", role: "user", content: "Please remember that I need concise answers and we must finish the rubric today.", mode: "general", citations: [], createdAt: 1 },
      { _id: "2", role: "assistant", content: "We will finish the rubric today and keep answers concise.", mode: "general", citations: [], createdAt: 2 },
      { _id: "3", role: "user", content: "There is still one unresolved task: compare the final two sources.", mode: "research", citations: [], createdAt: 3 },
    ]);

    expect(snapshot.rawRecentTurns).toHaveLength(3);
    expect(snapshot.commitments.some((item) => item.text.toLowerCase().includes("finish the rubric"))).toBe(true);
    expect(snapshot.unresolvedTasks.some((item) => item.toLowerCase().includes("unresolved task"))).toBe(true);
    expect(snapshot.activeConstraints.some((item) => item.toLowerCase().includes("concise"))).toBe(true);
  });

  it("formats a prompt block for continuity rehydration", () => {
    const block = formatThreadSnapshotForPrompt({
      rawRecentTurns: [{ role: "user", content: "Continue the essay plan.", mode: "document" }],
      commitments: [{ text: "Finish the outline", status: "open" }],
      unresolvedTasks: ["Add evidence to paragraph 2"],
      activeConstraints: ["Do not exceed 800 words"],
      evidenceReferences: ["Essay Draft.docx"],
      continuityHints: ["continue prior work"],
      summary: "Essay drafting session.",
    });

    expect(block).toContain("THREAD SNAPSHOT");
    expect(block).toContain("Finish the outline");
    expect(block).toContain("Essay Draft.docx");
  });
});
