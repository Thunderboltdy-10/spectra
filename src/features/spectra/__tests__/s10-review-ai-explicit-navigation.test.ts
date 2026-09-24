// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSpectraAiUiEvent } from "../collaboration/ai-ui-events";
import { __resetFollowAi } from "../collaboration/follow-ai";
import { __resetAppChoreographyHost } from "../collaboration/app-choreography-host";
import { spectraBus } from "../events";

const cleanups: Array<() => void> = [];
beforeEach(() => { __resetFollowAi(); __resetAppChoreographyHost(); });
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); __resetAppChoreographyHost(); });

describe("S10 independent review: explicit navigation with Follow off", () => {
  it("opens Calendar for an explicit registered navigation action", async () => {
    const navigate = vi.fn(() => ({ status: "completed" as const, message: "Calendar ready" }));
    cleanups.push(spectraBus.handle("navigation.show", navigate));
    handleSpectraAiUiEvent({ key: "navigate_spectra", runId: "run-explicit-calendar",
      payload: { destination: "calendar", note: "Opening Calendar" } });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled(), { timeout: 250 });
  });

  it("opens the requested artifact for an explicit registered navigation action", async () => {
    const open = vi.fn(() => ({ status: "completed" as const, message: "Artifact ready" }));
    cleanups.push(spectraBus.handle("work.open", open));
    handleSpectraAiUiEvent({ key: "navigate_spectra", runId: "run-explicit-artifact",
      payload: { destination: "artifact", targetId: "disposable-guide" } });
    await vi.waitFor(() => expect(open).toHaveBeenCalled(), { timeout: 250 });
  });

  it("leaves ordinary artifact work in the background while Follow is off", () => {
    const open = vi.fn();
    cleanups.push(spectraBus.handle("work.open", open));
    handleSpectraAiUiEvent({ key: "reference_insert", runId: "run-reference",
      payload: { hostWorkId: "host", targetWorkId: "source", receipt: {
        phase: "canonical_write", versionId: "version", operationId: "operation", embedId: "embed",
      } } });
    expect(open).not.toHaveBeenCalled();
  });
});
