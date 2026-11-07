import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SemanticResult } from "../../../../../../shared/semantic-types";

/*
 * The AI's search and chat lookups on the semantic layer: what is asked for,
 * how results are named, and how a words-only answer is reported.
 */

const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
let answer: Record<string, unknown> = {};

// Search also looks on the person's computer. A test must not reach whichever Bridge is running here.
vi.mock("@/lib/device-store", () => ({ deviceStoreCall: vi.fn(async () => { throw new Error("no Bridge in tests"); }) }));
vi.mock("./io", async (importOriginal) => {
  const original = await importOriginal<typeof import("./io")>();
  const handle = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "spectraThreads:readMessage") return { ok: true, role: "assistant", content: "The deadline moved to Friday.", nextOffset: null };
    return answer;
  };
  return {
    ...original,
    act: vi.fn(handle),
    query: vi.fn(handle),
    mutate: vi.fn(handle),
    readQuery: vi.fn(async (name: string, args: Record<string, unknown>) => ({ ok: true, value: await handle(name, args) })),
  };
});

const { ConvexHarnessBackend, degradedNote, searchHit, timezoneOffsetMinutes } = await import("./convex-backend");
const { openItemIds } = await import("./attempt");

const slide: SemanticResult = {
  kind: "artifact", itemId: "art-1", title: "Cell respiration", typeLabel: "Slides", subtype: "presentation",
  snippet: "ATP is made in the mitochondria", location: "Slide 3: Krebs cycle",
  anchor: { kind: "artifact", artifactId: "art-1", regionId: "slide-3", label: "Slide 3: Krebs cycle" },
  score: 0.92, matchedBy: ["meaning", "words"], workspace: { id: "ws-1", title: "Biology" }, ownership: "mine", updatedAt: 5,
};
const chat: SemanticResult = {
  kind: "thread", itemId: "thread-9", title: "Heliostat planning", typeLabel: "Chat", snippet: "deadline moved",
  anchor: { kind: "thread", threadId: "thread-9", messageId: "msg-4" }, score: 0.7, matchedBy: ["words"], ownership: "mine",
};

const backend = (extra: Partial<ConstructorParameters<typeof ConvexHarnessBackend>[0]> = {}) =>
  new ConvexHarnessBackend({ actorClerkId: "user_1", runId: "run-1", executionId: "exec-1", prompt: "", timeZone: "Europe/Madrid", ...extra });


beforeEach(() => {
  calls.length = 0;
  answer = {};
});

describe("search on the semantic layer", () => {
  it("asks semantic.search for every kind with what is open as a hint", async () => {
    answer = { results: [slide], mode: "hybrid", tookMs: 12 };
    const response = await backend({ openItemIds: ["art-1", "thread-1"] }).search({ query: "  how cells make energy ", limit: 50 });
    expect(calls[0]).toMatchObject({
      name: "semantic:search",
      args: { query: "how cells make energy", kinds: ["artifact", "thread", "event", "school"], limit: 30, hints: { openItemIds: ["art-1", "thread-1"] } },
    });
    expect((calls[0]!.args.hints as { timezoneOffsetMinutes: number }).timezoneOffsetMinutes).toBe(timezoneOffsetMinutes("Europe/Madrid"));
    expect(response).toEqual({
      mode: "hybrid",
      hits: [{
        kind: "artifact", id: "art-1", title: "Cell respiration", typeLabel: "Slides", subtype: "presentation",
        snippet: "ATP is made in the mitochondria", location: "Slide 3: Krebs cycle", regionId: "slide-3",
        workspace: "Biology", ownership: "mine", updatedAt: 5,
      }],
    });
  });

  it("passes the kinds asked for and reports a words-only answer", async () => {
    answer = { results: [], mode: "words_only", degraded: { reason: "embeddings_unavailable" }, tookMs: 3 };
    const response = await backend().search({ query: "essay", kinds: ["artifact"], limit: 5 });
    expect(calls[0]!.args.kinds).toEqual(["artifact"]);
    expect(response).toEqual({ hits: [], mode: "words_only", degraded: "embeddings_unavailable" });
  });

  it("names chat hits by their best message", () => {
    expect(searchHit(chat)).toMatchObject({ kind: "thread", id: "thread-9", messageId: "msg-4", typeLabel: "Chat" });
    expect(searchHit({ ...slide, location: undefined })).toMatchObject({ location: "Slide 3: Krebs cycle" });
  });

  it("says plainly when only words matched or the index is still filling", () => {
    expect(degradedNote("hybrid")).toBe("");
    expect(degradedNote("words_only", "embeddings_not_configured")).toMatch(/exact words only/);
    expect(degradedNote("hybrid", "index_partial")).toMatch(/still being indexed/);
  });

  it("computes the zone's offset like getTimezoneOffset", () => {
    const winter = Date.UTC(2026, 0, 15, 12);
    const summer = Date.UTC(2026, 6, 15, 12);
    expect(timezoneOffsetMinutes("Europe/Madrid", winter)).toBe(-60);
    expect(timezoneOffsetMinutes("Europe/Madrid", summer)).toBe(-120);
    expect(timezoneOffsetMinutes("America/New_York", winter)).toBe(300);
    expect(timezoneOffsetMinutes("UTC", winter)).toBe(0);
    expect(timezoneOffsetMinutes("Not/AZone", winter)).toBe(0);
  });
});

describe("read_thread lookups", () => {
  it("finds a passage with semantic.searchThreads and reads the best message in full", async () => {
    answer = { results: [chat, { ...chat, itemId: "thread-2", title: "Other plans" }], mode: "hybrid", tookMs: 9 };
    const text = await backend({ threadId: "thread-1" }).readThread({ threadId: "thread-9", query: "when is the deadline" });
    expect(calls[0]).toMatchObject({ name: "semantic:searchThreads", args: { query: "when is the deadline", hints: { openItemIds: ["thread-9"] } } });
    expect(calls[1]).toMatchObject({ name: "spectraThreads:readMessage", args: { threadId: "thread-9", messageId: "msg-4" } });
    expect(text).toContain("message msg-4");
    expect(text).toContain("Spectra: The deadline moved to Friday.");
    expect(text).toContain("Other conversations that match:\n- Other plans (threadId thread-2)");
    expect(text).toContain('read_thread {threadId: "thread-9", after: "msg-4"}');
  });

  it("pages on from a passage in both directions with message ids", async () => {
    answer = { messages: [{ _id: "msg-5", role: "user", content: "And the essay?" }, { _id: "msg-6", role: "assistant", content: "Monday." }], more: true };
    const later = await backend({ threadId: "thread-1" }).readThread({ threadId: "thread-9", after: "msg-4", limit: 2 });
    expect(calls[0]).toMatchObject({ name: "spectraThreads:listMessagesFrom", args: { threadId: "thread-9", messageId: "msg-4", direction: "newer", limit: 2 } });
    expect(later).toContain("[msg-5] User: And the essay?\n\n[msg-6] Spectra: Monday.");
    expect(later).toContain('older: read_thread {threadId: "thread-9", before: "msg-5"}');
    expect(later).toContain('newer: read_thread {threadId: "thread-9", after: "msg-6"}');
    calls.length = 0;
    answer = { messages: [{ _id: "msg-2", role: "user", content: "Hi" }], more: false };
    const earlier = await backend({ threadId: "thread-1" }).readThread({ before: "msg-3" });
    expect(calls[0]).toMatchObject({ name: "spectraThreads:listMessagesFrom", args: { threadId: "thread-1", messageId: "msg-3", direction: "older" } });
    expect(earlier).not.toContain("older:");
    expect(earlier).toContain('newer: read_thread {after: "msg-2"}');
  });

  it("offers older messages from the latest page by message id, never a cursor", async () => {
    answer = { messages: [{ _id: "msg-8", role: "user", content: "Latest" }], hasOlder: true, olderBefore: "opaque-cursor" };
    const text = await backend({ threadId: "thread-1" }).readThread({});
    expect(calls[0]).toMatchObject({ name: "spectraThreads:listMessages", args: { threadId: "thread-1" } });
    expect(calls[0]!.args).not.toHaveProperty("before");
    expect(text).toContain('(Read on: older: read_thread {before: "msg-8"})');
    expect(text).not.toContain("opaque-cursor");
  });

  it("says when nothing in the conversation matches, and why results may be thin", async () => {
    answer = { results: [], mode: "words_only", degraded: { reason: "embeddings_not_configured" }, tookMs: 2 };
    const text = await backend({ threadId: "thread-1" }).readThread({ query: "heliostat" });
    expect(text).toMatch(/^Nothing in this conversation matches "heliostat"\./);
    expect(text).toMatch(/exact words only/);
  });

  it("reads one message by id without searching", async () => {
    const text = await backend({ threadId: "thread-1" }).readThread({ messageId: "msg-4" });
    expect(calls.map((call) => call.name)).toEqual(["spectraThreads:readMessage"]);
    expect(text).toBe("[msg-4] Spectra: The deadline moved to Friday.");
  });
});

describe("search hints from the request", () => {
  it("lists the open artifact, references, open items and the thread once each", () => {
    expect(openItemIds({
      artifactId: "art-1",
      references: [{ id: "art-2", type: "document", title: "B" }],
      open: [{ id: "art-1", type: "presentation", title: "A" }, { id: "art-3", type: "sheets", title: "C" }],
      threadId: "thread-1",
    })).toEqual(["art-1", "art-2", "art-3", "thread-1"]);
  });
});
