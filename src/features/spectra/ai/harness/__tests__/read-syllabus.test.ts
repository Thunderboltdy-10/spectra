import { describe, expect, it } from "vitest";
import type { SyllabusGuideRequest } from "../backend";
import { MemoryBackend } from "../memory-backend";
import { buildHarnessTools, createSession } from "../tools";

const context = { signal: new AbortController().signal, runId: "r", toolCallId: "t" };

function readSyllabus(backend: MemoryBackend) {
  const tool = buildHarnessTools(createSession({ backend, prompt: "test" })).find((item) => item.name === "read_syllabus")!;
  return async (raw: Record<string, unknown>) => {
    const result = await tool.execute(tool.parse!(raw), context);
    return String(result.content);
  };
}

describe("read_syllabus", () => {
  it("adds the official guide's outline to the summary, in place of the summary's own list", async () => {
    const asked: SyllabusGuideRequest[] = [];
    const read = readSyllabus(
      new MemoryBackend({
        syllabusGuide: (input) => {
          asked.push(input);
          return { title: "Physics guide", found: "outline", text: "Syllabus:\n- A. Space, time and motion\n  - A.2 Forces and momentum" };
        },
      }),
    );
    const text = await read({ subject: "Physics HL" });
    expect(asked).toEqual([{ courseId: "physics", level: "HL" }]);
    expect(text).toContain("The official Physics guide; read any part with section");
    expect(text).toContain("  - A.2 Forces and momentum");
    expect(text).not.toContain("Sections (read only");
  });

  it("answers a section from the guide's own text, with the student's level", async () => {
    const read = readSyllabus(
      new MemoryBackend({ syllabusGuide: () => ({ title: "Physics guide", found: "section", text: "[Syllabus > A.2 Forces and momentum]\nNewton’s three laws" }) }),
    );
    const text = await read({ subject: "physics", level: "SL", section: "A.2" });
    expect(text).toMatch(/^From the official Physics guide \(SL\)/);
    expect(text).toContain("leave out what the guide marks AHL");
    expect(text).toContain("Newton’s three laws");
  });

  it("keeps to the compact summary when no guide is stored, or for the whole summary", async () => {
    const none = readSyllabus(new MemoryBackend());
    expect(await none({ subject: "physics", level: "HL", section: "Assessment" })).toContain("compact summary");
    let calls = 0;
    const all = readSyllabus(new MemoryBackend({ syllabusGuide: () => (calls++, null) }));
    await all({ subject: "physics", section: "all" });
    expect(calls).toBe(0);
  });

  it("falls back to the summary for a heading only the summary has", async () => {
    const read = readSyllabus(new MemoryBackend({ syllabusGuide: () => ({ title: "Physics guide", found: "none", text: "Nothing in the guide matches." }) }));
    const text = await read({ subject: "physics", level: "HL", section: "Assessment" });
    expect(text).toContain("compact summary");
    expect(text).not.toContain("Nothing in the guide matches");
  });
});
