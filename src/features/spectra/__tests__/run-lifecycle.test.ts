import { describe, expect, it } from "vitest";
import {
  classifyRunAttemptAbort,
  cancelRun,
  completeRun,
  createQueuedRun,
  createResultCardForRun,
  failRun,
  isRetryableRunStatus,
  markRunRunning,
} from "@/features/spectra/ai";
import type { SpectraId } from "@/features/spectra/core";

const runId = "run_1" as SpectraId<"aiRuns">;
const resultCardId = "card_1" as SpectraId<"resultCards">;

describe("Spectra AIRun lifecycle", () => {
  it("allows retry only for terminal runs that the server accepts", () => {
    expect(isRetryableRunStatus("failed")).toBe(true);
    expect(isRetryableRunStatus("cancelled")).toBe(true);
    expect(isRetryableRunStatus("awaiting_resolution")).toBe(false);
    expect(isRetryableRunStatus("awaiting_confirmation")).toBe(false);
    expect(isRetryableRunStatus("running")).toBe(false);
  });

  it("marks a run cancelled only after the durable run state says it was stopped", () => {
    expect(classifyRunAttemptAbort({
      current: { status: "running", executionId: "exec-1", workerId: "worker-1" },
      executionId: "exec-1",
      workerId: "worker-1",
    })).toBe("runtime_abort");
    expect(classifyRunAttemptAbort({
      current: { status: "cancelled", executionId: "exec-1" },
      executionId: "exec-1",
      workerId: "worker-1",
    })).toBe("user_stopped");
    expect(classifyRunAttemptAbort({
      current: { status: "running", executionId: "exec-1", workerId: "worker-2" },
      executionId: "exec-1",
      workerId: "worker-1",
    })).toBe("ownership_lost");
    expect(classifyRunAttemptAbort({
      current: { status: "completed", executionId: "exec-1" },
      executionId: "exec-1",
      workerId: "worker-1",
    })).toBe("already_settled");
    expect(classifyRunAttemptAbort({
      current: null,
      executionId: "exec-1",
      workerId: "worker-1",
    })).toBe("state_unavailable");
  });

  it("transitions queued runs through running and completed", () => {
    const queued = createQueuedRun({
      id: runId,
      ownerAccountId: "account_1",
      sourceSurface: "workspace",
      userPrompt: "Make flashcards",
      now: 1,
    });
    const running = markRunRunning(queued, 2);
    const completed = completeRun(running, "Created a flashcard deck.", 3);

    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBe(3);
    expect(completed.modelUsed).toBe("openai/gpt-5.6");
  });

  it("creates failed result cards from failed runs", () => {
    const failed = failRun(
      createQueuedRun({
        id: runId,
        ownerAccountId: "account_1",
        sourceSurface: "artifact",
        userPrompt: "Shorten this",
        now: 1,
      }),
      "Model unavailable",
      2,
    );
    const card = createResultCardForRun({
      id: resultCardId,
      run: failed,
      title: "Run failed",
      now: 3,
    });

    expect(card.status).toBe("failed");
    expect(card.variant).toBe("error");
    expect(card.summary).toBe("Model unavailable");
  });

  it("prevents invalid terminal transitions", () => {
    const cancelled = cancelRun(
      createQueuedRun({
        id: runId,
        ownerAccountId: "account_1",
        sourceSurface: "chat",
        userPrompt: "Stop",
      }),
    );

    expect(() => markRunRunning(cancelled)).toThrow("Cannot mark cancelled run as running.");
  });
});



