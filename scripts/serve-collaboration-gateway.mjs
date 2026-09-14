#!/usr/bin/env node
/**
 * Live / local recipe: start the Spectra collaboration gateway with secrets
 * loaded from `.env.local` (CRLF-safe), matching the Next process that mints
 * collab JWTs. This is the only supported start path.
 *
 * Live one-liner (matched secrets + port with web on :3040):
 *   SPECTRA_COLLAB_PORT=1234 node scripts/serve-collaboration-gateway.mjs
 *
 * Or via npm (exports port yourself when Live web uses 1234):
 *   SPECTRA_COLLAB_PORT=1234 npm run start:collab
 *
 * Supervise + auto-restart (dev):
 *   SPECTRA_COLLAB_PORT=1234 node scripts/serve-collaboration-gateway.mjs --supervise
 *
 * Matched Live pair:
 *   Next web on :3040  →  SPECTRA_WEB_PORT=3040 SPECTRA_COLLAB_PORT=1234 npm run dev:web
 *   Gateway            →  SPECTRA_COLLAB_PORT=1234 node scripts/serve-collaboration-gateway.mjs
 * Both must share SPECTRA_COLLAB_TOKEN_SECRET + SPECTRA_COLLAB_BRIDGE_KEY.
 * Do not start scripts/collaboration-gateway.mjs bare — it skips this loader.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  loadCollaborationEnv,
  stripEnvValue,
} from "./load-collaboration-env.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const supervise = process.argv.includes("--supervise");
const force = process.argv.includes("--force");

const loaded = loadCollaborationEnv(resolve(repositoryRoot, ".env.local"), process.env, {
  // Never take SPECTRA_COLLAB_PORT from .env.local here — Live web uses 1234
  // while instance files often still say 3001. Prefer exported port, else 1234.
  applyFilePorts: false,
});

if (!stripEnvValue(process.env.SPECTRA_COLLAB_PORT)) {
  process.env.SPECTRA_COLLAB_PORT = "1234";
}
const bindPort = stripEnvValue(process.env.SPECTRA_COLLAB_PORT) || loaded.bindPort;

process.stdout.write(
  `Spectra collab env: ${loaded.envPath} convex=${loaded.convexUrl} bind=${bindPort} tokenFp=${loaded.tokenFingerprint} bridgeFp=${loaded.bridgeFingerprint} tokenLen=${loaded.tokenSecretLength} bridgeLen=${loaded.bridgeKeyLength}\n`,
);

async function probeGateway(port) {
  const healthUrl = `http://127.0.0.1:${port}/_spectra/health`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_200);
  try {
    const response = await fetch(healthUrl, {
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await response.text();
    if (!response.ok) return { state: "foreign", detail: `HTTP ${response.status}` };
    try {
      const payload = JSON.parse(body);
      if (
        payload?.service === "spectra-collaboration-gateway" &&
        (payload?.status === "ready" ||
          payload?.status === "degraded" ||
          payload?.status === "not_ready")
      ) {
        return { state: "spectra", detail: `protocol ${payload.protocolVersion ?? "unknown"}` };
      }
    } catch {
      if (body.trim() === "Welcome to Hocuspocus!")
        return { state: "spectra-legacy", detail: "legacy health response" };
    }
    return { state: "foreign", detail: body.trim().slice(0, 120) || "unexpected response" };
  } catch {
    return { state: "absent" };
  } finally {
    clearTimeout(timeout);
  }
}

async function clearStaleGateway(port) {
  const health = await probeGateway(port);
  if (health.state === "absent") return;
  if (health.state === "foreign") {
    throw new Error(
      `Port ${port} is occupied by another service (${health.detail}). Set SPECTRA_COLLAB_PORT to a free port or stop that service.`,
    );
  }
  if (!force && !supervise) {
    process.stderr.write(
      `Spectra collab: clearing stale gateway on ${port} (${health.detail}) so matched secrets win.\n`,
    );
  }
  // Best-effort: ask the listener to exit via health is not enough — spawn fuser/lsof.
  await new Promise((resolvePromise) => {
    const killer = spawn(
      "bash",
      [
        "-lc",
        `pids=$(ss -tlnp 2>/dev/null | sed -n 's/.*:'"${port}"' .*pid=\\([0-9][0-9]*\\).*/\\1/p' | sort -u); ` +
          `if [ -z "$pids" ]; then pids=$(lsof -t -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true); fi; ` +
          `for p in $pids; do kill -TERM "$p" 2>/dev/null || true; done; ` +
          `sleep 0.4; for p in $pids; do kill -KILL "$p" 2>/dev/null || true; done`,
      ],
      { stdio: "ignore" },
    );
    killer.on("exit", () => resolvePromise());
    setTimeout(() => resolvePromise(), 2_500);
  });
  const after = await probeGateway(port);
  if (after.state !== "absent" && after.state !== "foreign") {
    process.stderr.write(
      `Spectra collab: port ${port} still occupied after clear (${after.detail}); continuing spawn may fail.\n`,
    );
  }
}

await clearStaleGateway(Number(bindPort));

process.env.SPECTRA_COLLAB_SERVED_BY = "serve-collaboration-gateway.mjs";

const entry = supervise
  ? resolve(scriptDirectory, "dev-collaboration-gateway.mjs")
  : resolve(scriptDirectory, "collaboration-gateway.mjs");

const child = spawn(process.execPath, [entry], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (child.exitCode === null) child.kill(signal);
  });
}
