import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RuntimeOrderExhaustedError,
  runtimeChainReason,
  withRuntimeChain,
  type DisposableModelCaller,
  type RuntimeLink,
} from "../subscription-runtime";
import { ProviderUnavailableError, type HarnessMessage, type ModelTurn } from "../types";
import type { ModelCaller } from "../loop";

/*
 * D1: one silent retry on the same runtime, then the person's order. Nothing
 * reaches Spectra's model unless the order includes it.
 */

const finished = (text: string): ModelTurn => ({ text, toolCalls: [] });
const request = () =>
  ({
    messages: [{ role: "user", content: "hi" }] as HarnessMessage[],
    tools: [],
    toolChoice: "auto",
    signal: new AbortController().signal,
    onText: vi.fn(),
    onRetry: vi.fn(),
  }) as Parameters<ModelCaller>[0];

/** A runtime whose attempts follow the script: an error to throw, or a reply. */
function scripted(runtime: RuntimeLink["runtime"], script: Array<Error | string>) {
  const made: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
  const calls: string[] = [];
  const link: RuntimeLink = {
    runtime,
    make: () => {
      const dispose = vi.fn();
      made.push({ dispose });
      const caller: DisposableModelCaller = async (input) => {
        const next = script.shift();
        calls.push(runtime);
        if (next === undefined) throw new Error(`${runtime} has nothing left to say`);
        if (next instanceof Error) {
          input.onText("half a sente");
          throw next;
        }
        return finished(next);
      };
      caller.dispose = dispose;
      return caller;
    },
  };
  return { link, made, calls };
}

const silent = () => new ProviderUnavailableError("The AI session stopped responding.");
const unreachable = () => new ProviderUnavailableError("Spectra Bridge can't be reached.");

afterEach(() => vi.unstubAllEnvs());

describe("the runtime order", () => {
  it("still moves down the order when tearing down a dead session throws (F15)", async () => {
    const codex = scripted("codex", [silent(), silent()]);
    const make = codex.link.make;
    codex.link.make = () => {
      const caller = make();
      caller.dispose = () => {
        throw new ProviderUnavailableError("The AI session has closed.");
      };
      return caller;
    };
    const claude = scripted("claude", ["from claude"]);
    const moves: string[] = [];
    const caller = withRuntimeChain([codex.link, claude.link], { onMove: (_from, to) => moves.push(to), retryDelayMs: 0 });
    await expect(caller(request())).resolves.toMatchObject({ text: "from claude" });
    expect(moves).toEqual(["claude"]);
    expect(caller.finishedWith()).toBe("claude");
  });

  it("retries a silent turn once on a fresh session and finishes there, saying nothing", async () => {
    const codex = scripted("codex", [silent(), "whole answer"]);
    const spectra = scripted("spectra", ["should not run"]);
    const moves: string[] = [];
    const caller = withRuntimeChain([codex.link, spectra.link], { onMove: (_from, to) => moves.push(to), retryDelayMs: 0 });
    const input = request();
    await expect(caller(input)).resolves.toMatchObject({ text: "whole answer" });
    expect(codex.made).toHaveLength(2);
    expect(codex.made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(input.onRetry).toHaveBeenCalledTimes(1);
    expect(moves).toEqual([]);
    expect(spectra.calls).toEqual([]);
    expect(caller.finishedWith()).toBe("codex");
  });

  it("moves down the order when a runtime stays dead, once, and stays moved", async () => {
    const codex = scripted("codex", [unreachable(), unreachable()]);
    const claude = scripted("claude", ["from claude", "again from claude"]);
    const moves: Array<[string, string, string]> = [];
    const caller = withRuntimeChain([codex.link, claude.link], { onMove: (from, to, reason) => moves.push([from, to, reason]), retryDelayMs: 0 });
    await expect(caller(request())).resolves.toMatchObject({ text: "from claude" });
    expect(moves).toEqual([["codex", "claude", "Spectra Bridge can't be reached"]]);
    await caller(request());
    expect(codex.calls).toHaveLength(2);
    expect(claude.calls).toHaveLength(2);
    expect(caller.finishedWith()).toBe("claude");
  });

  it("does not retry a refusal: a usage limit moves at once", async () => {
    const codex = scripted("codex", [new ProviderUnavailableError("You've hit your usage limit.")]);
    const spectra = scripted("spectra", ["from spectra"]);
    const moves: string[] = [];
    const caller = withRuntimeChain([codex.link, spectra.link], { onMove: (_from, _to, reason) => moves.push(reason), retryDelayMs: 0 });
    await caller(request());
    expect(codex.calls).toHaveLength(1);
    expect(moves).toEqual(["Codex hit its usage limit"]);
  });

  it("stops with the sentence when the order runs out, and never reaches Spectra's model", async () => {
    const codex = scripted("codex", [silent(), silent()]);
    const caller = withRuntimeChain([codex.link], { onMove: vi.fn(), retryDelayMs: 0 });
    const failure = await caller(request()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RuntimeOrderExhaustedError);
    expect(failure).toBeInstanceOf(ProviderUnavailableError);
    expect((failure as Error).message).toBe(
      "Codex stopped responding, and you've chosen not to use anything else. What was done so far is saved.",
    );
  });

  it("follows a forced runtime alone, as before", async () => {
    vi.stubEnv("SPECTRA_AI_RUNTIME", "codex");
    const codex = scripted("codex", [unreachable()]);
    const spectra = scripted("spectra", ["should not run"]);
    const caller = withRuntimeChain([codex.link, spectra.link], { onMove: vi.fn(), retryDelayMs: 0 });
    await expect(caller(request())).rejects.toThrow("Spectra Bridge can't be reached.");
    expect(spectra.calls).toEqual([]);
    expect(codex.calls).toHaveLength(1);
  });

  it("does nothing more when the person stopped the run", async () => {
    const controller = new AbortController();
    const codex: RuntimeLink = { runtime: "codex", make: () => async () => { controller.abort(); throw new Error("aborted"); } };
    const spectra = scripted("spectra", ["should not run"]);
    const caller = withRuntimeChain([codex, spectra.link], { onMove: vi.fn(), retryDelayMs: 0 });
    await expect(caller({ ...request(), signal: controller.signal })).rejects.toThrow("aborted");
    expect(spectra.calls).toEqual([]);
  });

  it("names why a runtime was left, for the hover", () => {
    expect(runtimeChainReason("codex", "The AI session stopped responding.")).toBe("Codex stopped responding");
    expect(runtimeChainReason("claude", "Log in to Claude Code on this computer to use it in Spectra.")).toBe("Claude Code isn't logged in on this computer");
    expect(runtimeChainReason("codex", "Codex isn't installed on this computer.")).toBe("Codex isn't installed on this computer");
    expect(runtimeChainReason("claude", "Could not reach the Bridge relay for claude.")).toBe("Spectra Bridge can't be reached");
    // F06: a running Bridge paired to another account is not "not running".
    expect(runtimeChainReason("claude", "DEVICE_STORE_UNAVAILABLE: Spectra Bridge on this computer is connected to a different Spectra account. Reconnect it in Devices.")).toBe("Spectra Bridge on this computer is connected to another account");
    expect(runtimeChainReason("codex", "DEVICE_STORE_UNAVAILABLE: Spectra Bridge isn't running on this computer.")).toBe("Spectra Bridge isn't running");
  });
});

describe("a send to a runtime this computer can't reach", () => {
  it("starts at the next in the order and says why, without waiting for a failure", async () => {
    const { runtimeOrderFor } = await import("../subscription-runtime");
    expect(runtimeOrderFor("codex", ["claude", "spectra"], [{ runtime: "codex", state: "no-bridge" }])).toEqual({
      order: ["claude", "spectra"],
      skipped: { from: "codex", to: "claude", reason: "Spectra Bridge isn't running" },
    });
    expect(runtimeOrderFor("claude", ["codex", "spectra"], [{ runtime: "claude", state: "signed-out" }, { runtime: "codex", state: "no-bridge" }])).toEqual({
      order: ["spectra"],
      skipped: { from: "claude", to: "spectra", reason: "Claude Code isn't logged in on this computer" },
    });
  });

  it("still tries the person's runtime when nothing else is left, and when nothing is known", async () => {
    const { runtimeOrderFor } = await import("../subscription-runtime");
    expect(runtimeOrderFor("codex", [], [{ runtime: "codex", state: "no-bridge" }])).toEqual({ order: ["codex"] });
    expect(runtimeOrderFor("codex", ["spectra", "spectra"], [])).toEqual({ order: ["codex", "spectra"] });
  });

  it("follows a forced runtime alone", async () => {
    vi.stubEnv("SPECTRA_AI_RUNTIME", "codex");
    const { runtimeOrderFor } = await import("../subscription-runtime");
    expect(runtimeOrderFor("codex", ["spectra"], [{ runtime: "codex", state: "no-bridge" }])).toEqual({ order: ["codex"] });
  });
});
