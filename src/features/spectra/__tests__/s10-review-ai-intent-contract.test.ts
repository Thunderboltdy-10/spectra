import { describe, expect, it } from "vitest";
import { parseModelOperation, parseSpectraPlan } from "../operations/schema";
import { validatePlanAgainstIntent } from "../operations/validate-plan";

const createDocument = (title: string) => parseModelOperation({
  type: "artifact.create",
  input: { blueprintKey: "document", title, summary: null, tags: [], workspaceId: null, placement: "inbox",
    content: { blocks: [{ id: "paragraph", type: "paragraph", text: title }], outline: [] } },
});
const references = { artifactIds: new Set<string>(), workspaceIds: new Set(["destination-b"]), placementNodes: new Map() };
const plan = (operations: ReturnType<typeof parseModelOperation>[], intent: Record<string, unknown>) => parseSpectraPlan({
  decision: "operate", finalResponse: "Created the requested artifact.", operations,
  intent: { mode: "create", requestedArtifactTypes: ["document"], requestedVisibleArtifactCount: 1,
    targetArtifactId: null, targetWorkspaceId: null, ...intent },
});

describe("S10 independent review: declared whole-request intent", () => {
  it("rejects two documents when exactly one visible document was requested", () => {
    expect(() => validatePlanAgainstIntent(plan([createDocument("Guide"), createDocument("Unrequested extra")], {}), references)).toThrow();
  });

  it("does not let a second guide substitute for explicitly requested separate flashcards", () => {
    const candidate = plan([createDocument("Guide"), createDocument("Another guide")], {
      requestedArtifactTypes: ["document", "flashcard_deck"], requestedVisibleArtifactCount: 2,
      obligations: [
        { id: "guide", description: "Create the study guide", operationIndexes: [0] },
        { id: "cards", description: "Create separate flashcards", operationIndexes: [1] },
      ],
    });
    expect(() => validatePlanAgainstIntent(candidate, references)).toThrow();
  });

  it("requires the explicit destination instead of accepting an inbox placement", () => {
    expect(() => validatePlanAgainstIntent(plan([createDocument("Guide from source workspace A")], {
      targetWorkspaceId: "destination-b",
    }), references)).toThrow();
  });
});
