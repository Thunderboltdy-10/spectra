import { describe, expect, it } from "vitest";
import { codeContentSchema } from "../artifacts/schemas";
import { normalizeCodeContent } from "../code/model";

describe("code artifact preferred view", () => {
  it("retains split mode through normalization and validation", () => {
    const content = normalizeCodeContent({
      visualisation: { enabled: true, openMode: "split" },
    });

    expect(content.visualisation.openMode).toBe("split");
    expect(codeContentSchema.parse(content).visualisation.openMode).toBe(
      "split",
    );
  });
});
