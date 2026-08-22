import { describe, expect, it } from "vitest";
import {
  committedApplicationObservation,
  describeApplicationObservation,
} from "../ai/application-tool-observation";

describe("application tool observations", () => {
  it("unwraps an observed committed folder mutation", () => {
    const observation = committedApplicationObservation({
      ok: true,
      data: {
        ok: true,
        observation: {
          kind: "library.create_folder",
          name: "Sources",
          nodeId: "node-1",
          parentId: "physics-1",
          reused: false,
        },
      },
    });
    expect(observation).toMatchObject({
      kind: "library.create_folder",
      nodeId: "node-1",
    });
    expect(describeApplicationObservation(observation!)).toBe(
      'Created folder "Sources" in the requested Library location.',
    );
  });

  it("does not ground narration from failed or unobserved calls", () => {
    expect(
      committedApplicationObservation({
        ok: false,
        code: "tool_failed",
      }),
    ).toBeNull();
    expect(committedApplicationObservation({ ok: true, data: { ok: true } })).toBeNull();
  });
});
