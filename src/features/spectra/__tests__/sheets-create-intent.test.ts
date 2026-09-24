import { describe, expect, it } from "vitest";
import {
  alignIntentWithCreates,
  promoteMatchingUpdateToCreate,
  promptLooksLikeFocusedStructuralEdit,
  promptLooksLikeFreshCreate,
} from "../operations/intent-alignment";
import { matchSpectraCreationShorthand } from "../operations/creation-intent";
import {
  coerceCommonPlanSchemaSlips,
  formatPlanApplicationPublicError,
  isRepairablePlanFailure,
} from "../operations/plan-diagnostics";
import { parseSpectraPlan } from "../operations/schema";
import { validatePlanAgainstIntent } from "../operations/validate-plan";
import { normalizeArtifactContent } from "../ai/content-normalization";
import { buildBoundedContextPacket } from "../ai/context-builder";

const sheetsContent = normalizeArtifactContent("sheets", {
  workbook: { activeSheetId: "sheet-1" },
  sheets: [
    {
      id: "sheet-1",
      name: "Km vs Vmax",
      rowCount: 12,
      columnCount: 6,
      cells: {
        A1: { value: "Condition" },
        B1: { value: "Km" },
        C1: { value: "Vmax" },
        A2: { value: "Control" },
        B2: { value: 1.2 },
        C2: { value: 100 },
      },
    },
  ],
});

const VALIDATION_COLUMN_PROMPT =
  "add a validation column that flags whether each enzyme's Km is below 5";

describe("vague sheets create intent", () => {
  it("matches Launch Studio QC shorthand without an explicit create verb", () => {
    expect(
      matchSpectraCreationShorthand(
        "small sheet comparing enzyme Km and Vmax",
      )?.blueprintKey,
    ).toBe("sheets");
    expect(
      matchSpectraCreationShorthand(
        "a spreadsheet of enzyme kinetics constants",
      )?.blueprintKey,
    ).toBe("sheets");
    expect(
      matchSpectraCreationShorthand(
        "make a timetable for enzyme revision this week",
      ),
    ).toBeNull();
    expect(
      matchSpectraCreationShorthand(
        "draft a tutor agent for cell biology",
      )?.blueprintKey,
    ).toBe("agent");
    expect(promptLooksLikeFreshCreate("small sheet comparing enzyme Km and Vmax")).toBe(
      true,
    );
  });

  it("treats open-sheet validation-column edits as focused updates, not creates", () => {
    expect(promptLooksLikeFocusedStructuralEdit(VALIDATION_COLUMN_PROMPT)).toBe(
      true,
    );
    expect(promptLooksLikeFreshCreate(VALIDATION_COLUMN_PROMPT)).toBe(false);
    expect(matchSpectraCreationShorthand(VALIDATION_COLUMN_PROMPT)).toBeNull();
    expect(
      promptLooksLikeFocusedStructuralEdit(
        "rewrite section 2 of the open document",
      ),
    ).toBe(true);
    expect(
      promptLooksLikeFocusedStructuralEdit(
        "add a question after 4 on this quiz",
      ),
    ).toBe(true);
    expect(
      promptLooksLikeFocusedStructuralEdit(
        "create a new flashcard deck about enzymes",
      ),
    ).toBe(false);
    expect(
      promptLooksLikeFocusedStructuralEdit(
        "make slide 3 more concise and keep the speaker notes",
      ),
    ).toBe(true);
    expect(
      promptLooksLikeFreshCreate(
        "make slide 3 more concise and keep the speaker notes",
      ),
    ).toBe(false);
    expect(
      promptLooksLikeFocusedStructuralEdit("make the study guide clearer"),
    ).toBe(true);
    expect(promptLooksLikeFreshCreate("make the study guide clearer")).toBe(
      false,
    );
  });

  it("keeps an open sheets artifact focused even when focusMode is workspace", () => {
    const packet = buildBoundedContextPacket({
      prompt: VALIDATION_COLUMN_PROMPT,
      focusMode: "workspace",
      workspace: {
        _id: "workspace-launch",
        title: "Spectra Launch Studio",
      },
      focusedArtifact: {
        _id: "sheet-enzyme",
        title: "Enzyme Km & Vmax Comparison",
        blueprintKey: "sheets",
        summary: "Km and Vmax table",
        content: sheetsContent,
        tags: ["biology"],
        placements: [
          {
            workspaceId: "workspace-launch",
            workspaceTitle: "Spectra Launch Studio",
            nodeId: "item-sheet",
          },
        ],
        updatedAt: Date.now(),
      },
      artifacts: [],
      currentView: "studio",
    });
    expect(packet.focusedArtifact?.id).toBe("sheet-enzyme");
    expect(packet.focusedArtifact?.type).toBe("sheets");
    expect(packet.profile).toBe("focused_mutation");
    expect(
      (packet.focusedArtifact as { structure?: { sheets?: unknown[] } } | null)
        ?.structure?.sheets,
    ).toBeTruthy();
  });

  it("does not promote a focused sheets contentPatch update into a create", () => {
    const plan = {
      decision: "operate",
      intent: {
        mode: "update",
        requestedArtifactTypes: ["sheets"],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: "sheet-enzyme",
        targetWorkspaceId: "workspace-launch",
      },
      finalResponse: "Added the Km validation column.",
      operations: [
        {
          type: "artifact.update",
          input: {
            artifactId: "sheet-enzyme",
            blueprintKey: "sheets",
            title: null,
            summary: null,
            content: null,
            contentPatch: {
              changes: [
                {
                  path: "/sheets/0/cells/D1/value",
                  value: "Km < 5?",
                },
              ],
            },
            tags: null,
          },
        },
      ],
    };
    const promoted = promoteMatchingUpdateToCreate(plan, {
      requested: { blueprintKey: "sheets", label: "Sheets" },
      workspaceId: "workspace-launch",
    }) as Record<string, unknown>;
    // contentPatch-only updates are not full-content create candidates
    expect((promoted.operations as Array<{ type: string }>)[0]?.type).toBe(
      "artifact.update",
    );
    expect(promptLooksLikeFreshCreate(VALIDATION_COLUMN_PROMPT)).toBe(false);
  });

  it("coerces empty requestedArtifactTypes from authored creates", () => {
    const coerced = coerceCommonPlanSchemaSlips({
      decision: "operate",
      intent: {
        mode: "update",
        requestedArtifactTypes: [],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: null,
        targetWorkspaceId: null,
      },
      finalResponse: "Created the Km sheet.",
      operations: [
        {
          type: "artifact.create",
          input: {
            blueprintKey: "sheets",
            title: "Enzyme Km and Vmax",
            summary: "Comparison table.",
            content: sheetsContent,
            tags: [],
            workspaceId: "workspace-launch",
            placement: "context",
            pinned: false,
            exclusivePin: false,
          },
        },
      ],
    }) as Record<string, unknown>;
    const intent = coerced.intent as Record<string, unknown>;
    expect(intent.mode).toBe("create");
    expect(intent.requestedArtifactTypes).toEqual(["sheets"]);
    expect(intent.requestedVisibleArtifactCount).toBeGreaterThanOrEqual(1);
    const plan = parseSpectraPlan(coerced);
    expect(() =>
      validatePlanAgainstIntent(plan, {
        artifactIds: new Set(),
        workspaceIds: new Set(["workspace-launch"]),
        placementNodes: new Map(),
      }),
    ).not.toThrow();
  });

  it("promotes create-counted-as-update sheets content into artifact.create", () => {
    const promoted = promoteMatchingUpdateToCreate(
      {
        decision: "operate",
        intent: {
          mode: "update",
          requestedArtifactTypes: ["sheets"],
          requestedVisibleArtifactCount: 0,
          targetArtifactId: "existing-sheet",
          targetWorkspaceId: "workspace-launch",
        },
        finalResponse: "Updated the sheet.",
        operations: [
          {
            type: "artifact.update",
            input: {
              artifactId: "existing-sheet",
              blueprintKey: "sheets",
              title: "Enzyme Km and Vmax",
              summary: "Comparison table.",
              content: sheetsContent,
              tags: [],
            },
          },
        ],
      },
      {
        requested: { blueprintKey: "sheets", label: "Sheets" },
        workspaceId: "workspace-launch",
      },
    ) as Record<string, unknown>;
    const operations = promoted.operations as Array<Record<string, unknown>>;
    expect(operations).toHaveLength(1);
    expect(operations[0]?.type).toBe("artifact.create");
    const intent = promoted.intent as Record<string, unknown>;
    expect(intent.mode).toBe("create");
    expect(intent.requestedArtifactTypes).toEqual(["sheets"]);
    expect(intent.targetArtifactId).toBeNull();
    const plan = parseSpectraPlan(promoted);
    expect(() =>
      validatePlanAgainstIntent(plan, {
        artifactIds: new Set(["existing-sheet"]),
        workspaceIds: new Set(["workspace-launch"]),
        placementNodes: new Map(),
      }),
    ).not.toThrow();
  });

  it("preserves operation indexes when a modeled update is promoted in place", () => {
    const promoted = promoteMatchingUpdateToCreate(
      {
        decision: "operate",
        intent: {
          mode: "mixed",
          requestedArtifactTypes: ["sheets"],
          requestedVisibleArtifactCount: 1,
          targetArtifactId: null,
          targetWorkspaceId: "workspace-launch",
          obligations: [
            {
              id: "archive-source",
              description: "Archive the old draft.",
              operationIndexes: [0],
            },
            {
              id: "new-sheet",
              description: "Create the new sheet.",
              operationIndexes: [1],
            },
          ],
        },
        finalResponse: "Created the sheet and archived the old draft.",
        operations: [
          {
            type: "artifact.archive",
            input: { artifactId: "old-draft" },
          },
          {
            type: "artifact.update",
            input: {
              artifactId: "existing-sheet",
              blueprintKey: "sheets",
              title: "Enzyme Km and Vmax",
              summary: "Comparison table.",
              content: sheetsContent,
              tags: [],
            },
          },
        ],
      },
      {
        requested: { blueprintKey: "sheets", label: "Sheets" },
        workspaceId: "workspace-launch",
      },
    );

    const plan = parseSpectraPlan(promoted);
    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "artifact.archive",
      "artifact.create",
    ]);
    expect(plan.intent.obligations?.map((entry) => entry.operationIndexes)).toEqual([
      [0],
      [1],
    ]);
  });

  it("alignIntentWithCreates fills missing create types without rejecting", () => {
    const aligned = alignIntentWithCreates({
      decision: "operate",
      intent: {
        mode: "answer",
        requestedArtifactTypes: [],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: null,
        targetWorkspaceId: null,
      },
      operations: [
        {
          type: "artifact.create",
          input: {
            blueprintKey: "sheets",
            workspaceId: "workspace-launch",
          },
        },
      ],
    }) as Record<string, unknown>;
    const intent = aligned.intent as Record<string, unknown>;
    expect(intent.mode).toBe("create");
    expect(intent.requestedArtifactTypes).toEqual(["sheets"]);
    expect(intent.targetWorkspaceId).toBe("workspace-launch");
  });

  it("marks intent mismatches as quiet-retryable and maps the public error", () => {
    const error = new Error(
      "The proposed sheets artifact is unrelated to the interpreted request.",
    );
    expect(isRepairablePlanFailure(error)).toBe(true);
    expect(formatPlanApplicationPublicError(error)).toContain(
      "did not match the selected object or request",
    );
    expect(
      isRepairablePlanFailure(
        new Error("The artifact destination does not match the interpreted request."),
      ),
    ).toBe(true);
  });
});
