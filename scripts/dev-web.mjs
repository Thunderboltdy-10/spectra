import { spawn } from "node:child_process";
import { resolve } from "node:path";

const port = Number(process.env.SPECTRA_WEB_PORT || 3000);
const hostname = process.env.SPECTRA_WEB_HOST || "0.0.0.0";
const healthUrl = `http://127.0.0.1:${port}/api/health`;
const pollIntervalMs = 2_000;
let child = null;
let stopping = false;

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function probeWeb() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(healthUrl, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => null);
    if (
      response.ok
      && payload?.service === "spectra-web"
      && payload?.status === "ready"
      && payload?.protocolVersion === 1
    ) {
      return { state: "spectra" };
    }
    return {
      state: "foreign",
      detail: response.ok ? "unexpected health response" : `HTTP ${response.status}`,
    };
  } catch {
    return { state: "absent" };
  } finally {
    clearTimeout(timeout);
  }
}

function launchWeb() {
  const serverScript = resolve("scripts/next-dev-server.mjs");
  const next = spawn(process.execPath, [serverScript], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  child = next;
  next.once("exit", (code, signal) => {
    if (child === next) child = null;
    if (stopping) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    process.stderr.write(`Spectra web development server stopped with ${reason}; supervising process will recover it.\n`);
  });
  process.stdout.write(`Starting Spectra web development server on http://localhost:${port}\n`);
}

async function supervise() {
  const initial = await probeWeb();
  if (initial.state === "foreign") {
    throw new Error(
      `Port ${port} is occupied by another web service (${initial.detail}). Stop that service or set SPECTRA_WEB_PORT; Spectra will never silently move to another port.`,
    );
  }
  if (initial.state === "spectra") {
    process.stdout.write(`Reusing the Spectra web development server already listening on ${port}.\n`);
  } else {
    launchWeb();
  }

  while (!stopping) {
    await wait(pollIntervalMs);
    if (stopping || child) continue;
    const health = await probeWeb();
    if (health.state === "absent") launchWeb();
    else if (health.state === "foreign") {
      throw new Error(`Port ${port} changed ownership to another web service (${health.detail}).`);
    }
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolveExit) => child?.once("exit", resolveExit)),
      wait(3_000),
    ]);
  }
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

supervise().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
