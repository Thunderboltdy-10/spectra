import { describe, expect, it } from "vitest";
import {
  executeOperationStub,
  operationRequiresConfirmation,
  parseOperationInput,
} from "@/features/spectra/operations";

describe("Spectra operation policy", () => {
  it("allows safe direct artifact creation", () => {
    const operation = parseOperationInput({
      type: "artifact.create",
      input: { blueprintKey: "document" },
      affected: [],
    });

    expect(operationRequiresConfirmation(operation)).toBe(false);
    expect(executeOperationStub(operation)).toMatchObject({
      status: "executed",
      requiresConfirmation: false,
    });
  });

  it("requires confirmation for workspace creation", () => {
    const operation = parseOperationInput({
      type: "workspace.create",
      input: { title: "Physics" },
      affected: [],
    });

    expect(operationRequiresConfirmation(operation)).toBe(true);
  });

  it("treats a generated card set as one artifact", () => {
    const operation = parseOperationInput({
      type: "flashcardDeck.create",
      input: { cardCount: 30 },
      affected: [],
      bulkCount: 30,
    });

    expect(operationRequiresConfirmation(operation)).toBe(false);
  });
});
