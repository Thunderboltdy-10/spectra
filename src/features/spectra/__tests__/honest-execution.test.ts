import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applicationAuthorityTarget,
  confirmationDiffSummary,
  evaluateApplicationAuthority,
} from "../ai/authority-execution";
import { formatPlanApplicationPublicError } from "../operations/plan-diagnostics";
import { evaluatePlanPolicy } from "../operations/policy";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("P4.I3 honest execution and authority", () => {
  it("promotes Library rename/move with local files to local_file confirm", () => {
    expect(
      applicationAuthorityTarget(
        "organize_library",
        { action: "rename", targetIds: ["node-1"] },
        2,
      ),
    ).toEqual({ target: "local_file", fileCount: 2 });
    expect(
      evaluateApplicationAuthority({
        command: "organize_library",
        args: { action: "rename", targetIds: ["node-1"] },
        localFileCount: 2,
      }).decision,
    ).toBe("confirm");
  });

  it("keeps folder create as tree notify and does not pause the plan", () => {
    expect(
      applicationAuthorityTarget(
        "organize_library",
        { action: "create_folder", name: "Sources" },
        0,
      ).target,
    ).toBe("tree");
    const policy = evaluatePlanPolicy(
      [
        {
          type: "app.command",
          input: {
            command: "organize_library",
            args: {
              action: "create_folder",
              name: "Sources",
              localFileCount: 0,
            },
          },
        },
      ] as never,
      {
        intent: {
          mode: "update",
          requestedArtifactTypes: [],
          requestedVisibleArtifactCount: 0,
          targetArtifactId: null,
          targetWorkspaceId: null,
        },
      },
    );
    expect(policy.requiresConfirmation).toBe(false);
    expect(policy.reasons.join(" ")).not.toMatch(/organize library/i);
  });

  it("names confirmation targets and file counts in the dock summary", () => {
    expect(
      confirmationDiffSummary({
        targetTitles: ["Physics Essay"],
        reasons: ["A real local-file effect requires explicit approval."],
      }),
    ).toBe(
      "Editing Physics Essay · A real local-file effect requires explicit approval.",
    );
  });

  it("humanizes SNAKE_CASE run failures without mentioning Word", () => {
    const spoken = formatPlanApplicationPublicError(
      new Error("AUTHORITY_PROHIBITED:ACCOUNT_SECURITY"),
    );
    expect(spoken).not.toMatch(/Word|Office file/i);
    expect(spoken).not.toMatch(/AUTHORITY_PROHIBITED|ACCOUNT_SECURITY/);
    expect(
      formatPlanApplicationPublicError(new Error("NATIVE_MATERIALIZE_SKIPPED")),
    ).not.toMatch(/NATIVE_MATERIALIZE_SKIPPED/);
  });

  it("restores a finished run as a human claim, not a live AI operation", () => {
    const runtime = read("src/app/api/spectra/run/runtime.ts");
    const revert = runtime.slice(
      runtime.indexOf('if (action === "revert")'),
      runtime.indexOf('if (action === "cancel")'),
    );
    expect(revert).toContain('claimActorKind: "human"');
    expect(revert).toContain("spectraRuns:patchResultCard");
    expect(revert).toContain('key: "undone"');
    const yjs = read("src/features/spectra/ai/yjs-artifact-operation.ts");
    expect(yjs).toContain('claimActorKind?: "ai" | "human"');
    expect(yjs).toContain("actorKind: claimActorKind");
    expect(yjs).toContain('claimActorKind === "human" ? 0 : 48');
    expect(yjs).toContain("Math.min(36, Math.max(0, beat.delayMs))");
    expect(yjs).toMatch(
      /claimActorKind === "ai"\s*\?\s*\{\s*runId: params\.runId,\s*operationId: params\.operationId\s*\}/,
    );
  });

  it("keeps Stop and Retry as always-visible dock tab icons", () => {
    const dock = read("src/features/spectra/components/live-dock.tsx");
    expect(dock).toContain("aria-label={`Stop ${model.title}`}");
    expect(dock).toContain("aria-label={`Retry ${model.title}`}");
    expect(dock).toContain("Undo this run");
    expect(dock).toContain("confirmationDiffSummary");
  });

  it("does not hijack navigation when settings change", () => {
    const shell = read("src/features/spectra/pages/spectra-shell.tsx");
    const handler = shell.slice(
      shell.indexOf('"settings.change"'),
      shell.indexOf('"sync.policy.change"'),
    );
    expect(handler).not.toContain("router.push");
  });

  it("journals AI sync-policy changes as ai and meters each execution", () => {
    const act = read("src/app/api/spectra/run/loop/act.ts");
    expect(act).toContain('actorKind: "ai"');
    // Keyed per execution; the shared helper appends `:model_input_tokens`.
    // Later growth in the same execution is keyed from the metered total; a
    // replacement worker after a takeover is keyed by its own worker id.
    const meters = read("convex/spectraRuns.ts");
    expect(meters).toContain(
      "const executionPrefix = `spectra-run:${run._id}:${run.executionId}${firstWorker ? \"\" : `:worker:${workerId}`}`;",
    );
    expect(read("convex/metering.ts")).toContain(
      "idempotencyKey: `${args.idempotencyPrefix}:${category}`",
    );
  });

  it("does not imply a local model in writing-suggestion copy", () => {
    const settings = read(
      "src/features/spectra/settings/ui/settings-application.tsx",
    );
    const writing = settings.slice(
      settings.indexOf("function WritingSettings"),
      settings.indexOf("function AppearanceSettings"),
    );
    expect(writing).not.toMatch(/local model|Local writing suggestions/i);
    expect(writing).toContain("never insert text until you accept them");
  });

  it("arms Live Dock Undo after durable AI artifact.create as well as update", () => {
    const runtime = read("src/app/api/spectra/run/runtime.ts");
    expect(runtime).toContain("function operationTypesArmRunUndo");
    expect(runtime).toContain('operation.type === "artifact.create"');
    expect(runtime).toContain("operationTypesArmRunUndo(plan.operations)");
    expect(runtime).toContain("operationTypesArmRunUndo(operations)");
    expect(runtime).toContain("durableArtifactWritesFromOutcomes");
    // Stop mid-run must still expose revert when creates already landed.
    const stopArm = runtime.slice(
      runtime.indexOf("const durableArtifactWrite = effects.undoAvailable"),
      runtime.indexOf('publish({\n        type: "stopped"'),
    );
    expect(stopArm).toContain("interruptedEffectActions(effects, params.runId)");
    // Empty worker outcomes must not replace stopRun card actions (would strip Undo).
    expect(stopArm).toContain("...(durableArtifactWrite");
    expect(stopArm).toContain("resultActions:");
    const errorPublish = runtime.indexOf('type: "error"');
    const failedBlock = runtime.slice(
      Math.max(0, errorPublish - 1200),
      errorPublish,
    );
    // The receipt helper is also exercised with actual saved/failed/ambiguous
    // inputs in s11-review-ai-receipt-report.test.ts, including Undo admission.
    expect(failedBlock).toContain("interruptedEffectActions(effects, params.runId)");
    expect(runtime).toContain("acknowledged: operationOutcomes");
    const stopRun = read("convex/spectraRuns.ts");
    expect(stopRun).toContain("function durableArtifactWritesArmRunUndo");
    expect(stopRun).toContain('operation.type === "artifact.create"');
    expect(stopRun).toContain('operation.status === "executed"');
    const stopMutation = stopRun.slice(
      stopRun.indexOf("export const stopRun = mutation"),
      stopRun.indexOf("export const setSuggestedThreadMetadata"),
    );
    expect(stopMutation).toContain('key: "revert"');
    expect(stopMutation).toContain(
      "durableArtifactWritesArmRunUndoIncludingPending",
    );
    // Stop while awaiting approval must not 409; Apply can still land durable work.
    expect(stopMutation).toContain('run.status !== "awaiting_confirmation"');
    expect(stopRun).toContain(
      "function durableArtifactWritesArmRunUndoIncludingPending",
    );
    expect(stopRun).toContain("artifact?.currentVersionId");
    // Confirmation Apply completion arms Undo from post-Apply outcomes.
    expect(runtime).toContain(
      "durableArtifactWritesFromOutcomes(outcomes)",
    );
  });

  it("exits single-creation whenever Calendar action is requested (note+schedule)", () => {
    const plan = read("src/app/api/spectra/run/loop/plan.ts");
    const gate = plan.slice(
      plan.indexOf("const calendarActionRequested = promptRequestsCalendarAction"),
      plan.indexOf("const explicitlyTargetsFocusedArtifact"),
    );
    // Must not keep note+personal-event on create_note-only tool list.
    expect(gate).toContain(
      "const calendarNeedsCoordination = !forcedSingleCreation && calendarActionRequested",
    );
    expect(gate).not.toContain(
      "const calendarNeedsCoordination = calendarCreatesPlannerTask",
    );
    expect(plan).toContain("create_calendar_personal_event");
  });

  it("exposes AI personal-event create on the same path as human Add event", () => {
    const tools = read("src/features/spectra/tools/registry/application-tools.ts");
    expect(tools).toContain('id: "create_calendar_personal_event"');
    // Must be on the agent allowlist — registry define alone does not expose it.
    const allowlistStart = tools.indexOf("export const APPLICATION_AGENT_TOOL_IDS");
    const allowlist = tools.slice(
      allowlistStart,
      tools.indexOf("] as const;", allowlistStart) + 12,
    );
    expect(allowlist).toContain("create_calendar_personal_event");
    const command = read("src/features/spectra/calendar/domain/command.ts");
    expect(command).toContain('create_calendar_personal_event: "calendar:createPersonalItem"');
    expect(command).toContain('"calendar.create_personal_event"');
    const convex = read("convex/calendar.ts");
    expect(convex).toContain('createdBy: args.actorKind === "ai" ? "ai" : "human"');
    const plan = read("src/app/api/spectra/run/loop/plan.ts");
    expect(plan).toContain("create_calendar_personal_event");
    expect(plan).toContain('refuse with "scheduling unavailable"');
  });
});
