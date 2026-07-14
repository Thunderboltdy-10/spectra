import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
const baseKey = process.env.SPECTRA_COLLAB_BRIDGE_KEY;
const bridgeKey = process.env.SPECTRA_AI_WORKER_BRIDGE_KEY || (baseKey && baseKey.length >= 32 ? createHmac("sha256", baseKey).update("spectra-ai-worker-bridge:v1").digest("base64url") : undefined);
const httpKey = process.env.SPECTRA_AI_WORKER_HTTP_KEY || (baseKey && baseKey.length >= 32 ? createHmac("sha256", baseKey).update("spectra-ai-worker-http:v1").digest("base64url") : undefined);
const appOrigin = (process.env.SPECTRA_APP_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
if (!convexUrl) throw new Error("AI_WORKER_CONVEX_URL_MISSING");
if (!bridgeKey || bridgeKey.length < 32) throw new Error("AI_WORKER_BRIDGE_CONFIG_MISSING");
if (!httpKey || httpKey.length < 32) throw new Error("AI_WORKER_HTTP_CONFIG_MISSING");

const convex = new ConvexHttpClient(convexUrl, { logger: false });
const exchange = makeFunctionReference("spectraRunWorkerBridge:exchange");
const workerId = `spectra-worker:${process.pid}:${randomUUID()}`;
let stopping = false;

function bridge(operation, payload) {
  const payloadJson = JSON.stringify(payload);
  const timestamp = Date.now();
  const nonce = randomBytes(24).toString("base64url");
  const digest = createHash("sha256").update(payloadJson).digest("base64url");
  const signature = createHmac("sha256", bridgeKey).update([operation, timestamp, nonce, digest].join("|")).digest("base64url");
  return convex.action(exchange, { operation, payloadJson, timestamp, nonce, signature });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function execute(job) {
  const body = JSON.stringify({ action: "internal_work", job });
  const timestamp = Date.now();
  const digest = createHash("sha256").update(body).digest("base64url");
  const signature = createHmac("sha256", httpKey).update(`${timestamp}.${digest}`).digest("base64url");
  let heartbeatFailure = false;
  const heartbeat = setInterval(() => {
    void bridge("heartbeat", { jobId: job.jobId, workerId }).then((result) => {
      if (!result?.alive) heartbeatFailure = true;
    }).catch(() => { heartbeatFailure = true; });
  }, 5_000);
  try {
    const response = await fetch(`${appOrigin}/api/spectra/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-spectra-worker-timestamp": String(timestamp),
        "x-spectra-worker-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(30 * 60_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.completed !== true || heartbeatFailure) throw new Error(typeof result.error === "string" ? result.error : `Worker execution failed (${response.status}).`);
    await bridge("settle", { jobId: job.jobId, workerId, succeeded: true });
  } catch (error) {
    await bridge("settle", { jobId: job.jobId, workerId, succeeded: false, error: error instanceof Error ? error.message : "Worker execution failed." }).catch(() => undefined);
  } finally {
    clearInterval(heartbeat);
  }
}

async function main() {
  process.stdout.write(`Spectra AI worker ${workerId} ready\n`);
  while (!stopping) {
    try {
      const job = await bridge("claim", { workerId });
      if (job) await execute(job);
      else await delay(850);
    } catch (error) {
      process.stderr.write(`Spectra AI worker waiting: ${error instanceof Error ? error.message : String(error)}\n`);
      await delay(2_000);
    }
  }
}

process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });
await main();
