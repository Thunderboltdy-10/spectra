import { createHash, createHmac } from "node:crypto";
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

  const runMutation = vi.fn(async () => null);
  const dispatched = handler({ runMutation } as unknown as ActionCtx, { integrationId: "integration-1", scheduledFor: 1 });
  await vi.waitFor(() => expect(timeout).toHaveBeenCalledWith(SCHEDULED_CALLBACK_TIMEOUT_MS));
  expect(SCHEDULED_CALLBACK_TIMEOUT_MS).toBeGreaterThan(300_000);
  expect(SCHEDULED_CALLBACK_TIMEOUT_MS).toBeLessThan(10 * 60_000);
  deadline.abort(new DOMException("The operation timed out.", "TimeoutError"));
  await expect(dispatched).rejects.toMatchObject({ name: "TimeoutError" });
  // A failed wake-up leaves the next one to the overdue cron rather than retrying in a loop.
  expect(runMutation).toHaveBeenCalledWith(expect.anything(), { integrationId: "integration-1", failed: true, full: false });
});

it("signs exactly as the app's worker check expects, without Node", async () => {
  vi.stubEnv("SPECTRA_APP_URL", "https://spectra.example");
  vi.stubEnv("SPECTRA_CONNECTOR_BRIDGE_KEY", "k".repeat(48));
  const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify({ completed: true, jobs: Array(8).fill({ worked: true }) })));
  vi.stubGlobal("fetch", fetchMock);
  const handler = Reflect.get(dispatchManageBacSync, "_handler") as (
    ctx: ActionCtx, args: { integrationId: string; scheduledFor: number },
  ) => Promise<void>;
  const runMutation = vi.fn(async () => null);
  await handler({ runMutation } as unknown as ActionCtx, { integrationId: "integration-1", scheduledFor: 1 });
  // A worker that stopped at its job cap asks for the next wake-up at once.
  expect(runMutation).toHaveBeenCalledWith(expect.anything(), { integrationId: "integration-1", failed: false, full: true });
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(String(url)).toBe("https://spectra.example/api/spectra/managebac");
  const headers = init.headers as Record<string, string>;
  const key = createHmac("sha256", "k".repeat(48)).update("spectra-managebac-worker-http:v1").digest("base64url");
  const digest = createHash("sha256").update(String(init.body)).digest("base64url");
  const timestamp = headers["x-spectra-worker-timestamp"];
  expect(headers["x-spectra-worker-signature"]).toBe(createHmac("sha256", key).update(`${timestamp}.${digest}`).digest("base64url"));
});
