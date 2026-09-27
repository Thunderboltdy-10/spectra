import { beforeEach, describe, expect, it, vi } from "vitest";
const seams = vi.hoisted(() => ({ readQuery: vi.fn(), act: vi.fn() }));
vi.mock("@/app/api/spectra/run/loop/io", () => ({ ...seams, query: vi.fn(), mutate: vi.fn(), safeJson: JSON.stringify }));
import { executeAgentReadTool } from "@/app/api/spectra/run/loop/plan";

const read = (args: Record<string, unknown>) => executeAgentReadTool("actor", {
  name: "read_thread", arguments: JSON.stringify({ threadId: "thread", ...args }),
});
beforeEach(() => vi.clearAllMocks());
describe("explicit bounded context retrieval", () => {
  it("preserves old-message pagination and exposes long message continuation", async () => {
    seams.readQuery.mockResolvedValue({ ok: true, value: { messages: [{ _id: "message", role: "user", content: "a".repeat(4000) }],
      hasOlder: true, olderBefore: "older-page", nextCursor: "older-page" } });
    const result = await read({ before: "previous-page", limit: 4 });
    expect(seams.readQuery).toHaveBeenCalledWith("spectraThreads:listMessages",
      { actorClerkId: "actor", threadId: "thread", before: "previous-page", limit: 4 }, expect.any(String));
    expect(result).toMatchObject({ ok: true, complete: false, before: "older-page", messages: [{ messageId: "message", partial: true,
      content: "a".repeat(3000), nextOffset: 3000, totalCharacters: 4000, revision: expect.stringMatching(/^[a-f0-9]{64}$/) }] });
  });
  it("forwards an exact search and its cursor without loading recent history", async () => {
    seams.readQuery.mockResolvedValue({ ok: true, value: { results: [{ messageId: "hit", revision: "sha", start: 20 }], nextCursor: "next", complete: false } });
    expect(await read({ query: "the exact phrase", searchCursor: "cursor" })).toMatchObject({ ok: true, nextCursor: "next", complete: false });
    expect(seams.readQuery).toHaveBeenCalledTimes(1);
    expect(seams.readQuery.mock.calls[0]?.slice(0, 2)).toEqual(["spectraThreads:searchMessages",
      { actorClerkId: "actor", threadId: "thread", query: "the exact phrase", cursor: "cursor", limit: 8 }]);
  });
  it("does not conceal a changed message or retry with a different revision", async () => {
    seams.readQuery.mockResolvedValue({ ok: true, value: { ok: false, code: "message_changed", revision: "new" } });
    expect(await read({ messageId: "message", offset: 3000, revision: "old" })).toMatchObject({ ok: false, code: "message_changed" });
    expect(seams.readQuery).toHaveBeenCalledTimes(1);
    expect(seams.readQuery.mock.calls[0]?.[0]).toBe("spectraThreads:readMessage");
  });
  it.each([{ messageId: "message", offset: 5 }, { query: "phrase", before: "cursor" }, { searchCursor: "cursor" }])(
    "rejects incompatible or unbound continuation %j before reading", async (args) => {
      expect(await read(args)).toMatchObject({ ok: false, code: "invalid_arguments" });
      expect(seams.readQuery).not.toHaveBeenCalled();
    },
  );
  it("forwards the whole memory query and exact claim ids, including a narrowing response", async () => {
    const query = "long query ".repeat(1000);
    seams.act.mockResolvedValue({ retrieval: { status: "query_too_large" }, selectedClaimIds: [], guidance: "Narrow the complete query." });
    expect(await executeAgentReadTool("actor", { name: "retrieve_memory", arguments: JSON.stringify({ query, depth: "focused", claimIds: ["claim"] }) }))
      .toMatchObject({ ok: true, memory: { retrieval: { status: "query_too_large" } } });
    expect(seams.act.mock.calls[0]?.[1]).toMatchObject({ queryText: query, claimIds: ["claim"] });
  });
  it("discovers an archived conversation in an exact workspace with bounded title search", async () => {
    seams.readQuery.mockResolvedValue({ ok: true, value: { results: [{ id: "found-thread", type: "thread", title: "Research" }], nextCursor: "next", complete: false, searchMode: "title" } });
    expect(await executeAgentReadTool("actor", { name: "search_objects", arguments: JSON.stringify({ kind: "thread", query: "Research", workspaceId: "workspace", status: "archived", cursor: "cursor" }) }))
      .toMatchObject({ ok: true, results: [{ id: "found-thread" }], nextCursor: "next", searchMode: "title" });
    expect(seams.readQuery.mock.calls[0]?.slice(0, 2)).toEqual(["spectraThreads:search",
      { actorClerkId: "actor", query: "Research", workspaceId: "workspace", status: "archived", cursor: "cursor", limit: 16 }]);
  });
});
