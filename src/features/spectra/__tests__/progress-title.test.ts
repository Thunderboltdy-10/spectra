import { describe, expect, it } from "vitest";
import { pastTenseProgressTitle } from "../components/progress-title";

describe("pastTenseProgressTitle", () => {
  it("leaves running titles unchanged", () => {
    expect(pastTenseProgressTitle("Preparing response", false)).toBe(
      "Preparing response",
    );
  });

  it("turns a leading -ing verb into -ed when completed", () => {
    expect(pastTenseProgressTitle("Preparing response", true)).toBe(
      "Prepared response",
    );
    expect(pastTenseProgressTitle("Mapping Spectra Launch Studio", true)).toBe(
      "Mapped Spectra Launch Studio",
    );
    expect(pastTenseProgressTitle("Building 10-question quiz", true)).toBe(
      "Builded 10-question quiz",
    );
    expect(
      pastTenseProgressTitle("Loading the current artifact", true),
    ).toBe("Loaded the current artifact");
  });

  it("leaves completed titles alone when the first word is not -ing", () => {
    expect(pastTenseProgressTitle("Ready to continue", true)).toBe(
      "Ready to continue",
    );
    expect(pastTenseProgressTitle("Changes approved", true)).toBe(
      "Changes approved",
    );
  });
});
