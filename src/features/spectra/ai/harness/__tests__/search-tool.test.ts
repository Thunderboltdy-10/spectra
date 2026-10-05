import { describe, expect, it } from "vitest";
import { authorNew } from "../authoring";
import { MemoryBackend } from "../memory-backend";
import { buildHarnessTools, createSession } from "../tools";
import { readRangeFor, searchModeNote } from "../tools/context";
import type { HarnessTool } from "../types";

/*
 * The search and read_thread tools: what each result says it is, where it is,
 * how to open it, and how an incomplete answer is reported.
 */

function tools(backend: MemoryBackend) {
  const session = createSession({ backend, prompt: "test" });
  const byName = new Map(buildHarnessTools(session).map((tool) => [tool.name, tool as HarnessTool<unknown>]));
  const run = async (name: string, raw: Record<string, unknown>) => {
    const tool = byName.get(name)!;
    const outcome = await tool.execute(tool.parse!(raw), { signal: new AbortController().signal, toolCallId: "call-1" } as never);
    return { outcome, session };
  };
  return { run, byName };
}

const seeded = () =>
  new MemoryBackend({
    artifacts: [
      { id: "doc-1", type: "document", title: "Photosynthesis essay", content: authorNew("document", { markdown: "# Light reactions\n\nChlorophyll absorbs light." }, { timeZone: "UTC" }).content },
    ],
    thread: [
      { id: "m1", role: "user", content: "When is the photosynthesis essay due?" },
      { id: "m2", role: "assistant", content: "Friday, per your teacher." },
    ],
    calendar: [{ id: "ev-1", title: "Photosynthesis quiz", start: Date.UTC(2026, 9, 9, 8), kind: "deadline" }],
  });

describe("search tool", () => {
  it("names what each hit is and how to open it", async () => {
    const { run } = tools(seeded());
    const { outcome, session } = await run("search", { query: "photosynthesis" });
    expect(outcome.ok).toBe(true);
    expect(outcome.content).toContain("- Photosynthesis essay (Document, id doc-1)");
    expect(outcome.content).toContain("(Chat, threadId thread-1, messageId m1)");
    expect(outcome.content).toContain("Photosynthesis quiz (Calendar event, calendar item ev-1, on 2026-10-09 08:00 UTC)");
    expect(outcome.content).not.toMatch(/Note:/);
    expect(session.titles.get("doc-1")).toEqual({ title: "Photosynthesis essay", type: "document" });
  });

  it("looks only where asked", async () => {
    const { run } = tools(seeded());
    const { outcome } = await run("search", { query: "photosynthesis", in: ["calendar"] });
    expect(outcome.content).toContain("Photosynthesis quiz");
    expect(outcome.content).not.toContain("Photosynthesis essay");
  });

  it("refuses places that do not exist", () => {
    const { byName } = tools(seeded());
    expect(() => byName.get("search")!.parse!({ query: "x", in: ["everywhere"] })).toThrow(/in must list some of work, chats, calendar, school, memory/);
  });

  it("is honest when only words matched", async () => {
    const backend = new MemoryBackend({ searchMode: "words_only", searchDegraded: "embeddings_unavailable" });
    const { run } = tools(backend);
    const { outcome } = await run("search", { query: "the essay about plants" });
    expect(outcome.content).toMatch(/^No results for "the essay about plants"\.\nNote: search matched exact words only/);
  });

  it("says when the index is still filling", () => {
    expect(searchModeNote({ mode: "hybrid", degraded: "index_partial" })).toMatch(/still being indexed/);
    expect(searchModeNote({ mode: "hybrid" })).toBe("");
  });

  it("turns a location into the read_artifact range that opens it", () => {
    expect(readRangeFor({ location: "Slide 3: Results", subtype: "presentation" })).toEqual({ from: 3, to: 3 });
    expect(readRangeFor({ location: "Heading: Methods", subtype: "document" })).toEqual({ section: "Methods" });
    expect(readRangeFor({ location: "Data A1:D20", subtype: "sheets" })).toEqual({ sheet: "Data", range: "A1:D20" });
    expect(readRangeFor({ location: "Data", subtype: "sheets" })).toEqual({ sheet: "Data" });
    expect(readRangeFor({ location: "Card 7", subtype: "flashcard_deck" })).toEqual({ from: 7, to: 7 });
    expect(readRangeFor({ location: "Question 2", subtype: "quiz" })).toEqual({ from: 2, to: 2 });
    expect(readRangeFor({ location: "src/app.ts", subtype: "code" })).toEqual({ file: "src/app.ts" });
    expect(readRangeFor({ location: "Frame: Causes", subtype: "whiteboard" })).toBeNull();
    expect(readRangeFor({ subtype: "document" })).toBeNull();
  });
});

describe("read_thread tool", () => {
  it("reads a message from a search hit, and older messages before one", async () => {
    const { run } = tools(seeded());
    expect((await run("read_thread", { messageId: "m2" })).outcome.content).toBe("[m2] assistant: Friday, per your teacher.");
    expect((await run("read_thread", { before: "m2" })).outcome.content).toBe("[m1] user: When is the photosynthesis essay due?");
    expect((await run("read_thread", { after: "m1" })).outcome.content).toBe("[m2] assistant: Friday, per your teacher.");
  });

  it("takes one view at a time", () => {
    const { byName } = tools(seeded());
    expect(() => byName.get("read_thread")!.parse!({ query: "due", messageId: "m1" })).toThrow(/one of query, messageId, before or after/);
    expect(() => byName.get("read_thread")!.parse!({ before: "m2", after: "m1" })).toThrow(/one of query, messageId, before or after/);
  });
});
