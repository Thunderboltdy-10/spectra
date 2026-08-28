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
    const meters = read("convex/spectraRuns.ts");
    expect(meters).toContain(
      "spectra-run:${run._id}:${run.executionId}:model_input_tokens",
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
});
