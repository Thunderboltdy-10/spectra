import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { operationEffectProgress } from "@/app/api/spectra/run/loop/act";
import { formatPlanApplicationPublicError } from "../operations/plan-diagnostics";
import type { ModelOperation } from "../operations/schema";
import {
  deriveLiveDockTab,
  liveDockStateCopy,
  publicSpectraFailureText,
} from "../runs/live-dock";

/* What a first-time student reads when a run ends. Terminal words must say
   what happened in plain language and what to do next (CANON §2 "Calm"). */
const JARGON = /recovery (?:passes|options)|exhausted|artifact|semantic region|operations?\.\d|blueprint/i;

describe("run outcome copy", () => {
  it("labels a stopped run with the same word as the Stop control", () => {
    const model = deriveLiveDockTab({
      runId: "run-1",
      threadId: "thread-1",
      run: { status: "cancelled", phase: "stopped" },
    });
    expect(model.state).toBe("cancelled");
    expect(liveDockStateCopy[model.state]).toBe("Stopped");
  });

  it("says a failed run could not finish and what to do next", () => {
    const model = deriveLiveDockTab({
      runId: "run-2",
      threadId: "thread-2",
      run: { status: "failed", phase: "failed", retryable: false },
    });
    expect(liveDockStateCopy[model.state]).toBe("Could not finish");
    expect(model.finalSummary).toMatch(/Ask again|rephrase/);
    expect(model.finalSummary).not.toMatch(JARGON);
    expect(publicSpectraFailureText(undefined, true)).toMatch(/Retry/);
    for (const label of Object.values(liveDockStateCopy))
      expect(label).not.toMatch(JARGON);
  });

  it("never prints a schema path or the word artifact in plan failures", () => {
    const schemaFailure = new ZodError([
      { code: "custom", path: ["operations", 0, "input", "weird"], message: "bad" },
    ]);
    const unmatched = new ZodError([
      { code: "custom", path: ["weirdField"], message: "bad" },
    ]);
    for (const error of [
      schemaFailure,
      unmatched,
      new TypeError("x is undefined"),
      new Error("Draft does not match the interpreted request"),
    ]) {
      const text = formatPlanApplicationPublicError(error);
      expect(text).not.toMatch(JARGON);
      expect(text).not.toMatch(/weirdField/);
    }
  });

  it("describes live progress with work type names, not internal keys", () => {
    const create = operationEffectProgress(
      {
        type: "artifact.create",
        input: { title: "Photosynthesis", blueprintKey: "flashcard_deck" },
      } as unknown as ModelOperation,
      0,
    );
    expect(create?.detail).not.toMatch(JARGON);
    const update = operationEffectProgress(
      {
        type: "artifact.update",
        input: {
          blueprintKey: "sheets",
          content: null,
          title: null,
          summary: null,
          contentPatch: { changes: [{ path: "/cells/A1" }] },
        },
      } as unknown as ModelOperation,
      0,
    );
    expect(update?.title).not.toMatch(/sheets content|_/);
    expect(update?.detail).not.toMatch(JARGON);
  });
});
