import { describe, expect, it } from "vitest";
import { compactOperationsRemappingCreated, parseModelOperation } from "../operations/schema";
import { validateOperationDependencies } from "../operations/dependencies";
import { resolveCreatedArtifactDependencies } from "@/app/api/spectra/run/loop/act";
import { applyResolvedContentPatch } from "../ai/document-content-patch";

const append = (value: string) => parseModelOperation({ type: "artifact.update", input: {
  artifactId: "existing-task", blueprintKey: "planner_task", title: null, summary: null, tags: null, content: null,
  contentPatch: { changes: [{ path: "/linkedArtifactIds/-", value }] },
} });
const create = parseModelOperation({ type: "artifact.create", input: {
  blueprintKey: "document", title: "Created guide", summary: null, tags: [], placement: "inbox", workspaceId: null,
  content: { blocks: [{ id: "p", type: "paragraph", text: "A useful created guide." }], outline: [] },
} });

describe("S10 independent review: append dependency identity", () => {
  it("rejects a missing producer in a valid append-to-linked-artifacts patch", () => {
    expect(() => validateOperationDependencies([append("@created:9")])).toThrow();
  });

  it("remaps and resolves the appended link after removing an earlier operation", () => {
    const discarded = parseModelOperation({ type: "app.command", input: { command: "trigger_managebac_sync", args: {} } });
    const compacted = compactOperationsRemappingCreated([discarded, create, append("@created:1")], (_, index) => index !== 0);
    const operation = resolveCreatedArtifactDependencies(compacted[1]!, new Map([[0, "saved-guide"]]));
    if (operation.type !== "artifact.update") throw new Error("Fixture must remain an update");
    expect(operation.input.contentPatch?.changes[0]?.value).toBe("saved-guide");
    expect(applyResolvedContentPatch({ linkedArtifactIds: ["existing-guide"] }, operation.input.contentPatch!))
      .toMatchObject({ linkedArtifactIds: ["existing-guide", "saved-guide"] });
  });
});
