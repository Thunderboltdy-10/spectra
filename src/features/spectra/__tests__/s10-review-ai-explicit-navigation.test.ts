// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSpectraAiUiEvent } from "../collaboration/ai-ui-events";
import { __resetFollowAi, followAiActor } from "../collaboration/follow-ai";
import { __resetAppChoreographyHost } from "../collaboration/app-choreography-host";
import { spectraBus } from "../events";

const cleanups: Array<() => void> = [];
beforeEach(() => { __resetFollowAi(); __resetAppChoreographyHost(); });
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); __resetAppChoreographyHost(); });

describe("S10 independent review: navigation follows the Follow AI viewport policy", () => {
  it("remembers Calendar without moving the viewport when Follow AI is off", async () => {
    const navigate = vi.fn(() => ({ status: "completed" as const, message: "Calendar ready" }));
    cleanups.push(spectraBus.handle("navigation.show", navigate));
    handleSpectraAiUiEvent({ key: "navigate_spectra", runId: "run-explicit-calendar",
      payload: { destination: "calendar", note: "Opening Calendar" } });
    await vi.waitFor(() => expect(navigate).not.toHaveBeenCalled(), { timeout: 250 });
  });

  it("opens Calendar for the followed actor", async () => {
    const navigate = vi.fn(() => ({ status: "completed" as const, message: "Calendar ready" }));
    cleanups.push(spectraBus.handle("navigation.show", navigate));
    followAiActor("run-explicit-calendar");
    handleSpectraAiUiEvent({ key: "navigate_spectra", runId: "run-explicit-calendar",
      payload: { destination: "calendar", note: "Opening Calendar" } });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ route: "calendar" })), { timeout: 250 });
  });

  it("does not open the requested artifact while Follow AI is off", async () => {
    const open = vi.fn(() => ({ status: "completed" as const, message: "Artifact ready" }));
    cleanups.push(spectraBus.handle("work.open", open));
    handleSpectraAiUiEvent({ key: "navigate_spectra", runId: "run-explicit-artifact",
      payload: { destination: "artifact", targetId: "disposable-guide" } });
    await vi.waitFor(() => expect(open).not.toHaveBeenCalled(), { timeout: 250 });
  });

  it("opens the requested artifact for the followed actor", async () => {
    const open = vi.fn(() => ({ status: "completed" as const, message: "Artifact ready" }));
    cleanups.push(spectraBus.handle("work.open", open));
    followAiActor("run-explicit-artifact");
    handleSpectraAiUiEvent({ key: "navigate_spectra", runId: "run-explicit-artifact",
      payload: { destination: "artifact", targetId: "disposable-guide" } });
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith(expect.objectContaining({ workId: "disposable-guide" })), { timeout: 250 });
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
