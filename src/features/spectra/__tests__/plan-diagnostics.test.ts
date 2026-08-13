import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  coerceCommonPlanSchemaSlips,
  formatPlanApplicationPublicError,
  formatZodPlanPublicError,
  isQuietRetryableApplyFailure,
  isRepairablePlanFailure,
} from "../operations/plan-diagnostics";
import { parseSpectraPlan } from "../operations/schema";
import { validatePlanAgainstIntent } from "../operations/validate-plan";
import { normalizeArtifactContent } from "../ai/content-normalization";

describe("plan diagnostics and schema slip recovery", () => {
  it("unwraps { workSummary, plan } terminal envelopes before Zod", () => {
    const plan = parseSpectraPlan({
      workSummary: "Rewriting the third quiz stem",
      plan: {
        decision: "operate",
        intent: {
          mode: "update",
          requestedArtifactTypes: ["quiz"],
          requestedVisibleArtifactCount: 0,
          targetArtifactId: "quiz-focused",
          targetWorkspaceId: null,
        },
        conversationTitle: "Quiz edit",
        conversationSummary: "Tighten stem 3",
        choices: null,
        operations: [
          {
            type: "artifact.archive",
            input: { artifactId: "quiz-focused" },
          },
        ],
        finalResponse: "Updated the third quiz question.",
      },
    });
    expect(plan.decision).toBe("operate");
    expect(plan.intent.targetArtifactId).toBe("quiz-focused");
    expect(plan.operations).toHaveLength(1);
    expect(plan.finalResponse).toContain("Updated");
  });

  it("preserves targetArtifactId when coercing focused quiz envelopes", () => {
    const coerced = coerceCommonPlanSchemaSlips({
      workSummary: "Softening distractor B",
      plan: {
        decision: "operate",
        intent: {
          mode: "update",
          requestedArtifactTypes: ["quiz"],
          requestedVisibleArtifactCount: 0,
          targetArtifactId: "quiz-42",
          targetWorkspaceId: null,
        },
        finalResponse: "Adjusted the distractor.",
        operations: [
          {
            type: "artifact.update",
            input: { artifactId: "quiz-42" },
          },
        ],
      },
    }) as {
      intent: { targetArtifactId: string | null };
    };
    expect(coerced.intent.targetArtifactId).toBe("quiz-42");
  });

  it("coerces common envelope slips so Zod does not dead-end", () => {
    const plan = parseSpectraPlan({
      decision: "answer",
      intent: {
        mode: "answer",
        requestedArtifactTypes: [],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: null,
        targetWorkspaceId: null,
      },
      finalResponse: 42,
      operations: [],
      progressUpdates: [{ title: "noise" }],
      modelNotes: "strip me",
    });
    expect(plan.finalResponse).toBe("42");
    expect(plan.decision).toBe("answer");
  });

  it("coerces empty titles/summaries and synthesizes blank finalResponse", () => {
    const coerced = coerceCommonPlanSchemaSlips({
      decision: "operate",
      conversationTitle: "   ",
      conversationSummary: "",
      finalResponse: "   ",
      operations: [
        {
          type: "artifact.archive",
          input: { artifactId: "artifact-1" },
        },
      ],
    }) as Record<string, unknown>;
    expect(coerced.conversationTitle).toBeNull();
    expect(coerced.conversationSummary).toBeNull();
    expect(String(coerced.finalResponse).length).toBeGreaterThan(0);
    const plan = parseSpectraPlan(coerced);
    expect(plan.conversationTitle).toBeNull();
    expect(plan.finalResponse.length).toBeGreaterThan(0);
  });

  it("infers decision and intent when the model omits them", () => {
    const plan = parseSpectraPlan({
      finalResponse: "Here is the answer.",
      operations: [],
    });
    expect(plan.decision).toBe("answer");
    expect(plan.intent.mode).toBe("answer");
  });

  it("converts empty operate plans with clarifying prose into clarify", () => {
    const plan = parseSpectraPlan({
      decision: "operate",
      intent: {
        mode: "update",
        requestedArtifactTypes: [],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: null,
        targetWorkspaceId: null,
      },
      finalResponse: "Which document should I update?",
      operations: [],
    });
    expect(plan.decision).toBe("clarify");
    expect(plan.operations).toEqual([]);
  });

  it("drops contradictory operations on answer plans", () => {
    const plan = parseSpectraPlan({
      decision: "answer",
      intent: {
        mode: "answer",
        requestedArtifactTypes: [],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: null,
        targetWorkspaceId: null,
      },
      finalResponse: "Here is the explanation.",
      operations: [
        {
          type: "artifact.archive",
          input: { artifactId: "artifact-1" },
        },
      ],
    });
    expect(plan.decision).toBe("answer");
    expect(plan.operations).toEqual([]);
  });

  it("maps Zod paths to precise public guidance", () => {
    const error = new ZodError([
      {
        code: "custom",
        path: ["operations"],
        message: "operate plans require at least one operation",
      },
    ]);
    expect(formatZodPlanPublicError(error)).toContain("did not name a concrete change");
    expect(
      formatZodPlanPublicError(
        new ZodError([
          {
            code: "invalid_type",
            path: ["operations", 0, "input", "artifactId"],
            message: "Required",
            expected: "string",
          },
        ]),
      ),
    ).toContain("open or selected object");
    expect(
      formatZodPlanPublicError(
        new ZodError([
          {
            code: "invalid_type",
            path: ["intent", "mode"],
            message: "Invalid",
            expected: "string",
          },
        ]),
      ),
    ).toContain("misread the request intent");
  });

  it("maps resolve/validate intent mismatches to actionable copy", () => {
    expect(
      formatPlanApplicationPublicError(
        new Error("The proposed artifact update is unrelated to the interpreted request."),
      ),
    ).toContain("did not match the selected object");
    expect(
      formatPlanApplicationPublicError(
        new Error("Invalid artifact reference. The operation must use an owned id from the current context."),
      ),
    ).toContain("open or selected object");
  });

  it("marks schema slips as repairable and ownership failures as not", () => {
    expect(
      isRepairablePlanFailure(
        new ZodError([
          {
            code: "custom",
            path: ["finalResponse"],
            message: "Required",
          },
        ]),
      ),
    ).toBe(true);
    expect(
      isRepairablePlanFailure(
        new Error("Invalid artifact reference. The operation must use an owned id from the current context."),
      ),
    ).toBe(false);
  });

  it("quietly retries provider stalls and live-artifact sync races once", () => {
    expect(
      isRepairablePlanFailure(
        new Error(
          "The Spectra model returned an empty plan.",
        ),
      ),
    ).toBe(true);
    expect(
      isRepairablePlanFailure(
        new Error(
          "The current DeepSeek route produced no meaningful stream data for 25 seconds.",
        ),
      ),
    ).toBe(true);
    expect(
      isQuietRetryableApplyFailure(
        new Error(
          "Spectra paused this agent after its reliability context budget. Continue in the thread to resume with a narrower context.",
        ),
      ),
    ).toBe(true);
    expect(
      isRepairablePlanFailure(
        new Error(
          "Spectra paused this agent after its reliability time budget. Continue in the thread to resume safely.",
        ),
      ),
    ).toBe(true);
    expect(
      isQuietRetryableApplyFailure(
        new Error("The live artifact has not finished synchronizing."),
      ),
    ).toBe(true);
    expect(
      isQuietRetryableApplyFailure(
        new Error(
          "AI_ARTIFACT_SYNC_TIMEOUT: The live edit was not durably acknowledged.",
        ),
      ),
    ).toBe(true);
    expect(
      isRepairablePlanFailure(
        new Error(
          "AI_ARTIFACT_SYNC_TIMEOUT: The live edit was not durably acknowledged.",
        ),
      ),
    ).toBe(false);
    expect(
      isQuietRetryableApplyFailure(
        new TypeError("Cannot set properties of undefined (setting '0')"),
      ),
    ).toBe(true);
    expect(
      isQuietRetryableApplyFailure(
        new TypeError("Cannot set property '0' of undefined"),
      ),
    ).toBe(true);
    expect(
      isQuietRetryableApplyFailure(
        new Error("AI_ARTIFACT_BASELINE_INVALID: Pending artifact content is invalid."),
      ),
    ).toBe(true);
    expect(
      isQuietRetryableApplyFailure(
        new Error(
          "The generated code artifact is hollow/incomplete — files are missing or only contain an empty <main></main> shell with no meaningful SVG or script.",
        ),
      ),
    ).toBe(true);
    expect(
      isQuietRetryableApplyFailure(
        new Error(
          "The generated timetable is hollow/incomplete — content.events must include at least one scheduled event.",
        ),
      ),
    ).toBe(true);
    expect(
      isQuietRetryableApplyFailure(
        new Error("Invalid artifact reference. The operation must use an owned id from the current context."),
      ),
    ).toBe(false);
  });

  it("coerces empty create intent from authored artifact.create operations", () => {
    const plan = parseSpectraPlan({
      decision: "operate",
      intent: {
        mode: "update",
        requestedArtifactTypes: [],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: null,
        targetWorkspaceId: null,
      },
      finalResponse: "Created a comparison sheet.",
      operations: [
        {
          type: "artifact.create",
          input: {
            blueprintKey: "sheets",
            title: "Km vs Vmax",
            summary: "Enzyme kinetics table.",
            content: normalizeArtifactContent("sheets", {
              workbook: { activeSheetId: "sheet-1" },
              sheets: [
                {
                  id: "sheet-1",
                  name: "Data",
                  rowCount: 10,
                  columnCount: 4,
                  cells: { A1: { value: "Km" } },
                },
              ],
            }),
            tags: [],
            workspaceId: "workspace-real",
            placement: "context",
            pinned: false,
            exclusivePin: false,
          },
        },
      ],
    });
    expect(plan.intent.mode).toBe("create");
    expect(plan.intent.requestedArtifactTypes).toEqual(["sheets"]);
    expect(() =>
      validatePlanAgainstIntent(plan, {
        artifactIds: new Set(),
        workspaceIds: new Set(["workspace-real"]),
        workspaceItems: new Map(),
      }),
    ).not.toThrow();
  });

  it("marks resolve/validate intent mismatches as repairable for quiet retry", () => {
    expect(
      isRepairablePlanFailure(
        new Error(
          "The proposed sheets artifact is unrelated to the interpreted request.",
        ),
      ),
    ).toBe(true);
    expect(
      isRepairablePlanFailure(
        new Error(
          "The proposed artifact update is unrelated to the interpreted request.",
        ),
      ),
    ).toBe(true);
  });

  it("marks coerceable live sheets schema misses as quiet-retryable", () => {
    expect(
      isQuietRetryableApplyFailure(
        new Error(
          "Invalid input at sheets.0.rowIdentities.0: Invalid input: expected string, received undefined",
        ),
      ),
    ).toBe(true);
    expect(
      isQuietRetryableApplyFailure(
        new Error("Invalid input: expected string, received undefined"),
      ),
    ).toBe(true);
    expect(
      isQuietRetryableApplyFailure(
        new Error(
          "AI_ARTIFACT_SCHEMA_INVALID: Invalid input at workbook.locale: Invalid input: expected string, received undefined",
        ),
      ),
    ).toBe(true);
  });

  it("keeps resolveAndValidate-style ownership failures precise after local validation", () => {
    const plan = parseSpectraPlan({
      decision: "operate",
      intent: {
        mode: "update",
        requestedArtifactTypes: ["document"],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: "artifact-missing",
        targetWorkspaceId: null,
      },
      finalResponse: "Updated the notes.",
      operations: [
        {
          type: "artifact.update",
          input: {
            artifactId: "artifact-missing",
            blueprintKey: "document",
            title: null,
            summary: null,
            content: { blocks: [{ id: "b1", type: "paragraph", text: "Hi" }], outline: [] },
            tags: null,
          },
        },
      ],
    });
    expect(() =>
      validatePlanAgainstIntent(plan, {
        artifactIds: new Set(["artifact-real"]),
        workspaceIds: new Set(["workspace-real"]),
        workspaceItems: new Map(),
      }),
    ).toThrow(/owned id/i);
    try {
      validatePlanAgainstIntent(plan, {
        artifactIds: new Set(["artifact-real"]),
        workspaceIds: new Set(["workspace-real"]),
        workspaceItems: new Map(),
      });
    } catch (error) {
      expect(formatPlanApplicationPublicError(error)).toContain(
        "open or selected object",
      );
      expect(formatPlanApplicationPublicError(error)).not.toContain(
        "could not safely apply that plan",
      );
    }
  });
});
