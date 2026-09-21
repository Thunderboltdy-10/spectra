import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertGatewayPortAvailable, gatewayBinding, runGatewayProcess } from "./collaboration-gateway-process.mjs";

function runtime() {
  return Object.assign(new EventEmitter(), {
    execPath: process.execPath,
    stderr: { write: vi.fn() },
  });
}
function child() {
  const result = new EventEmitter();
  result.kill = vi.fn((signal) => { queueMicrotask(() => result.emit("exit", null, signal)); });
  return result;
}
const fixtures = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await new Promise((resolve) => fixture.close(resolve));
  }
});
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  fixtures.push(server);
  return { host: "127.0.0.1", port: server.address().port };
}

describe("gateway address ownership", () => {
  it.each(["ready", "degraded", "not_ready", "legacy", "foreign"])("leaves an existing %s listener alive", async (status) => {
    const response = status === "legacy" ? "Welcome to Hocuspocus!" :
      JSON.stringify({ service: status === "foreign" ? "other" : "spectra-collaboration-gateway", status });
    const server = createHttpServer((_request, reply) => reply.end(response));
    const binding = await listen(server);
    await expect(assertGatewayPortAvailable(binding)).rejects.toThrow(/already in use/);
    expect(server.listening).toBe(true);
    const result = await fetch(`http://${binding.host}:${binding.port}`, { headers: { Connection: "close" } });
    expect(await result.text()).toBe(response);
  });

  it("refuses a silent TCP listener without a health timeout or process lookup", async () => {
    const binding = await listen(createServer());
    await expect(assertGatewayPortAvailable(binding)).rejects.toThrow(/already in use/);
  });

  it("releases its successful port check", async () => {
    const binding = await listen(createServer());
    const server = fixtures.pop();
    await new Promise((resolve) => server.close(resolve));
    await assertGatewayPortAvailable(binding);
    await assertGatewayPortAvailable(binding);
  });

  it("reports bind failures rather than treating them as an absent listener", async () => {
    const server = new EventEmitter();
    server.listen = () => queueMicrotask(() => server.emit("error", { code: "EACCES" }));
    await expect(assertGatewayPortAvailable({ host: "127.0.0.1", port: 40001 }, () => server))
      .rejects.toThrow(/Cannot bind.*EACCES/);
  });

  it.each(["abc", "-1", "0", "65536", "1.2"])("rejects invalid port %s before starting", (port) => {
    expect(() => gatewayBinding({ SPECTRA_COLLAB_PORT: port })).toThrow(/integer between/);
  });
});

describe("owned gateway child supervision", () => {
  function options(overrides = {}) {
    return {
      entry: "/fixture/gateway.mjs", cwd: "/fixture", environment: {},
      runtime: runtime(), assertAvailable: vi.fn(async () => {}),
      retryDelay: () => 0, wait: async () => {}, ...overrides,
    };
  }

  it("spawns Node directly with a hidden window and returns its exit code", async () => {
    const owned = child();
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => owned.emit("exit", 7, null));
      return owned;
    });
    const opts = options({ spawnProcess });
    expect(await runGatewayProcess(opts)).toBe(7);
    expect(spawnProcess).toHaveBeenCalledExactlyOnceWith(process.execPath, [opts.entry], {
      cwd: opts.cwd, env: opts.environment, stdio: "inherit", windowsHide: true,
    });
    expect(owned.kill).not.toHaveBeenCalled();
    expect(opts.runtime.listenerCount("SIGTERM")).toBe(0);
  });

  it("reports an asynchronous missing-executable error without an unhandled event or retry", async () => {
    const owned = child();
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => owned.emit("error", { code: "ENOENT" }));
      return owned;
    });
    const opts = options({ spawnProcess, supervise: true });
    await expect(runGatewayProcess(opts)).rejects.toThrow(/Could not start.*ENOENT/);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(opts.runtime.listenerCount("SIGTERM")).toBe(0);
  });

  it("rechecks the address after its child exits and refuses a new owner", async () => {
    const owned = child();
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => owned.emit("exit", 1, null));
      return owned;
    });
    const assertAvailable = vi.fn().mockResolvedValueOnce().mockRejectedValueOnce(new Error("already in use"));
    await expect(runGatewayProcess(options({ spawnProcess, assertAvailable, supervise: true })))
      .rejects.toThrow(/already in use/);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(owned.kill).not.toHaveBeenCalled();
  });

  it("recovers its child and stops only the replacement on a shutdown signal", async () => {
    const processRuntime = runtime();
    const first = child();
    const second = child();
    const spawnProcess = vi.fn()
      .mockImplementationOnce(() => { queueMicrotask(() => first.emit("exit", 1, null)); return first; })
      .mockImplementationOnce(() => { queueMicrotask(() => processRuntime.emit("SIGTERM")); return second; });
    const opts = options({ runtime: processRuntime, spawnProcess, supervise: true });
    expect(await runGatewayProcess(opts)).toBe(0);
    expect(opts.assertAvailable).toHaveBeenCalledTimes(2);
    expect(first.kill).not.toHaveBeenCalled();
    expect(second.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
  });

  it("cancels recovery during shutdown without launching another process", async () => {
    const processRuntime = runtime();
    const owned = child();
    const spawnProcess = vi.fn(() => { queueMicrotask(() => owned.emit("exit", 1, null)); return owned; });
    const wait = vi.fn(async (_ms, _value, { signal }) => {
      processRuntime.emit("SIGINT");
      expect(signal.aborted).toBe(true);
      throw new Error("aborted");
    });
    expect(await runGatewayProcess(options({ runtime: processRuntime, spawnProcess, supervise: true, wait }))).toBe(0);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(owned.kill).not.toHaveBeenCalled();
  });

  it("bounds shutdown of an unresponsive owned child without looking up another process", async () => {
    const processRuntime = runtime();
    const owned = child();
    owned.kill.mockImplementation((signal) => {
      if (signal === "SIGKILL") queueMicrotask(() => owned.emit("exit", null, signal));
    });
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => processRuntime.emit("SIGTERM"));
      return owned;
    });
    expect(await runGatewayProcess(options({
      runtime: processRuntime, spawnProcess, supervise: true, shutdownTimeoutMs: 10,
    }))).toBe(0);
    expect(owned.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it("increases recovery backoff for consecutive fast failures", async () => {
    const processRuntime = runtime();
    const retryDelay = vi.fn((attempt) => attempt);
    const spawnProcess = vi.fn(() => {
      const owned = child();
      queueMicrotask(() => owned.emit("exit", 1, null));
      return owned;
    });
    const wait = vi.fn(async () => {
      if (wait.mock.calls.length === 3) processRuntime.emit("SIGINT");
    });
    expect(await runGatewayProcess(options({
      runtime: processRuntime, spawnProcess, supervise: true, retryDelay, wait, now: () => 0,
    }))).toBe(0);
    expect(retryDelay.mock.calls).toEqual([[0], [1], [2]]);
    expect(spawnProcess).toHaveBeenCalledTimes(3);
  });
});
