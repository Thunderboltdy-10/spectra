import { describe, expect, it } from "vitest";
import {
  cancelRun,
  completeRun,
  createQueuedRun,
  createResultCardForRun,
  failRun,
  markRunRunning,
} from "@/features/spectra/ai";
import type { SpectraId } from "@/features/spectra/core";

const runId = "run_1" as SpectraId<"aiRuns">;
const resultCardId = "card_1" as SpectraId<"resultCards">;

describe("Spectra AIRun lifecycle", () => {
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
    expect(completed.modelUsed).toBe("deepseek/deepseek-v4-pro");
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



