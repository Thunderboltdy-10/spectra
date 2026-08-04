import { describe, expect, it } from "vitest";
import { matchSpectraCreationShorthand } from "../operations/creation-intent";

describe("matchSpectraCreationShorthand", () => {
  it("routes vague whiteboard / code / sheets / presentation prompts to single creation", () => {
    expect(
      matchSpectraCreationShorthand(
        "whiteboard map of enzyme inhibitors",
      )?.blueprintKey,
    ).toBe("whiteboard");
    expect(
      matchSpectraCreationShorthand(
        "code a tiny carbon cycle diagram sketch",
      )?.blueprintKey,
    ).toBe("code");
    expect(
      matchSpectraCreationShorthand(
        "make a small sheet of enzyme Km and Vmax comparison data",
      )?.blueprintKey,
    ).toBe("sheets");
    expect(
      matchSpectraCreationShorthand(
        "small sheet comparing enzyme Km and Vmax",
      )?.blueprintKey,
    ).toBe("sheets");
    expect(
      matchSpectraCreationShorthand("spreadsheet comparing Km and Vmax")
        ?.blueprintKey,
    ).toBe("sheets");
    expect(
      matchSpectraCreationShorthand(
        "create a presentation with 5 slides introducing enzyme inhibitors",
      )?.blueprintKey,
    ).toBe("presentation");
  });

  it("keeps Calendar requests out of work creation and still creates agents", () => {
    expect(
      matchSpectraCreationShorthand(
        "make a timetable for enzyme revision this week",
      ),
    ).toBeNull();
    expect(
      matchSpectraCreationShorthand(
        "build a study schedule for enzyme revision",
      ),
    ).toBeNull();
    expect(
      matchSpectraCreationShorthand(
        "create a tutor agent for enzyme kinetics",
      )?.blueprintKey,
    ).toBe("agent");
    expect(
      matchSpectraCreationShorthand("draft an agent that quizzes me on enzymes")
        ?.blueprintKey,
    ).toBe("agent");
  });

  it("does not treat edit requests as creates", () => {
    expect(
      matchSpectraCreationShorthand("edit the whiteboard title"),
    ).toBeNull();
    expect(
      matchSpectraCreationShorthand("update the presentation slides"),
    ).toBeNull();
    expect(matchSpectraCreationShorthand("open the whiteboard")).toBeNull();
    expect(
      matchSpectraCreationShorthand(
        "add a validation column that flags whether each enzyme's Km is below 5",
      ),
    ).toBeNull();
  });
});
