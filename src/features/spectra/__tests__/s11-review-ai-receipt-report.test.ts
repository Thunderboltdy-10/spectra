import { describe, expect, it, vi } from "vitest";
import {
  canUndoRunWithEffects, interruptedEffectActions, interruptedEffectSummary, reconcileInterruptedEffects, replyWithNativeReceipt, retainOutcomeThenVerify,
  type AcknowledgedOutcome,
} from "@/app/api/spectra/run/loop/receipt-report";
import type { StoredOperation } from "@/app/api/spectra/run/loop/contract";
import { applicationOperationScope } from "../../../../convex/spectraApplicationWriteScope";
import { formatPlanApplicationPublicError } from "../operations/plan-diagnostics";

const affected = [{ type: "artifact", id: "saved-guide" }];
const acknowledged: AcknowledgedOutcome = {
  operationId: "operation-1", operation: { type: "artifact.update", input: { artifactId: "saved-guide" } }, affected,
};
const stored = (overrides: Partial<StoredOperation> = {}): StoredOperation => ({
  _id: "operation-1", executionId: "attempt-1", type: "artifact.update",
  input: { artifactId: "saved-guide" }, status: "executed", affected, ...overrides,
});

describe("S11 receipt truth after verification, interruption and acknowledgement loss", () => {
  it.each(["no effects", "acknowledged save", "unknown apply"] as const)(
    "sanitizes a target error without losing the %s receipt policy",
    (scenario) => {
      const effects = reconcileInterruptedEffects({
        executionId: "attempt-1",
        acknowledged: scenario === "acknowledged save" ? [acknowledged] : [],
        attemptedEffect: scenario !== "no effects",
        unacknowledgedOperationId: scenario === "unknown apply" ? "operation-unknown" : undefined,
        operations: [],
      });
      const explanation = formatPlanApplicationPublicError(
        new Error("artifactId missing-artifact-private failed an internal Convex schema lookup"),
        { explanationOnly: true },
      );
      const sanitized = "Spectra could not match that request to an open or selected object. Choose the document or workspace you want to use, then try again.";
      expect(explanation).toBe(sanitized);
      const summary = interruptedEffectSummary(effects, explanation);
      if (scenario === "no effects") {
        expect(summary).toBe(sanitized);
        expect(effects).toMatchObject({ saved: false, ambiguous: false, committedCount: 0 });
      } else if (scenario === "acknowledged save") {
        expect(summary).toBe(`Earlier changes were saved and their receipts are preserved. ${sanitized}`);
        expect(effects).toMatchObject({ saved: true, ambiguous: false, committedCount: 1, outcome: "canonical_saved" });
      } else {
        expect(summary).toBe(`The last action's save could not be confirmed; review it before continuing. ${sanitized}`);
        expect(effects).toMatchObject({ saved: false, ambiguous: true, committedCount: 0, outcome: undefined });
      }
      expect(summary).not.toMatch(/artifactId|missing-artifact-private|schema|Convex|JSON/i);
    },
  );

  it("does not turn a saved citation-verification failure into a no-change claim", () => {
    const error = new Error("PRESENTATION_CITATION_EVIDENCE_REQUIRED");
    const effects = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [acknowledged], operations: [] });
    const explanation = formatPlanApplicationPublicError(error, { explanationOnly: true });
    const summary = interruptedEffectSummary(effects, explanation, { verificationFailed: true });
    expect(summary).toContain("Changes were saved");
    expect(summary).toContain("verified citations");
    expect(summary).not.toMatch(/no change was saved|nothing was saved|work is unchanged/i);
    expect(formatPlanApplicationPublicError(error)).toContain("no change was saved");
  });

  it("retains the first acknowledged save before its verifier throws", async () => {
    const outcomes: AcknowledgedOutcome[] = [];
    const verify = vi.fn(async () => {
      expect(outcomes).toEqual([acknowledged]);
      throw new Error("Saved citation metadata is missing.");
    });
    await expect(retainOutcomeThenVerify(outcomes, acknowledged, verify)).rejects.toThrow("citation metadata");
    const result = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: outcomes, operations: [], attemptedEffect: true });
    expect(result).toMatchObject({ saved: true, committedCount: 1, undoAvailable: true, outcome: "canonical_saved" });
    expect(interruptedEffectActions(result, "run-1")).toContainEqual(expect.objectContaining({ key: "open", targetId: "saved-guide" }));
    expect(interruptedEffectActions(result, "run-1")).toContainEqual(expect.objectContaining({ key: "revert", targetId: "run-1" }));
    const summary = interruptedEffectSummary(result, "The citations need repair.", { verificationFailed: true });
    expect(summary).toContain("saved");
    expect(summary).toContain("verification did not finish successfully");
    expect(summary).not.toMatch(/nothing was saved|no change was saved|unchanged/i);
  });

  it("recovers a lost acknowledgement from the same-attempt executed journal", () => {
    const result = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [], operations: [stored()], attemptedEffect: true });
    expect(result).toMatchObject({ saved: true, affected, undoAvailable: true, ambiguous: false });
  });

  it("keeps a prior save when a later operation has an unknown failed outcome", () => {
    const result = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [acknowledged], attemptedEffect: true,
      operations: [stored(), stored({ _id: "operation-2", status: "failed", affected: [], output: { error: "Reply lost" } })] });
    expect(result).toMatchObject({ committedCount: 1, saved: true, ambiguous: true, undoAvailable: true });
    expect(interruptedEffectSummary(result, "Continue the remaining work.")).toContain("last action's outcome remains unconfirmed");
  });

  it("keeps the first save but leaves a failed current-state retry unconfirmed", () => {
    const result = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [acknowledged],
      attemptedEffect: true, unacknowledgedOperationId: "operation-1",
      operations: [stored({ status: "failed", output: { currentStateRetryStartedAt: 1 } })] });
    expect(result).toMatchObject({ saved: true, committedCount: 1, undoAvailable: true, ambiguous: true });
    expect(interruptedEffectSummary(result, "The retry did not finish.")).toContain("last action's outcome remains unconfirmed");
  });

  it("does not attribute matching live content to an unacknowledged operation", () => {
    const input = { executionId: "attempt-1", acknowledged: [{ ...acknowledged, acknowledged: false }],
      attemptedEffect: true, unacknowledgedOperationId: "operation-1" };
    const unknown = reconcileInterruptedEffects({ ...input, operations: [stored({ status: "executing", affected: [] })] });
    expect(unknown).toMatchObject({ saved: false, committedCount: 0, undoAvailable: false, ambiguous: true });
    const confirmed = reconcileInterruptedEffects({ ...input, operations: [stored()] });
    expect(confirmed).toMatchObject({ saved: true, committedCount: 1, undoAvailable: true, ambiguous: false });
  });

  it("does not infer save or native-write facts from an error code alone", () => {
    const effects = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [], attemptedEffect: true });
    const explanation = formatPlanApplicationPublicError(new Error("NATIVE_VERIFY_FAILED"), { explanationOnly: true });
    expect(interruptedEffectSummary(effects, explanation)).not.toMatch(/saved the edit|file.*not updated/i);
    expect(explanation).toBe("The remaining step could not be completed.");
  });

  it("does not erase retained affected IDs when legacy markFailed changed only the status", () => {
    const result = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [], operations: [stored({
      status: "failed", output: { artifactId: "saved-guide", error: "Verification failed after markExecuted" },
    })] });
    expect(result).toMatchObject({ saved: true, affected, undoAvailable: true });
  });

  it("keeps a scoped transactional application receipt without inventing an artifact or Undo", () => {
    const operation = stored({ type: "app.command", input: { command: "change_spectra_settings", args: { patch: { appearance: { density: "compact" } } } },
      status: "failed", affected: [] });
    const receipt = { scope: applicationOperationScope(operation), result: { revision: 4, density: "compact" } };
    operation.output = { applicationWriteReceipt: receipt, error: "Acknowledgement lost" };
    const result = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [], operations: [operation] });
    expect(result).toMatchObject({ saved: true, undoAvailable: false, affected: [], applicationReceipts: [{ operationId: "operation-1", receipt }] });
    expect(interruptedEffectActions(result, "run-1")).toEqual([]);
  });

  it("rejects receipt scopes from another operation and ignores another attempt's rows", () => {
    const result = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [], operations: [
      stored({ executionId: "previous-attempt" }),
      stored({ type: "app.command", status: "executing", affected: [], output: {
        applicationWriteReceipt: { scope: "another-operation", result: { saved: true } },
      } }),
    ] });
    expect(result).toMatchObject({ saved: false, affected: [], undoAvailable: false, committedCount: 0, ambiguous: true });
    expect(canUndoRunWithEffects("failed", result)).toBe(false);
  });

  it("distinguishes a pre-effect failure from an unacknowledged attempted write", () => {
    const before = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [], operations: [stored({ status: "proposed", affected: [] })] });
    const unknown = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [], operations: null, attemptedEffect: true });
    expect(interruptedEffectSummary(before, "The draft needs repair.")).toBe("The draft needs repair.");
    expect(interruptedEffectSummary(unknown, "Review the current work.")).toContain("save could not be confirmed");
    expect(unknown.outcome).toBeUndefined();
  });

  it("deduplicates the local acknowledgement and journal receipt by operation ID", () => {
    const result = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [acknowledged], operations: [stored()] });
    expect(result.committedCount).toBe(1);
    expect(result.affected).toEqual(affected);
    expect(interruptedEffectActions(result, "run-1").filter((action) => action.key === "open")).toHaveLength(1);
  });

  it("allows the preserved Undo on failed saved work without allowing Undo during active execution", () => {
    const saved = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [], operations: [stored()] });
    const none = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [], operations: [] });
    expect(canUndoRunWithEffects("failed", saved)).toBe(true);
    expect(canUndoRunWithEffects("failed", none)).toBe(false);
    for (const status of ["queued", "running", "awaiting_resolution", "awaiting_confirmation"])
      expect(canUndoRunWithEffects(status, saved)).toBe(false);
  });

  it("does not turn parked continuation candidates into a saved receipt", () => {
    const operation = stored({ type: "app.command", input: { command: "organize_library", args: {} }, status: "waiting", affected: [] });
    operation.output = { clarificationDraft: { index: 0 }, applicationWriteReceipt: { scope: applicationOperationScope(operation), result: { id: "not-saved" } } };
    const result = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [], operations: [operation] });
    expect(result).toMatchObject({ saved: false, committedCount: 0, undoAvailable: false });
  });

  it.each([
    { state: "pending", outcome: "native_pending" },
    { state: "claimed", outcome: "native_pending" },
    { state: "verified", outcome: "native_verified" },
  ])("reads a queued local-file write ($state) from the admission receipt of an interrupted run", ({ state, outcome }) => {
    const operation = stored({ output: { artifactWriteReceipt: { scope: "scope", result: { state: "committed",
      receipt: { roomId: "room", sequence: 2, updateDigest: "digest", nativeResult: { requestId: "request-1", state } } } } } });
    const result = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [], operations: [operation], run: { outcome: "executing" } });
    expect(result.outcome).toBe(outcome);
    const cloud = stored({ output: { artifactWriteReceipt: { scope: "scope", result: { state: "committed",
      receipt: { roomId: "room", sequence: 2, updateDigest: "digest", nativeResult: { state: "cloud_saved", operationId: "sync-1" } } } } } });
    expect(reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [], operations: [cloud] }).outcome).toBe("canonical_saved");
  });

  it.each([
    { outcome: "canonical_saved", expected: "Earlier changes were saved", absent: "was checked" },
    { outcome: "native_pending", expected: "hasn't confirmed this change yet", absent: "was checked" },
    { outcome: "native_verified", expected: "file on your computer was checked", absent: "hasn't confirmed" },
  ])("preserves $outcome truth after Stop without upgrading native evidence", ({ outcome, expected, absent }) => {
    const result = reconcileInterruptedEffects({ executionId: "attempt-1", acknowledged: [acknowledged], operations: [stored()], run: { outcome } });
    const summary = interruptedEffectSummary(result, "The remaining work was stopped.", { stopped: true });
    expect(summary).toContain("Stopped by you.");
    expect(summary).toContain(expected);
    expect(summary).not.toContain(absent);
    expect(interruptedEffectActions(result, "run-1")).toContainEqual(expect.objectContaining({ key: "revert" }));
  });
});

describe("P2 closing reply carries the local-file receipt", () => {
  it("adds the receipt's file state to the model's reply and nothing for a Spectra-only save", () => {
    expect(replyWithNativeReceipt("I updated your essay.", "native_pending"))
      .toBe("I updated your essay.\n\nThe file on your computer hasn't confirmed this change yet.");
    expect(replyWithNativeReceipt("I updated your essay.", "native_verified"))
      .toBe("I updated your essay.\n\nThe file on your computer was checked and has this change.");
    expect(replyWithNativeReceipt("I updated your essay.", undefined)).toBe("I updated your essay.");
    expect(replyWithNativeReceipt("I updated your essay.", "canonical_saved")).toBe("I updated your essay.");
  });
});
