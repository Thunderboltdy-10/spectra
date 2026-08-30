import { describe, expect, it } from "vitest";
import {
  QUIZ_CAPABILITIES,
  QUIZ_REFUSAL_REASONS,
  QUIZ_WORKBAR_LOCAL_IDS,
  capabilitiesFor,
  projectBindingsFromIr,
} from "../capabilities";
import { requireArtifactTypeManifest } from "../artifacts/registry";

const editableContext = {
  can: () => true,
} as unknown as Parameters<
  (typeof QUIZ_CAPABILITIES)[number]["availability"]
>[0];

describe("quiz capability depth", () => {
  it("owns exactly 78 unique definitions in the per-type catalog", () => {
    expect(capabilitiesFor("quiz")).toHaveLength(78);
    expect(QUIZ_CAPABILITIES).toHaveLength(78);
    expect(new Set(QUIZ_CAPABILITIES.map((entry) => entry.id)).size).toBe(78);
  });

  it("keeps every AI-exposed operation symmetric with the quiz manifest", () => {
    const operations = new Set(
      requireArtifactTypeManifest("quiz").operations.map((operation) =>
        operation.slice("quiz.".length).replaceAll(".", "_"),
      ),
    );
    for (const definition of QUIZ_CAPABILITIES.filter(
      (entry) => entry.ai.exposed,
    )) {
      expect(definition.manifestOperation, definition.id).toBeTruthy();
      expect(
        operations.has(definition.manifestOperation!),
        `${definition.id} -> ${definition.manifestOperation}`,
      ).toBe(true);
    }
  });

  it("returns the exact visible refusal reason and exposes no executor", () => {
    expect(Object.keys(QUIZ_REFUSAL_REASONS)).toHaveLength(5);
    for (const [id, reason] of Object.entries(QUIZ_REFUSAL_REASONS)) {
      const definition = QUIZ_CAPABILITIES.find((entry) => entry.id === id);
      expect(definition).toBeTruthy();
      expect(definition!.availability(editableContext)).toEqual({
        state: "disabled",
        reason,
      });
      expect(definition!.ai.description).toBe(reason);
      expect(definition!.execute).toEqual({ editor: "capability.refusal" });
    }
  });

  it("projects every shipped quiz workbar entry through capability IR", () => {
    const bindings = projectBindingsFromIr(
      "quiz",
      QUIZ_WORKBAR_LOCAL_IDS.map((id) => ({
        id,
        label: id,
        onSelect: () => {},
      })),
    );
    expect(bindings.map((binding) => binding.capabilityId)).toEqual(
      QUIZ_WORKBAR_LOCAL_IDS.map(
        (id) => `quiz.${id.replaceAll(/[^a-zA-Z0-9]+/g, ".")}`,
      ),
    );
  });
});
