import { spawn } from "node:child_process";

const port = Number(process.env.SPECTRA_COLLAB_PORT || 1234);
const healthUrl = `http://127.0.0.1:${port}/_spectra/health`;
const pollIntervalMs = 2_000;
let child = null;
let stopping = false;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function probeGateway() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(healthUrl, { signal: controller.signal, cache: "no-store" });
    const body = await response.text();
    if (!response.ok) return { state: "foreign", detail: `HTTP ${response.status}` };
    try {
      const payload = JSON.parse(body);
      if (payload?.service === "spectra-collaboration-gateway" && payload?.status === "ready") {
        return { state: "spectra", detail: `protocol ${payload.protocolVersion ?? "unknown"}` };
      }
    } catch {
      // Gateways started before the health marker was introduced return the
      // stock Hocuspocus welcome response. They are safe to reuse for this
      // development session and will expose the marker after their next restart.
      if (body.trim() === "Welcome to Hocuspocus!") return { state: "spectra-legacy", detail: "legacy health response" };
    }
    return { state: "foreign", detail: body.trim().slice(0, 120) || "unexpected response" };
  } catch {
    return { state: "absent" };
  } finally {
    clearTimeout(timeout);
  }
}

function launchGateway() {
  const next = spawn(process.execPath, ["scripts/collaboration-gateway.mjs"], {
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
    process.stderr.write(`Spectra collaboration gateway stopped with ${reason}; supervising process will recover it.\n`);
  });
  process.stdout.write(`Starting Spectra collaboration gateway on ${port}\n`);
}

async function supervise() {
  const initial = await probeGateway();
  if (initial.state === "foreign") {
    throw new Error(`Port ${port} is occupied by another service (${initial.detail}). Set SPECTRA_COLLAB_PORT to an available port or stop that service.`);
  }
  if (initial.state === "spectra" || initial.state === "spectra-legacy") {
    process.stdout.write(`Reusing the Spectra collaboration gateway already listening on ${port} (${initial.detail}).\n`);
  } else {
    launchGateway();
  }

  while (!stopping) {
    await wait(pollIntervalMs);
    if (stopping || child) continue;
    const health = await probeGateway();
    if (health.state === "absent") launchGateway();
    else if (health.state === "foreign") throw new Error(`Port ${port} changed ownership to another service (${health.detail}).`);
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child?.once("exit", resolve)),
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
