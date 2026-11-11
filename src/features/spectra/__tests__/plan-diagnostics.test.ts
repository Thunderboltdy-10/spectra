import { describe, expect, it } from "vitest";
import { z, ZodError } from "zod";
import {
  coerceCommonPlanSchemaSlips,
  describeZodPlanIssues,
  stripNonIntentContextFields,
  formatPlanApplicationPublicError,
  formatZodPlanPublicError,
  isQuietRetryableApplyFailure,
  isRepairablePlanFailure,
} from "../operations/plan-diagnostics";
import { parseSpectraPlan } from "../operations/schema";
import { validatePlanAgainstIntent } from "../operations/validate-plan";
import { normalizeArtifactContent } from "../ai/content-normalization";

describe("plan diagnostics and schema slip recovery", () => {
  it("reads a framed inactive-run error without diagnosing a folder failure (LV-039)", () => {
    const error = new Error("[Request ID: redacted] Server Error\nUncaught ConvexError: This run is no longer active.");
    expect(formatPlanApplicationPublicError(error)).toBe("This run is no longer active.");
  });

  it("uses structured Convex words before matching operation diagnostics", () => {
    const error = Object.assign(new Error("[Request ID: redacted] Server Error"), {
      data: { code: null, message: "The selected artifactId is not an owned id." },
    });
    expect(formatPlanApplicationPublicError(error)).toContain("open or selected object");
    expect(formatPlanApplicationPublicError(new Error("[Request ID: redacted] Server Error")))
      .not.toMatch(/Server Error|list files|Convex|Request ID/);
  });
  it("repairs an occupied-slot identity collision through the existing plan repair path", () => {
    const error = new Error("CONTENT_PATCH_IDENTITY_MISMATCH: append with /- instead.");
    expect(isRepairablePlanFailure(error)).toBe(true);
    expect(isQuietRetryableApplyFailure(error)).toBe(true);
  });
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

  it("drops the context-only focus hint without weakening target validation", () => {
    const planWithHint = {
      decision: "answer",
      intent: {
        mode: "answer",
        requestedArtifactTypes: [],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: null,
        targetWorkspaceId: null,
        focus: "the selected document",
      },
      conversationTitle: null,
      conversationSummary: null,
      choices: null,
      operations: [],
      finalResponse: "No document change is needed.",
    };

    const normalized = stripNonIntentContextFields(structuredClone(planWithHint));
    expect(parseSpectraPlan(normalized).intent.targetArtifactId).toBeNull();
    expect(normalized.intent).not.toHaveProperty("focus");

    const withOtherUnknownField = {
      ...planWithHint,
      intent: { ...planWithHint.intent, unverifiedTarget: "artifact-1" },
    };
    expect(() => parseSpectraPlan(stripNonIntentContextFields(withOtherUnknownField))).toThrow(
      /unrecognized key/i,
    );
  });

  it("strips only copied activeGoal context from the strict operation intent", () => {
    const plan = parseSpectraPlan({
      decision: "operate",
      intent: {
        mode: "update",
        requestedArtifactTypes: ["document"],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: "doc-1",
        targetWorkspaceId: null,
        activeGoal: {
          request: "Update the existing guide and presentation.",
          userResponse: "Use the five-row dataset.",
        },
        finalResponse: "The response belongs at the plan level.",
      },
      operations: [{ type: "artifact.archive", input: { artifactId: "doc-1" } }],
      finalResponse: "Updated the guide.",
    });

    expect(plan.intent.targetArtifactId).toBe("doc-1");
    expect(plan.intent).not.toHaveProperty("activeGoal");
    expect(plan.intent).not.toHaveProperty("finalResponse");
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

  it("fills an empty obligation from the remaining staged operation indexes", () => {
    const plan = parseSpectraPlan({
      decision: "operate",
      intent: {
        mode: "update",
        requestedArtifactTypes: [],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: null,
        targetWorkspaceId: null,
        obligations: [
          { id: "guide", description: "Update the guide", operationIndexes: [0] },
          { id: "deck", description: "Update the presentation", operationIndexes: [] },
        ],
      },
      conversationTitle: null,
      conversationSummary: null,
      choices: null,
      operations: [
        { type: "artifact.archive", input: { artifactId: "guide-id" } },
        { type: "artifact.archive", input: { artifactId: "deck-id" } },
      ],
      finalResponse: "Both requested updates are ready.",
    });

    expect(plan.intent.obligations?.map((item) => item.operationIndexes)).toEqual([
      [0],
      [1],
    ]);
  });

  it("maps multiple empty obligations only when there is one remaining operation each", () => {
    const coerced = coerceCommonPlanSchemaSlips({
      decision: "operate",
      intent: {
        mode: "update",
        requestedArtifactTypes: [],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: null,
        targetWorkspaceId: null,
        obligations: [
          { id: "one", description: "First outcome", operationIndexes: [] },
          { id: "two", description: "Second outcome", operationIndexes: [] },
        ],
      },
      operations: [
        { type: "artifact.archive", input: { artifactId: "one" } },
        { type: "artifact.archive", input: { artifactId: "two" } },
      ],
      finalResponse: "Done.",
    }) as { intent: { obligations: Array<{ operationIndexes: number[] }> } };

    expect(coerced.intent.obligations.map((item) => item.operationIndexes)).toEqual([
      [0],
      [1],
    ]);
  });

  it("rejects a clarification that has no options and no answerable question", () => {
    expect(() => parseSpectraPlan({
      decision: "clarify",
      intent: {
        mode: "answer",
        requestedArtifactTypes: [],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: null,
        targetWorkspaceId: null,
      },
      conversationTitle: null,
      conversationSummary: null,
      choices: null,
      operations: [],
      finalResponse: "The requested edits are not yet saved and the artifacts must be open.",
    })).toThrow(/must ask a clear question/i);
  });

  it("allows a free-text clarification question in the existing conversation", () => {
    const plan = parseSpectraPlan({
      decision: "clarify",
      intent: {
        mode: "answer",
        requestedArtifactTypes: [],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: null,
        targetWorkspaceId: null,
      },
      conversationTitle: null,
      conversationSummary: null,
      choices: null,
      operations: [],
      finalResponse: "Which of these two documents should I update?",
    });

    expect(plan.decision).toBe("clarify");
    expect(plan.choices).toBeNull();
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

  it("drops operation-index obligations when a plan becomes non-operational", () => {
    const coerced = coerceCommonPlanSchemaSlips({
      decision: "operate",
      intent: {
        mode: "update",
        requestedArtifactTypes: ["document"],
        requestedVisibleArtifactCount: 0,
        targetArtifactId: "artifact-1",
        targetWorkspaceId: null,
        obligations: [
          {
            id: "update",
            description: "Update the selected document.",
            operationIndexes: [0],
          },
        ],
      },
      operations: [],
      finalResponse: "Which document should I update?",
    }) as { decision: string; intent: Record<string, unknown> };

    expect(coerced.decision).toBe("clarify");
    expect(coerced.intent).not.toHaveProperty("obligations");
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
    ).toContain("was not sure what you meant");
  });

  it("surfaces the matching blueprint branch beneath an invalid union", () => {
    const schema = z.union([
      z.object({
        blueprintKey: z.literal("document"),
        content: z.object({ blocks: z.array(z.string()) }),
      }),
      z.object({
        blueprintKey: z.literal("presentation"),
        content: z.object({ slides: z.array(z.string()) }),
      }),
    ]);
    const parsed = schema.safeParse({
      blueprintKey: "document",
      content: { blocks: [12] },
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(describeZodPlanIssues(parsed.error)).toEqual([
      expect.objectContaining({
        path: "content.blocks.0",
        code: "invalid_type",
      }),
    ]);
  });

  it("does not map Convex validator or region-claim failures to a targeting miss", () => {
    expect(
      formatPlanApplicationPublicError(
        new Error(
          'ArgumentValidationError: Value does not match validator.\nPath: .operationId\nValidator: v.id("spectraOperations")',
        ),
      ),
    ).toContain("could not finish that change");
    expect(
      formatPlanApplicationPublicError(
        new Error("REGION_CLAIM_RUN_INVALID: The AI run is no longer active."),
      ),
    ).not.toContain("open or selected object");
  });

  it("maps resolve/validate intent mismatches to actionable copy", () => {
    expect(
      formatPlanApplicationPublicError(
        new Error("The proposed artifact update is unrelated to the interpreted request."),
      ),
    ).toContain("did not match what you selected or asked for");
    expect(
      formatPlanApplicationPublicError(
        new Error("Invalid artifact reference. The operation must use an owned id from the current context."),
      ),
    ).toContain("open or selected object");
  });

  it("repairs missing verified slide citations and explains the recovery clearly", () => {
    const failure = new Error(
      "PRESENTATION_CITATION_EVIDENCE_REQUIRED: The requested reference-free deck must retain verified citation metadata on its narrative slides.",
    );

    expect(isRepairablePlanFailure(failure)).toBe(true);
    expect(formatPlanApplicationPublicError(failure)).toContain(
      "verified citations on its narrative slides",
    );
    expect(formatPlanApplicationPublicError(failure)).not.toContain(
      "open the file from Library with Spectra Bridge connected",
    );
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
        placementNodes: new Map(),
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

  it("repairs update-only target coverage and scope slips in the same run", () => {
    expect(
      isRepairablePlanFailure(
        new Error(
          "This update-only request names every exact target as required artifact. Add the missing artifact.update operation(s) before submitting the plan.",
        ),
      ),
    ).toBe(true);
    expect(
      isRepairablePlanFailure(
        new Error(
          "This request only allows updates to the exact named artifacts. The proposed target is outside that scope.",
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
        placementNodes: new Map(),
      }),
    ).toThrow(/owned id/i);
    try {
      validatePlanAgainstIntent(plan, {
        artifactIds: new Set(["artifact-real"]),
        workspaceIds: new Set(["workspace-real"]),
        placementNodes: new Map(),
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
