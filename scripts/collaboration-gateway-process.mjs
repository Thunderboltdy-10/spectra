import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { reconnectDelayMs } from "./collaboration-reconnect.mjs";

export function gatewayBinding(environment = process.env) {
  const port = Number(environment.SPECTRA_COLLAB_PORT || 1234);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SPECTRA_COLLAB_PORT must be an integer between 1 and 65535.");
  }
  return { port, host: environment.SPECTRA_COLLAB_HOST || "127.0.0.1" };
}

// A health marker proves neither ownership nor matching secrets. Reserve the
// actual bind address briefly instead; even an unresponsive listener is busy.
// The gateway's own bind remains authoritative if another process wins the race.
export async function assertGatewayPortAvailable(binding, makeServer = createServer) {
  await new Promise((resolve, reject) => {
    const server = makeServer();
    server.once("error", (error) => {
      const address = `${binding.host}:${binding.port}`;
      reject(new Error(error.code === "EADDRINUSE"
        ? `Collaboration address ${address} is already in use. Stop its owning launcher explicitly or choose another SPECTRA_COLLAB_PORT; existing listeners are never stopped or reused.`
        : `Cannot bind collaboration address ${address} (${error.code || "unknown error"}).`,
      { cause: error }));
    });
    server.listen({ ...binding, exclusive: true }, () => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
}

/** Own only the child created here; never find or terminate a PID by port. */
export async function runGatewayProcess({
  entry,
  cwd,
  environment = process.env,
  supervise = false,
  runtime = process,
  spawnProcess = spawn,
  assertAvailable = assertGatewayPortAvailable,
  retryDelay = reconnectDelayMs,
  wait = delay,
  now = Date.now,
  shutdownTimeoutMs = 3000,
}) {
  const binding = gatewayBinding(environment);
  const controller = new AbortController();
  let child = null;
  let stopping = false;
  let shutdownTimer = null;
  let restartAttempt = 0;

  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    controller.abort();
    if (child) {
      const ownedChild = child;
      ownedChild.kill("SIGTERM");
      shutdownTimer = setTimeout(() => {
        if (child === ownedChild) ownedChild.kill("SIGKILL");
      }, shutdownTimeoutMs);
      shutdownTimer.unref?.();
    }
  };
  runtime.once("SIGINT", shutdown);
  runtime.once("SIGTERM", shutdown);
  try {
    while (!stopping) {
      await assertAvailable(binding);
      if (stopping) break;
      const startedAt = now();
      const outcome = await new Promise((resolve, reject) => {
        try {
          child = spawnProcess(runtime.execPath, [entry], {
            cwd, env: environment, stdio: "inherit", windowsHide: true,
          });
        } catch (error) {
          reject(error);
          return;
        }
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      }).catch((error) => {
        throw new Error(`Could not start collaboration gateway (${error.code || "process error"}).`, { cause: error });
      });
      child = null;
      if (stopping) return 0;
      if (!supervise) return outcome.signal ? 1 : (outcome.code ?? 1);
      if (now() - startedAt >= 2000) restartAttempt = 0;
      const retryMs = retryDelay(restartAttempt++);
      runtime.stderr.write(
        `Spectra collaboration gateway stopped with ${outcome.signal ? `signal ${outcome.signal}` : `code ${outcome.code ?? "unknown"}`}; retrying in ${retryMs}ms.\n`,
      );
      try {
        await wait(retryMs, undefined, { signal: controller.signal });
      } catch (error) {
        if (!stopping) throw error;
      }
    }
    return 0;
  } finally {
    if (shutdownTimer) clearTimeout(shutdownTimer);
    runtime.removeListener("SIGINT", shutdown);
    runtime.removeListener("SIGTERM", shutdown);
  }
}
