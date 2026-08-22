import { describe, expect, it } from "vitest";
import { resolveLibraryDestinationId } from "../ai/library-operation-context";

describe("Library operation context", () => {
  it("inherits the exact open folder when a create request omits its destination", () => {
    expect(resolveLibraryDestinationId(undefined, "physics-branch-a")).toBe(
      "physics-branch-a",
    );
  });

  it("keeps an explicit destination authoritative across duplicate folder names", () => {
    expect(
      resolveLibraryDestinationId("physics-branch-b", "physics-branch-a"),
    ).toBe("physics-branch-b");
  });

  it("does not invent a root destination without either identity", () => {
    expect(resolveLibraryDestinationId(undefined, undefined)).toBeUndefined();
  });
});
