import { describe, expect, it } from "vitest";
import { applyHarnessEvent, replyBlocks, type HarnessExchangeFields } from "../harness-exchange";

const step = (id: string, textAt?: number) => ({ id, textAt });

describe("a reply in the order it happened", () => {
  it("keeps a run with no writing between steps in one block, then the words", () => {
    const blocks = replyBlocks("All done.", [step("a", 0), step("b", 0)]);
    expect(blocks).toEqual([{ kind: "work", steps: [step("a", 0), step("b", 0)] }, { kind: "text", text: "All done." }]);
  });

  it("always starts with a work block, where the time is shown", () => {
    expect(replyBlocks("Just words.", [])).toEqual([{ kind: "work", steps: [] }, { kind: "text", text: "Just words." }]);
  });

  it("puts work done after words below those words", () => {
    const first = "Let me look.";
    const blocks = replyBlocks(`${first}\n\nFound it.`, [step("think", 0), step("read", first.length), step("edit", first.length)]);
    expect(blocks).toEqual([
      { kind: "work", steps: [step("think", 0)] },
      { kind: "text", text: first },
      { kind: "work", steps: [step("read", first.length), step("edit", first.length)] },
      { kind: "text", text: "Found it." },
    ]);
  });

  it("keeps work after the last words at the end", () => {
    const blocks = replyBlocks("Working on it.", [step("edit", 14)]);
    expect(blocks.map((block) => block.kind)).toEqual(["work", "text", "work"]);
  });

  it("never splits a sentence when the saved reply was tidied", () => {
    const blocks = replyBlocks("One two three.\n\nFour.", [step("edit", 5)]);
    expect(blocks[1]).toEqual({ kind: "text", text: "One two three." });
    expect(blocks[3]).toEqual({ kind: "text", text: "Four." });
  });

  it("copes with a position past a shortened reply", () => {
    expect(replyBlocks("Short.", [step("a", 500)]).map((block) => block.kind)).toEqual(["work", "text", "work"]);
  });

  it("records how much was written when each step began", () => {
    let fields: HarnessExchangeFields & { content: string } = { steps: [], content: "" };
    fields = applyHarnessEvent(fields, { type: "step", runId: "r", id: "a", label: "Read", status: "running" } as never);
    fields = { ...fields, content: "Some words." };
    fields = applyHarnessEvent(fields, { type: "reasoning_delta", runId: "r", id: "t", content: "hm" } as never);
    fields = applyHarnessEvent(fields, { type: "step", runId: "r", id: "b", label: "Edit", status: "running" } as never);
    expect(fields.steps.map((entry) => entry.textAt)).toEqual([0, 11, 11]);
  });
});
