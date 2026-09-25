import { describe, expect, it } from "vitest";
import { mergeContinuationAttachments } from "../ai/continuation-context";
import type { CommandAttachment } from "../components/command-bar";

function attachment(id: string): CommandAttachment {
  return {
    id,
    name: `${id}.md`,
    mimeType: "text/markdown",
    size: 10,
    handling: "text",
    data: "source content",
  };
}

describe("same-thread steering context", () => {
  it("keeps earlier evidence and adds newly attached files once", () => {
    const merged = mergeContinuationAttachments(
      [attachment("brief"), attachment("data")],
      [attachment("data"), attachment("new-source")],
    );

    expect(merged.map((item) => item.id)).toEqual([
      "brief",
      "data",
      "new-source",
    ]);
    expect(merged[0]?.data).toBe("source content");
  });

  it("honors the run attachment limit while retaining earlier sources first", () => {
    const merged = mergeContinuationAttachments(
      [attachment("one"), attachment("two"), attachment("three")],
      [attachment("four"), attachment("five")],
    );

    expect(merged.map((item) => item.id)).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
  });
});
