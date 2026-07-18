import { createHash, createHmac, randomUUID } from "node:crypto";

const appOrigin = (
  process.env.SPECTRA_APP_ORIGIN || "http://localhost:3000"
).replace(/\/$/, "");
const connectorKey = process.env.SPECTRA_CONNECTOR_BRIDGE_KEY;
const httpKey =
  process.env.SPECTRA_MANAGEBAC_WORKER_HTTP_KEY ||
  (connectorKey && connectorKey.length >= 32
    ? createHmac("sha256", connectorKey)
        .update("spectra-managebac-worker-http:v1")
        .digest("base64url")
    : undefined);

const workerId = `managebac-worker:${process.pid}:${randomUUID()}`;
let stopping = false;
let lastWaitingNoticeAt = 0;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function work() {
  if (!httpKey || httpKey.length < 32)
    throw new Error("MANAGEBAC_WORKER_HTTP_CONFIG_MISSING");
  const body = JSON.stringify({
    action: "internal_scheduled_work",
    workerId,
  });
  const timestamp = Date.now();
  const digest = createHash("sha256").update(body).digest("base64url");
  const signature = createHmac("sha256", httpKey)
    .update(`${timestamp}.${digest}`)
    .digest("base64url");
  const response = await fetch(`${appOrigin}/api/spectra/managebac`, {
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
  if (!response.ok || result.completed !== true)
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : `Scheduled sync request failed (${response.status}).`,
    );
  return result.worked === true;
}

async function main() {
  process.stdout.write(`Spectra ManageBac worker ${workerId} ready\n`);
  while (!stopping) {
    try {
      const worked = await work();
      await delay(worked ? 250 : 15_000);
    } catch (error) {
      const now = Date.now();
      if (now - lastWaitingNoticeAt > 60_000) {
        process.stderr.write(
          `Spectra ManageBac worker waiting: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
        lastWaitingNoticeAt = now;
      }
      await delay(5_000);
    }
  }
}

process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

await main();
