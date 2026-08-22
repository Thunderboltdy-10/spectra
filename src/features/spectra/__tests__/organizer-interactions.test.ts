import { describe, expect, it } from "vitest";
import { opensOnPlainClick } from "../organization/tree-model";

describe("Library row interactions", () => {
  it("opens folders and work on an ordinary click", () => {
    expect(
      opensOnPlainClick(
        { shiftKey: false, metaKey: false, ctrlKey: false },
        false,
      ),
    ).toBe(true);
  });

  it("preserves explicit selection gestures", () => {
    expect(
      opensOnPlainClick(
        { shiftKey: true, metaKey: false, ctrlKey: false },
        false,
      ),
    ).toBe(false);
    expect(
      opensOnPlainClick(
        { shiftKey: false, metaKey: false, ctrlKey: false },
        true,
      ),
    ).toBe(false);
  });
});
