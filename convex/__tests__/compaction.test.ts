import { describe, expect, it } from "vitest";
import { computeCompactionWindow } from "../compaction";

function createMessages(count: number, start = 0) {
  return Array.from({ length: count }).map((_, index) => ({
    _id: `m_${start + index}`,
    createdAt: start + index,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${start + index}`,
    mode: "general",
  }));
}

describe("computeCompactionWindow", () => {
  it("rejects compaction when there is not enough history", () => {
    const result = computeCompactionWindow({
      messages: createMessages(19),
      keepLatestMessages: 6,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_enough_messages");
  });

  it("returns already_compacted when rerun without new compactable history", () => {
    const messages = createMessages(26);
    const first = computeCompactionWindow({
      messages,
      keepLatestMessages: 6,
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.toCompact.length).toBe(20);
    expect(first.compactedUntilMessageId).toBe("m_19");

    const second = computeCompactionWindow({
      messages,
      keepLatestMessages: 6,
      compactedUntilMessageId: first.compactedUntilMessageId,
    });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("already_compacted");
  });

  it("only compacts newly eligible messages after prior compaction", () => {
    const messages = createMessages(26);
    const first = computeCompactionWindow({
      messages,
      keepLatestMessages: 6,
    });
    if (!first.ok) throw new Error("first compaction should succeed");

    const grown = [...messages, ...createMessages(4, 26)];
    const second = computeCompactionWindow({
      messages: grown,
      keepLatestMessages: 6,
      compactedUntilMessageId: first.compactedUntilMessageId,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.toCompact.map((message) => message._id)).toEqual(["m_20", "m_21", "m_22", "m_23"]);
    expect(second.compactedUntilMessageId).toBe("m_23");
  });
});
