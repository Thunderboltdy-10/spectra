import { describe, expect, it } from "vitest";
import { cardArrival } from "../components/artifact-card";

describe("cardArrival", () => {
  const now = 1_000_000;

  it("lets Spectra's artifact travel from the prism while it is being made", () => {
    expect(cardArrival({}, "creating", now)).toBe("ai");
    expect(cardArrival({ createdAt: now - 5_000 }, "generated", now)).toBe("ai");
  });

  it("forms the user's own new card where they acted", () => {
    expect(cardArrival({ createdAt: now - 2_000 }, undefined, now)).toBe("human");
  });

  it("treats anything older as content", () => {
    expect(cardArrival({ createdAt: now - 60_000 }, "generated", now)).toBeUndefined();
    expect(cardArrival({}, undefined, now)).toBeUndefined();
  });
});
