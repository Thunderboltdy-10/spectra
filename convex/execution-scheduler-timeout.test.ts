import { afterEach, expect, it, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import { dispatchManageBacSync, SCHEDULED_CALLBACK_TIMEOUT_MS } from "./executionScheduler";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("gives a scheduled callback a deadline just past the callback routes' own limit", async () => {
  vi.stubEnv("SPECTRA_APP_URL", "https://spectra.example");
  vi.stubEnv("SPECTRA_CONNECTOR_BRIDGE_KEY", "k".repeat(48));
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  // A callback whose connection stalls answers only when it is aborted.
  const fetchMock = vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  }));
  vi.stubGlobal("fetch", fetchMock);
  const handler = Reflect.get(dispatchManageBacSync, "_handler") as (
    ctx: ActionCtx, args: { integrationId: string; scheduledFor: number },
  ) => Promise<void>;

  const dispatched = handler({} as ActionCtx, { integrationId: "integration-1", scheduledFor: 1 });
  expect(timeout).toHaveBeenCalledWith(SCHEDULED_CALLBACK_TIMEOUT_MS);
  expect(SCHEDULED_CALLBACK_TIMEOUT_MS).toBeGreaterThan(300_000);
  expect(SCHEDULED_CALLBACK_TIMEOUT_MS).toBeLessThan(10 * 60_000);
  deadline.abort(new DOMException("The operation timed out.", "TimeoutError"));
  await expect(dispatched).rejects.toMatchObject({ name: "TimeoutError" });
});
